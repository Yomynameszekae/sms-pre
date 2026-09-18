import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FeePaymentMethod, Prisma } from '@prisma/client';
import { SchoolFeesService, parseAmount } from './school-fees.service';
import { FeePaymentsService } from './fee-payments.service';
import { FeeAssignmentsService } from './fee-assignments.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsTriggers } from '../notifications/notifications.triggers';

const d = (v: string) => new Prisma.Decimal(v);

const mockPrisma: any = {
  schoolFee: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  feeType: { findFirst: jest.fn() },
  level: { findFirst: jest.fn() },
  term: { findFirst: jest.fn() },
  enrollment: { findMany: jest.fn() },
  feeAssignment: {
    createMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(),
  },
  feePayment: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  invoiceLine: { findFirst: jest.fn() },
  documentSequence: { update: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
};
const mockAuditLogs = { create: jest.fn() };
const mockTriggers = { feeReceipt: jest.fn(), feeReminders: jest.fn(), absenceAlerts: jest.fn() };

async function make<T>(cls: new (...a: any[]) => T): Promise<T> {
  const module = await Test.createTestingModule({
    providers: [
      cls,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AuditLogsService, useValue: mockAuditLogs },
      // FeePaymentsService fires the fee-receipt notification after the
      // payment transaction commits.
      { provide: NotificationsTriggers, useValue: mockTriggers },
    ],
  }).compile();
  return module.get(cls);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.documentSequence.update.mockResolvedValue({
    currentNumber: 1, paddingLength: 5, prefix: 'RCT',
  });
});

// ── amount parsing ────────────────────────────────────────────────────────────

describe('parseAmount — money never enters as a float', () => {
  it('accepts a well-formed amount', () => {
    expect(parseAmount('450.00').toFixed(2)).toBe('450.00');
  });

  it('rejects zero and negatives — a bill is not a credit', () => {
    expect(() => parseAmount('0')).toThrow(BadRequestException);
    expect(() => parseAmount('-10.00')).toThrow(BadRequestException);
  });

  it('rejects more than two decimal places rather than silently rounding', () => {
    // Silently rounding GH¢10.005 is how a ledger drifts by a pesewa a time.
    expect(() => parseAmount('10.005')).toThrow(/2 decimal places/);
  });

  it('rejects text and infinities', () => {
    expect(() => parseAmount('abc')).toThrow(BadRequestException);
    expect(() => parseAmount('Infinity')).toThrow(BadRequestException);
  });

  it('names the field it rejected', () => {
    expect(() => parseAmount('-1', 'amountDue')).toThrow(/amountDue/);
  });
});

// ── assignment and reconcile ─────────────────────────────────────────────────

describe('SchoolFee creation assigns via Level → Classroom → Enrollment', () => {
  function arrange(enrollmentIds: string[]) {
    mockPrisma.feeType.findFirst.mockResolvedValue({ id: 'ft1', name: 'Tuition' });
    mockPrisma.level.findFirst.mockResolvedValue({ id: 'lv1', name: 'Basic 3' });
    mockPrisma.term.findFirst.mockResolvedValue({ id: 't1', label: 'Term 3', academicYearId: 'y1' });
    mockPrisma.schoolFee.create.mockResolvedValue({ id: 'sf1', amount: d('580.00') });
    mockPrisma.enrollment.findMany.mockResolvedValue(enrollmentIds.map((id) => ({ id })));
    mockPrisma.feeAssignment.createMany.mockResolvedValue({ count: enrollmentIds.length });
  }

  const dto = {
    feeTypeId: 'ft1', levelId: 'lv1', academicYearId: 'y1', termId: 't1',
    name: 'Basic 3 Tuition', amount: '580.00',
  };

  it('creates one assignment per active enrollment in the level', async () => {
    const svc = await make(SchoolFeesService);
    arrange(['e1', 'e2', 'e3']);

    const result = await svc.create(dto, 'u1', 's1');

    expect(result.assignedCount).toBe(3);
    const rows = mockPrisma.feeAssignment.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(3);
  });

  it('filters the roster on ACTIVE enrollments in that level and year', async () => {
    const svc = await make(SchoolFeesService);
    arrange(['e1']);

    await svc.create(dto, 'u1', 's1');

    // A fee binds to a LEVEL; the walk to enrollments goes through classroom.
    expect(mockPrisma.enrollment.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'active',
      academicYearId: 'y1',
      classroom: { levelId: 'lv1', academicYearId: 'y1' },
    });
  });

  it('COPIES the amount onto each assignment — the price freeze', async () => {
    const svc = await make(SchoolFeesService);
    arrange(['e1']);

    await svc.create(dto, 'u1', 's1');

    const row = mockPrisma.feeAssignment.createMany.mock.calls[0][0].data[0];
    expect(row.amountDue.toFixed(2)).toBe('580.00');
  });

  it('creates the fee and its assignments in ONE transaction', async () => {
    const svc = await make(SchoolFeesService);
    arrange(['e1']);

    await svc.create(dto, 'u1', 's1');

    // A fee that exists but assigned nobody is a silent revenue hole.
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('a fee for a term in another year is refused', async () => {
    const svc = await make(SchoolFeesService);
    arrange(['e1']);
    mockPrisma.term.findFirst.mockResolvedValue({ id: 't1', label: 'Term 1', academicYearId: 'OTHER' });

    await expect(svc.create(dto, 'u1', 's1')).rejects.toThrow(/does not belong to the selected academic year/);
  });

  it('a duplicate fee for the same type/level/year/term is refused by name', async () => {
    const svc = await make(SchoolFeesService);
    arrange(['e1']);
    mockPrisma.schoolFee.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002', clientVersion: '5.14.0', meta: { target: ['school_id'] },
      }),
    );

    await expect(svc.create(dto, 'u1', 's1')).rejects.toThrow(
      /A 'Tuition' fee already exists for Basic 3 in Term 3/,
    );
  });
});

describe('reconcile — idempotent, and silent when there is nothing to do', () => {
  function arrangeFee(amount = '580.00') {
    mockPrisma.schoolFee.findFirst.mockResolvedValue({
      id: 'sf1', schoolId: 's1', levelId: 'lv1', academicYearId: 'y1',
      amount: d(amount), name: 'Basic 3 Tuition', level: { name: 'Basic 3' },
      _count: { assignments: 2 },
    });
  }

  it('creates assignments only for enrollments that lack one', async () => {
    const svc = await make(SchoolFeesService);
    arrangeFee();
    mockPrisma.enrollment.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]);
    mockPrisma.feeAssignment.createMany.mockResolvedValue({ count: 1 });

    const result = await svc.reconcile('sf1', 'u1', 's1');

    expect(result.createdCount).toBe(1);
    // skipDuplicates + the composite unique is what makes it idempotent.
    expect(mockPrisma.feeAssignment.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('a second run creates nothing and writes NO audit entry', async () => {
    const svc = await make(SchoolFeesService);
    arrangeFee();
    mockPrisma.enrollment.findMany.mockResolvedValue([{ id: 'e1' }]);
    mockPrisma.feeAssignment.createMany.mockResolvedValue({ count: 0 });

    const result = await svc.reconcile('sf1', 'u1', 's1');

    expect(result.createdCount).toBe(0);
    // A reconcile that finds nothing to do is the normal case and must not
    // flood a trail whose whole value is that it stays readable.
    expect(mockAuditLogs.create).not.toHaveBeenCalled();
  });

  it('uses the fee\'s CURRENT amount for late joiners', async () => {
    const svc = await make(SchoolFeesService);
    arrangeFee('650.00');
    mockPrisma.enrollment.findMany.mockResolvedValue([{ id: 'e9' }]);
    mockPrisma.feeAssignment.createMany.mockResolvedValue({ count: 1 });

    await svc.reconcile('sf1', 'u1', 's1');

    // A child joining in week six is billed today's price, not the price the
    // fee was created at.
    expect(mockPrisma.feeAssignment.createMany.mock.calls[0][0].data[0].amountDue.toFixed(2))
      .toBe('650.00');
  });
});

// ── payments ─────────────────────────────────────────────────────────────────

describe('payment recording', () => {
  const base = {
    feeAssignmentId: 'a1', method: FeePaymentMethod.cash, paidOn: '2026-09-10',
  };

  function arrangeAssignment(amountDue: string, existing: string[] = []) {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'a1', amount_due: d(amountDue) }]);
    mockPrisma.feePayment.findMany.mockResolvedValue(existing.map((a) => ({ amount: d(a) })));
    mockPrisma.feePayment.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'p1', receiptNumber: 'RCT-00001', ...args.data }),
    );
  }

  it('takes a ROW LOCK on the assignment before computing the balance', async () => {
    const svc = await make(FeePaymentsService);
    arrangeAssignment('580.00');

    await svc.create({ ...base, amount: '100.00' }, 'u1', 's1');

    // Without FOR UPDATE two concurrent payments both see the same remaining
    // balance and both succeed, leaving the child overpaid with two receipts.
    const sql = mockPrisma.$queryRaw.mock.calls[0][0].join('');
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it('allows a partial payment', async () => {
    const svc = await make(FeePaymentsService);
    arrangeAssignment('580.00');

    const payment = await svc.create({ ...base, amount: '200.00' }, 'u1', 's1');
    expect(payment.amount.toFixed(2)).toBe('200.00');
  });

  it('allows a payment that exactly clears the balance', async () => {
    const svc = await make(FeePaymentsService);
    arrangeAssignment('580.00', ['380.00']);

    await expect(svc.create({ ...base, amount: '200.00' }, 'u1', 's1')).resolves.toBeDefined();
  });

  it('REFUSES overpayment, naming the maximum', async () => {
    const svc = await make(FeePaymentsService);
    arrangeAssignment('580.00', ['400.00']);

    await expect(svc.create({ ...base, amount: '200.00' }, 'u1', 's1')).rejects.toThrow(
      /maximum that can be recorded against this fee is GHS 180\.00/,
    );
  });

  it('counts a prior reversal when computing the remaining balance', async () => {
    const svc = await make(FeePaymentsService);
    // 400 paid then fully reversed: the whole 580 is payable again.
    arrangeAssignment('580.00', ['400.00', '-400.00']);

    await expect(svc.create({ ...base, amount: '580.00' }, 'u1', 's1')).resolves.toBeDefined();
  });

  it('claims a receipt number inside the same transaction', async () => {
    const svc = await make(FeePaymentsService);
    arrangeAssignment('580.00');

    await svc.create({ ...base, amount: '100.00' }, 'u1', 's1');
    expect(mockPrisma.documentSequence.update).toHaveBeenCalled();
  });

  it('requires a network for mobile money', async () => {
    const svc = await make(FeePaymentsService);
    arrangeAssignment('580.00');

    await expect(
      svc.create({ ...base, method: FeePaymentMethod.mobile_money, amount: '10.00' }, 'u1', 's1'),
    ).rejects.toThrow(/must name the network/);
  });

  it('refuses a network on anything that is not mobile money', async () => {
    const svc = await make(FeePaymentsService);
    arrangeAssignment('580.00');

    await expect(
      svc.create({ ...base, providerCode: 'MTN', amount: '10.00' } as any, 'u1', 's1'),
    ).rejects.toThrow(/applies only to mobile money/);
  });

  it('404s an assignment that does not exist', async () => {
    const svc = await make(FeePaymentsService);
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await expect(svc.create({ ...base, amount: '10.00' }, 'u1', 's1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('payment reversal — a reversing entry, never an edit', () => {
  function arrangeOriginal(overrides: any = {}) {
    mockPrisma.feePayment.findFirst.mockImplementation(({ where }: any) => {
      if (where.reversesPaymentId) return Promise.resolve(null);
      return Promise.resolve({
        id: 'p1', schoolId: 's1', feeAssignmentId: 'a1', receiptNumber: 'RCT-00001',
        amount: d('300.00'), method: FeePaymentMethod.cash, providerCode: null,
        reference: null, paidOn: new Date('2026-09-10'), reversesPaymentId: null,
        ...overrides,
      });
    });
    mockPrisma.feePayment.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'p2', ...args.data }),
    );
  }

  it('writes a NEGATIVE row that names what it reverses', async () => {
    const svc = await make(FeePaymentsService);
    arrangeOriginal();

    const reversal = await svc.reverse('p1', { reason: 'Recorded against the wrong child' }, 'u1', 's1');

    expect(reversal.amount.toFixed(2)).toBe('-300.00');
    expect(reversal.reversesPaymentId).toBe('p1');
  });

  it('consumes NO receipt number — the original receipt still stands', async () => {
    const svc = await make(FeePaymentsService);
    arrangeOriginal();

    const reversal = await svc.reverse('p1', { reason: 'Recorded against the wrong child' }, 'u1', 's1');

    expect(reversal.receiptNumber).toBeNull();
    expect(mockPrisma.documentSequence.update).not.toHaveBeenCalled();
  });

  it('never edits or deletes the original', async () => {
    const svc = await make(FeePaymentsService);
    arrangeOriginal();

    await svc.reverse('p1', { reason: 'Recorded against the wrong child' }, 'u1', 's1');

    expect(mockPrisma.feePayment).not.toHaveProperty('update');
    expect(mockPrisma.feePayment).not.toHaveProperty('delete');
  });

  it('refuses to reverse a reversal', async () => {
    const svc = await make(FeePaymentsService);
    arrangeOriginal({ reversesPaymentId: 'p0', amount: d('-300.00') });

    await expect(
      svc.reverse('p2', { reason: 'Trying to reverse a reversal' }, 'u1', 's1'),
    ).rejects.toThrow(/itself a reversal/);
  });

  it('refuses to reverse the same payment twice', async () => {
    const svc = await make(FeePaymentsService);
    mockPrisma.feePayment.findFirst.mockImplementation(({ where }: any) =>
      where.reversesPaymentId
        ? Promise.resolve({ id: 'p9' })
        : Promise.resolve({
            id: 'p1', schoolId: 's1', receiptNumber: 'RCT-00001',
            amount: d('300.00'), reversesPaymentId: null,
          }),
    );

    await expect(
      svc.reverse('p1', { reason: 'Second attempt at the same reversal' }, 'u1', 's1'),
    ).rejects.toThrow(/already been reversed/);
  });
});

// ── the freeze guard ─────────────────────────────────────────────────────────

describe('the freeze guard — an issued invoice locks the amounts it covers', () => {
  it('REFUSES to change an amount that sits on a live invoice, naming it', async () => {
    const svc = await make(FeeAssignmentsService);
    mockPrisma.feeAssignment.findFirst.mockResolvedValue({
      id: 'a1', schoolId: 's1', amountDue: d('580.00'), payments: [],
    });
    mockPrisma.invoiceLine.findFirst.mockResolvedValue({
      id: 'l1', invoice: { id: 'i1', invoiceNumber: 'INV-00042' },
    });

    await expect(
      svc.update('a1', { amountDue: '650.00' }, 'u1', 's1'),
    ).rejects.toThrow(/on invoice INV-00042, so its amount is locked/);

    expect(mockPrisma.feeAssignment.update).not.toHaveBeenCalled();
  });

  it('ALLOWS the change once no live invoice covers it', async () => {
    const svc = await make(FeeAssignmentsService);
    mockPrisma.feeAssignment.findFirst.mockResolvedValue({
      id: 'a1', schoolId: 's1', amountDue: d('580.00'), payments: [],
    });
    // A cancelled invoice's lines are voided, so this finds nothing.
    mockPrisma.invoiceLine.findFirst.mockResolvedValue(null);
    mockPrisma.feeAssignment.update.mockResolvedValue({ id: 'a1', amountDue: d('650.00') });

    await expect(svc.update('a1', { amountDue: '650.00' }, 'u1', 's1')).resolves.toBeDefined();
  });

  it('refuses to reduce a bill below what has already been paid', async () => {
    const svc = await make(FeeAssignmentsService);
    mockPrisma.feeAssignment.findFirst.mockResolvedValue({
      id: 'a1', schoolId: 's1', amountDue: d('580.00'),
      payments: [{ amount: d('400.00') }],
    });
    mockPrisma.invoiceLine.findFirst.mockResolvedValue(null);

    // Reducing below what is paid would manufacture a credit, and credits are
    // deliberately not a concept here.
    await expect(
      svc.update('a1', { amountDue: '100.00' }, 'u1', 's1'),
    ).rejects.toThrow(/cannot be reduced/);
  });

  it('audits the before and after amounts', async () => {
    const svc = await make(FeeAssignmentsService);
    mockPrisma.feeAssignment.findFirst.mockResolvedValue({
      id: 'a1', schoolId: 's1', amountDue: d('580.00'), payments: [],
    });
    mockPrisma.invoiceLine.findFirst.mockResolvedValue(null);
    mockPrisma.feeAssignment.update.mockResolvedValue({ id: 'a1' });

    await svc.update('a1', { amountDue: '650.00' }, 'u1', 's1');

    expect(mockAuditLogs.create.mock.calls[0][0].changes).toEqual({
      before: { amountDue: '580.00' },
      after: { amountDue: '650.00' },
    });
  });
});

describe('the fee receipt fires AFTER the payment is committed', () => {
  const base = { feeAssignmentId: 'a1', method: FeePaymentMethod.cash, paidOn: '2026-09-10' };

  it('enqueues a receipt for a successful payment', async () => {
    const svc = await make(FeePaymentsService);
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'a1', amount_due: d('580.00') }]);
    mockPrisma.feePayment.findMany.mockResolvedValue([]);
    mockPrisma.feePayment.create.mockResolvedValue({ id: 'p1', receiptNumber: 'RCT-00001' });

    await svc.create({ ...base, amount: '100.00' }, 'u1', 's1');

    expect(mockTriggers.feeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 's1', feePaymentId: 'p1' }),
    );
  });

  it('does NOT enqueue when the payment was refused', async () => {
    const svc = await make(FeePaymentsService);
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'a1', amount_due: d('580.00') }]);
    mockPrisma.feePayment.findMany.mockResolvedValue([{ amount: d('580.00') }]);

    await expect(svc.create({ ...base, amount: '100.00' }, 'u1', 's1')).rejects.toBeDefined();
    // No payment, no receipt — and nothing to tell a parent about.
    expect(mockTriggers.feeReceipt).not.toHaveBeenCalled();
  });
});
