import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const d = (v: string) => new Prisma.Decimal(v);

const mockPrisma: any = {
  invoice: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  invoiceLine: { createMany: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  feeAssignment: { findMany: jest.fn() },
  enrollment: { findFirst: jest.fn() },
  term: { findFirst: jest.fn() },
  documentSequence: { update: jest.fn() },
  $transaction: jest.fn((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
};
const mockAuditLogs = { create: jest.fn() };

async function makeService(): Promise<InvoicesService> {
  const module = await Test.createTestingModule({
    providers: [
      InvoicesService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AuditLogsService, useValue: mockAuditLogs },
    ],
  }).compile();
  return module.get(InvoicesService);
}

/** An assignment as the invoice validator loads it. */
function assignment(id: string, over: any = {}) {
  return {
    id,
    enrollmentId: 'enr1',
    amountDue: d('580.00'),
    schoolFee: { termId: 't1', name: `Fee ${id}`, feeType: { name: 'Tuition' } },
    invoiceLines: [],
    ...over,
  };
}

/** A detail read as DETAIL_INCLUDE shapes it. */
function detail(over: any = {}) {
  return {
    id: 'i1', schoolId: 's1', invoiceNumber: 'INV-00001',
    status: InvoiceStatus.issued, issuedOn: new Date('2026-09-01'), dueOn: null,
    notes: null, cancelledAt: null, cancellationReason: null,
    enrollmentId: 'enr1', termId: 't1', supersedesInvoiceId: null,
    enrollment: {
      student: { id: 'stu1', studentNumber: 'STU-0001', firstName: 'Ama', middleName: null, lastName: 'Boakye' },
      classroom: { displayName: 'Basic 3A' },
      academicYear: { label: '2025/2026' },
    },
    term: { id: 't1', label: 'Term 3' },
    lines: [
      {
        id: 'l1', voidedAt: null,
        feeAssignment: {
          id: 'a1', amountDue: d('580.00'),
          payments: [{ amount: d('200.00') }],
          schoolFee: { name: 'Basic 3 Tuition', feeType: { name: 'Tuition' } },
        },
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.documentSequence.update.mockResolvedValue({
    currentNumber: 7, paddingLength: 5, prefix: 'INV',
  });
  mockPrisma.invoiceLine.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.invoiceLine.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.invoiceLine.findMany.mockResolvedValue([]);
  mockPrisma.invoice.update.mockResolvedValue({});
});

// ── issue ─────────────────────────────────────────────────────────────────────

describe('issuing an invoice', () => {
  function arrangeIssue(assignments = [assignment('a1')]) {
    mockPrisma.enrollment.findFirst.mockResolvedValue({
      id: 'enr1', academicYearId: 'y1', student: { firstName: 'Ama', lastName: 'Boakye' },
    });
    mockPrisma.term.findFirst.mockResolvedValue({ id: 't1', label: 'Term 3', academicYearId: 'y1' });
    mockPrisma.feeAssignment.findMany.mockResolvedValue(assignments);
    mockPrisma.invoice.create.mockResolvedValue({ id: 'i1', invoiceNumber: 'INV-00007' });
    mockPrisma.invoice.findFirst.mockResolvedValue(detail());
  }

  const dto = { enrollmentId: 'enr1', termId: 't1', feeAssignmentIds: ['a1'] };

  it('claims a number from the invoice sequence', async () => {
    const svc = await makeService();
    arrangeIssue();

    await svc.create(dto, 'u1', 's1');

    expect(mockPrisma.documentSequence.update.mock.calls[0][0].where.schoolId_type.type)
      .toBe('invoice_number');
  });

  it('writes one line per assignment — the FROZEN SET', async () => {
    const svc = await makeService();
    arrangeIssue([assignment('a1'), assignment('a2')]);

    await svc.create({ ...dto, feeAssignmentIds: ['a1', 'a2'] }, 'u1', 's1');

    // Enumerated lines are the point: a query has no memory, so a later
    // reconcile would silently change what yesterday's bill said.
    expect(mockPrisma.invoiceLine.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('stores NO money on the invoice or its lines', async () => {
    const svc = await makeService();
    arrangeIssue();

    await svc.create(dto, 'u1', 's1');

    const invoiceData = mockPrisma.invoice.create.mock.calls[0][0].data;
    const lineData = mockPrisma.invoiceLine.createMany.mock.calls[0][0].data[0];
    for (const field of ['total', 'amount', 'amountDue', 'amountPaid', 'balance', 'outstanding']) {
      expect(invoiceData).not.toHaveProperty(field);
      expect(lineData).not.toHaveProperty(field);
    }
  });

  it('refuses an assignment belonging to another student', async () => {
    const svc = await makeService();
    arrangeIssue([assignment('a1', { enrollmentId: 'SOMEONE_ELSE' })]);

    await expect(svc.create(dto, 'u1', 's1')).rejects.toThrow(
      /does not belong to this student's enrollment/,
    );
  });

  it('refuses an assignment from a DIFFERENT TERM — one term per invoice', async () => {
    const svc = await makeService();
    arrangeIssue([assignment('a1', { schoolFee: { termId: 'OTHER', name: 'Old Fee', feeType: { name: 'Tuition' } } })]);

    // Spanning terms would formally re-bill arrears that are, by design, only
    // ever reported and never re-billed.
    await expect(svc.create(dto, 'u1', 's1')).rejects.toThrow(
      /belongs to a different term.*brought-forward figure, not as lines/s,
    );
  });

  it('refuses an assignment already on a live invoice, naming it', async () => {
    const svc = await makeService();
    arrangeIssue([
      assignment('a1', { invoiceLines: [{ invoice: { invoiceNumber: 'INV-00003' } }] }),
    ]);

    await expect(svc.create(dto, 'u1', 's1')).rejects.toThrow(
      /already on invoice INV-00003/,
    );
  });

  it('refuses the same assignment listed twice', async () => {
    const svc = await makeService();
    arrangeIssue();

    await expect(
      svc.create({ ...dto, feeAssignmentIds: ['a1', 'a1'] }, 'u1', 's1'),
    ).rejects.toThrow(/more than once/);
  });

  it('refuses a term from another academic year', async () => {
    const svc = await makeService();
    arrangeIssue();
    mockPrisma.term.findFirst.mockResolvedValue({ id: 't1', label: 'Term 1', academicYearId: 'OTHER' });

    await expect(svc.create(dto, 'u1', 's1')).rejects.toBeInstanceOf(ConflictException);
  });
});

// ── derived payment state ────────────────────────────────────────────────────

describe('invoice figures are derived, never stored', () => {
  it('reads billed, collected and outstanding through the lines', async () => {
    const svc = await makeService();
    mockPrisma.invoice.findFirst.mockResolvedValue(detail());

    const result = await svc.findOne('i1', 's1');

    expect(result.billed).toBe('580.00');
    expect(result.collected).toBe('200.00');
    expect(result.outstanding).toBe('380.00');
    expect(result.paymentState).toBe('partially_paid');
  });

  it('a reversal moves a paid invoice back to partially paid with no sync', async () => {
    const svc = await makeService();
    const paid = detail();
    paid.lines[0].feeAssignment.payments = [{ amount: d('580.00') }];
    mockPrisma.invoice.findFirst.mockResolvedValue(paid);
    expect((await svc.findOne('i1', 's1')).paymentState).toBe('paid');

    const reversed = detail();
    reversed.lines[0].feeAssignment.payments = [{ amount: d('580.00') }, { amount: d('-380.00') }];
    mockPrisma.invoice.findFirst.mockResolvedValue(reversed);
    expect((await svc.findOne('i1', 's1')).paymentState).toBe('partially_paid');
  });

  it('a CANCELLED invoice still reports the live money underneath it', async () => {
    const svc = await makeService();
    mockPrisma.invoice.findFirst.mockResolvedValue(
      detail({ status: InvoiceStatus.cancelled, cancellationReason: 'Billed in error' }),
    );

    const result = await svc.findOne('i1', 's1');

    // Withdrawing the demand does not unmake the payment.
    expect(result.status).toBe('cancelled');
    expect(result.collected).toBe('200.00');
  });
});

// ── cancel ───────────────────────────────────────────────────────────────────

describe('cancelling an invoice', () => {
  function arrangeCancel(over: any = {}) {
    mockPrisma.invoice.findFirst.mockImplementation(({ include }: any) => {
      if (include?.lines && include?.supersededBy) {
        return Promise.resolve({
          id: 'i1', invoiceNumber: 'INV-00001', status: InvoiceStatus.issued,
          enrollmentId: 'enr1', termId: 't1', notes: null,
          lines: [{ id: 'l1', feeAssignmentId: 'a1' }], supersededBy: null, ...over,
        });
      }
      return Promise.resolve(detail({ status: InvoiceStatus.cancelled }));
    });
    mockPrisma.invoiceLine.findMany.mockResolvedValue([
      { feeAssignment: { payments: [{ amount: d('200.00') }, { amount: d('100.00') }] } },
    ]);
  }

  it('voids the lines, releasing the assignments and lifting the freeze', async () => {
    const svc = await makeService();
    arrangeCancel();

    await svc.cancel('i1', { reason: 'Billed the wrong child entirely' }, 'u1', 's1');

    expect(mockPrisma.invoiceLine.updateMany.mock.calls[0][0]).toMatchObject({
      where: { invoiceId: 'i1', voidedAt: null },
    });
    expect(mockPrisma.invoiceLine.updateMany.mock.calls[0][0].data.voidedAt).toBeInstanceOf(Date);
  });

  it('does NOT touch payments, and reports what it retained', async () => {
    const svc = await makeService();
    arrangeCancel();

    const result = await svc.cancel('i1', { reason: 'Billed the wrong child entirely' }, 'u1', 's1');

    // Money is only ever corrected by a reversing entry on FeePayment. A
    // cancel that silently reversed payments would be a second, hidden
    // money-correction path in the same module.
    expect(result.paymentsRetained).toBe(2);
    expect(result.paymentsRetainedTotal).toBe('300.00');
  });

  it('audits the reason', async () => {
    const svc = await makeService();
    arrangeCancel();

    await svc.cancel('i1', { reason: 'Billed the wrong child entirely' }, 'u1', 's1');

    const entry = mockAuditLogs.create.mock.calls[0][0];
    expect(entry.action).toBe('invoices.cancelled');
    expect(entry.metadata.reason).toBe('Billed the wrong child entirely');
    expect(entry.metadata.paymentsRetained).toBe(2);
  });

  it('refuses to cancel an already-cancelled invoice', async () => {
    const svc = await makeService();
    arrangeCancel({ status: InvoiceStatus.cancelled });

    await expect(
      svc.cancel('i1', { reason: 'Trying to cancel it twice over' }, 'u1', 's1'),
    ).rejects.toThrow(/is cancelled and cannot be cancelled/);
  });

  it('404s an invoice that does not exist', async () => {
    const svc = await makeService();
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    await expect(
      svc.cancel('nope', { reason: 'Cancelling something that is not there' }, 'u1', 's1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── correct: the whole point of this change ──────────────────────────────────

describe('correcting an invoice — cancel and reissue as ONE act', () => {
  function arrangeCorrect(over: any = {}) {
    mockPrisma.invoice.findFirst.mockImplementation(({ where, include }: any) => {
      if (include?.lines && include?.supersededBy) {
        return Promise.resolve({
          id: 'i1', invoiceNumber: 'INV-00001', status: InvoiceStatus.issued,
          enrollmentId: 'enr1', termId: 't1', notes: 'original notes',
          lines: [{ id: 'l1', feeAssignmentId: 'a1' }, { id: 'l2', feeAssignmentId: 'a2' }],
          supersededBy: null, ...over,
        });
      }
      // Nothing supersedes anything in this fixture — answering otherwise
      // would walk the chain forever.
      if (where?.supersedesInvoiceId !== undefined) return Promise.resolve(null);
      if (where?.id === 'i2') {
        return Promise.resolve(detail({ id: 'i2', invoiceNumber: 'INV-00008', supersedesInvoiceId: null }));
      }
      return Promise.resolve(detail());
    });
    // Respect the `id in (…)` filter — the service checks that it got back
    // exactly as many rows as it asked for.
    mockPrisma.feeAssignment.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        [assignment('a1'), assignment('a2')].filter((a) => where.id.in.includes(a.id)),
      ),
    );
    mockPrisma.invoice.create.mockResolvedValue({ id: 'i2', invoiceNumber: 'INV-00008' });
    mockPrisma.invoiceLine.findMany.mockResolvedValue([
      { feeAssignment: { payments: [{ amount: d('200.00') }] } },
    ]);
  }

  const reason = 'Transport billed in error for this child';

  it('runs void, cancel and reissue in a SINGLE transaction', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');

    // A crash between cancel and reissue would leave the invoice withdrawn
    // with no replacement, or two live invoices over the same assignments.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('voids the original lines BEFORE validating the replacement', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');

    // Otherwise the replacement would be refused for reusing assignments the
    // original still holds.
    const voidOrder = mockPrisma.invoiceLine.updateMany.mock.invocationCallOrder[0];
    const validateOrder = mockPrisma.feeAssignment.findMany.mock.invocationCallOrder[0];
    expect(voidOrder).toBeLessThan(validateOrder);
  });

  it('cancels the original with the supplied reason', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');

    expect(mockPrisma.invoice.update.mock.calls[0][0].data).toMatchObject({
      status: InvoiceStatus.cancelled,
      cancellationReason: reason,
    });
  });

  it('issues a NEW number and points the replacement back at the original', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');

    expect(mockPrisma.invoice.create.mock.calls[0][0].data.supersedesInvoiceId).toBe('i1');
    expect(mockPrisma.documentSequence.update).toHaveBeenCalled();
  });

  it('reissues over the SAME set when no corrected set is given', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');

    expect(mockPrisma.invoiceLine.createMany.mock.calls[0][0].data.map((l: any) => l.feeAssignmentId))
      .toEqual(['a1', 'a2']);
  });

  it('reissues over a CORRECTED set when one is given', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason, feeAssignmentIds: ['a1'] }, 'u1', 's1');

    expect(mockPrisma.invoiceLine.createMany.mock.calls[0][0].data.map((l: any) => l.feeAssignmentId))
      .toEqual(['a1']);
  });

  it('writes TWO audit entries — one per document', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');

    const actions = mockAuditLogs.create.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['invoices.cancelled', 'invoices.corrected']);
  });

  it('the cancel entry carries supersededBy, distinguishing it from a plain cancel', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');

    const cancelEntry = mockAuditLogs.create.mock.calls.find(
      (c) => c[0].action === 'invoices.cancelled',
    )![0];
    expect(cancelEntry.entityId).toBe('i1');
    expect(cancelEntry.metadata.supersededBy).toBe('i2');
    expect(cancelEntry.metadata.supersededByNumber).toBe('INV-00008');
  });

  it('the corrected entry names what it supersedes, on the NEW invoice', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');

    const correctedEntry = mockAuditLogs.create.mock.calls.find(
      (c) => c[0].action === 'invoices.corrected',
    )![0];
    expect(correctedEntry.entityId).toBe('i2');
    expect(correctedEntry.metadata.supersedes).toBe('i1');
    expect(correctedEntry.metadata.reason).toBe(reason);
  });

  it('carries the original notes forward unless new ones are given', async () => {
    const svc = await makeService();
    arrangeCorrect();

    await svc.correct('i1', { reason }, 'u1', 's1');
    expect(mockPrisma.invoice.create.mock.calls[0][0].data.notes).toBe('original notes');
  });

  it('REFUSES to correct an already-superseded invoice, pointing at its replacement', async () => {
    const svc = await makeService();
    arrangeCorrect({
      supersededBy: { id: 'i2', invoiceNumber: 'INV-00008' },
    });

    await expect(svc.correct('i1', { reason }, 'u1', 's1')).rejects.toThrow(
      /INV-00001 has already been corrected and replaced by INV-00008\. Work on that invoice instead\./,
    );
  });

  it('refuses to CANCEL an already-superseded invoice for the same reason', async () => {
    const svc = await makeService();
    arrangeCorrect({
      supersededBy: { id: 'i2', invoiceNumber: 'INV-00008' },
    });

    await expect(
      svc.cancel('i1', { reason: 'Trying to cancel a superseded invoice' }, 'u1', 's1'),
    ).rejects.toThrow(/already been corrected and replaced by INV-00008/);
  });
});

// ── the chain, in both directions ────────────────────────────────────────────

describe('the correction chain is walkable in both directions', () => {
  /**
   * Only ONE column exists (`supersedesInvoiceId`, on the newer invoice). The
   * forward direction is the back-relation, so there is no second column that
   * could disagree with the first.
   */
  function arrangeChain() {
    // INV-1 → INV-2 → INV-3, and we open the middle one.
    const rows: Record<string, any> = {
      i1: { id: 'i1', invoiceNumber: 'INV-00001', status: 'cancelled', issuedOn: new Date('2026-09-01'), cancellationReason: 'First error', supersedesInvoiceId: null },
      i2: { id: 'i2', invoiceNumber: 'INV-00002', status: 'cancelled', issuedOn: new Date('2026-09-02'), cancellationReason: 'Second error', supersedesInvoiceId: 'i1' },
      i3: { id: 'i3', invoiceNumber: 'INV-00003', status: 'issued', issuedOn: new Date('2026-09-03'), cancellationReason: null, supersedesInvoiceId: 'i2' },
    };
    mockPrisma.invoice.findFirst.mockImplementation(({ where, include, select }: any) => {
      if (include) return Promise.resolve(detail({ id: 'i2', invoiceNumber: 'INV-00002', supersedesInvoiceId: 'i1' }));
      if (where.supersedesInvoiceId) {
        const found = Object.values(rows).find((r) => r.supersedesInvoiceId === where.supersedesInvoiceId);
        return Promise.resolve(found ?? null);
      }
      return Promise.resolve(rows[where.id] ?? null);
    });
  }

  it('walks BACKWARD to every invoice this one replaced', async () => {
    const svc = await makeService();
    arrangeChain();

    const result = await svc.findOne('i2', 's1');

    expect(result.chain.supersedes.map((i: any) => i.invoiceNumber)).toEqual(['INV-00001']);
    expect(result.supersedesInvoiceId).toBe('i1');
  });

  it('walks FORWARD to every invoice that replaced this one', async () => {
    const svc = await makeService();
    arrangeChain();

    const result = await svc.findOne('i2', 's1');

    expect(result.chain.supersededBy.map((i: any) => i.invoiceNumber)).toEqual(['INV-00003']);
    // Exposed as a field even though no such column exists.
    expect(result.supersededByInvoiceId).toBe('i3');
  });

  it('a standalone invoice has an empty chain in both directions', async () => {
    const svc = await makeService();
    mockPrisma.invoice.findFirst.mockImplementation(({ include }: any) =>
      include ? Promise.resolve(detail()) : Promise.resolve(null),
    );

    const result = await svc.findOne('i1', 's1');

    expect(result.chain.supersedes).toEqual([]);
    expect(result.chain.supersededBy).toEqual([]);
    expect(result.supersededByInvoiceId).toBeNull();
  });
});
