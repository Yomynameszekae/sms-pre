import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { FeesReportingService } from './fees-reporting.service';
import { PrismaService } from '../prisma/prisma.service';

const d = (v: string) => new Prisma.Decimal(v);

const mockPrisma: any = {
  student: { findFirst: jest.fn() },
  term: { findFirst: jest.fn() },
  level: { findFirst: jest.fn() },
  enrollment: { findMany: jest.fn() },
  feeAssignment: { findMany: jest.fn() },
};

async function makeService(): Promise<FeesReportingService> {
  const module = await Test.createTestingModule({
    providers: [FeesReportingService, { provide: PrismaService, useValue: mockPrisma }],
  }).compile();
  return module.get(FeesReportingService);
}

const TERM_2 = { id: 't2', label: 'Term 2', startDate: new Date('2026-05-01'), academicYearId: 'y1' };
const TERM_1 = { id: 't1', label: 'Term 1', startDate: new Date('2026-01-01') };
const TERM_3 = { id: 't3', label: 'Term 3', startDate: new Date('2026-09-01') };

/** An assignment as the bill loads it. */
function asg(id: string, termId: string, term: any, due: string, paid: string[] = []) {
  return {
    id,
    amountDue: d(due),
    payments: paid.map((p) => ({ amount: d(p) })),
    schoolFee: { termId, term, name: `Fee ${id}`, feeType: { name: 'Tuition' } },
    enrollment: { classroom: { displayName: 'Basic 3A' }, academicYear: { label: '2025/2026' } },
    createdAt: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.student.findFirst.mockResolvedValue({
    id: 'stu1', studentNumber: 'STU-0001', firstName: 'Ama', middleName: null, lastName: 'Boakye',
  });
  mockPrisma.term.findFirst.mockResolvedValue(TERM_2);
});

describe('arrears are COMPUTED, never rolled over', () => {
  it('unpaid earlier terms become broughtForward, not lines', async () => {
    const svc = await makeService();
    mockPrisma.feeAssignment.findMany.mockResolvedValue([
      asg('a1', 't1', TERM_1, '400.00'),              // Term 1, unpaid
      asg('a2', 't2', TERM_2, '580.00', ['200.00']),  // Term 2, part paid
    ]);

    const bill = await svc.bill('stu1', 't2', 's1');

    // Only this term's fees are lines. The prior debt is a figure.
    expect(bill.lines).toHaveLength(1);
    expect(bill.lines[0].feeAssignmentId).toBe('a2');
    expect(bill.broughtForward).toBe('400.00');
    expect(bill.currentTermDue).toBe('580.00');
    expect(bill.currentTermOutstanding).toBe('380.00');
    expect(bill.totalDue).toBe('780.00');
  });

  it('there is no synthetic "arrears" assignment anywhere', async () => {
    const svc = await makeService();
    mockPrisma.feeAssignment.findMany.mockResolvedValue([
      asg('a1', 't1', TERM_1, '400.00'),
      asg('a2', 't2', TERM_2, '580.00'),
    ]);

    const bill = await svc.bill('stu1', 't2', 's1');

    // (b) balance-transfer carry-forward would manufacture a financial record
    // duplicating real ones and need a rollover job Brite has no scheduler for.
    expect(bill.lines.every((l: any) => !/arrears/i.test(l.name))).toBe(true);
  });

  it('a settled earlier term contributes nothing', async () => {
    const svc = await makeService();
    mockPrisma.feeAssignment.findMany.mockResolvedValue([
      asg('a1', 't1', TERM_1, '400.00', ['400.00']),
      asg('a2', 't2', TERM_2, '580.00'),
    ]);

    const bill = await svc.bill('stu1', 't2', 's1');
    expect(bill.broughtForward).toBe('0.00');
    expect(bill.totalDue).toBe('580.00');
  });

  it('a LATER term is not arrears', async () => {
    const svc = await makeService();
    mockPrisma.feeAssignment.findMany.mockResolvedValue([
      asg('a2', 't2', TERM_2, '580.00'),
      asg('a3', 't3', TERM_3, '600.00'), // next term, already set up
    ]);

    const bill = await svc.bill('stu1', 't2', 's1');

    // Billing next term's fees as this term's arrears would be nonsense.
    expect(bill.broughtForward).toBe('0.00');
    expect(bill.lines).toHaveLength(1);
  });

  it('never reports a NEGATIVE brought-forward', async () => {
    const svc = await makeService();
    // Over-collection cannot normally happen, but a reversal ordering could
    // produce it transiently; a bill must never show a negative debt.
    mockPrisma.feeAssignment.findMany.mockResolvedValue([
      asg('a1', 't1', TERM_1, '400.00', ['400.00', '50.00']),
      asg('a2', 't2', TERM_2, '580.00'),
    ]);

    const bill = await svc.bill('stu1', 't2', 's1');
    expect(bill.broughtForward).toBe('0.00');
  });

  it('arrears follow the STUDENT across years, because the query anchors on studentId', async () => {
    const svc = await makeService();
    mockPrisma.feeAssignment.findMany.mockResolvedValue([asg('a2', 't2', TERM_2, '580.00')]);

    await svc.bill('stu1', 't2', 's1');

    expect(mockPrisma.feeAssignment.findMany.mock.calls[0][0].where).toMatchObject({
      enrollment: { studentId: 'stu1' },
    });
  });

  it('a reversal in an earlier term restores that term to arrears', async () => {
    const svc = await makeService();
    mockPrisma.feeAssignment.findMany.mockResolvedValue([
      asg('a1', 't1', TERM_1, '400.00', ['400.00', '-400.00']),
      asg('a2', 't2', TERM_2, '580.00'),
    ]);

    const bill = await svc.bill('stu1', 't2', 's1');
    expect(bill.broughtForward).toBe('400.00');
  });
});

describe('level billing summary', () => {
  function arrange(students: any[], assignments: any[], prior: any[] = []) {
    mockPrisma.level.findFirst.mockResolvedValue({ id: 'lv1', name: 'Basic 3' });
    mockPrisma.term.findFirst.mockResolvedValue(TERM_2);
    mockPrisma.enrollment.findMany.mockResolvedValue(students);
    let call = 0;
    mockPrisma.feeAssignment.findMany.mockImplementation(() =>
      Promise.resolve(call++ === 0 ? assignments : prior),
    );
  }

  const query = { levelId: 'lv1', academicYearId: 'y1', termId: 't2' };
  const student = (id: string, name: string) => ({
    id: `enr-${id}`, studentId: id,
    student: { id, studentNumber: `STU-${id}`, firstName: name, middleName: null, lastName: 'Test' },
    classroom: { displayName: 'Basic 3A' },
  });

  it('counts students with NO fees as unassigned — the reconcile safety net', async () => {
    const svc = await makeService();
    arrange(
      [student('1', 'Ama'), student('2', 'Kofi'), student('3', 'Esi')],
      [{ ...asg('a1', 't2', TERM_2, '580.00'), enrollmentId: 'enr-1' }],
    );

    const summary = await svc.levelSummary(query, 's1');

    // A reconcile nobody remembers to run is a silent revenue hole; this
    // number is what stops it being silent.
    expect(summary.studentCount).toBe(3);
    expect(summary.unassignedStudentCount).toBe(2);
  });

  it('is zero when everyone is assigned', async () => {
    const svc = await makeService();
    arrange(
      [student('1', 'Ama')],
      [{ ...asg('a1', 't2', TERM_2, '580.00'), enrollmentId: 'enr-1' }],
    );

    expect((await svc.levelSummary(query, 's1')).unassignedStudentCount).toBe(0);
  });

  it('a student with no fees has a null payment state, not "pending"', async () => {
    const svc = await makeService();
    arrange([student('1', 'Ama')], []);

    const summary = await svc.levelSummary(query, 's1');
    // "Pending" would imply a bill exists and is unpaid; none exists.
    expect(summary.students[0].paymentState).toBeNull();
  });

  it('totals the level in three columns', async () => {
    const svc = await makeService();
    arrange(
      [student('1', 'Ama'), student('2', 'Kofi')],
      [
        { ...asg('a1', 't2', TERM_2, '580.00', ['580.00']), enrollmentId: 'enr-1' },
        { ...asg('a2', 't2', TERM_2, '580.00', ['200.00']), enrollmentId: 'enr-2' },
      ],
    );

    const summary = await svc.levelSummary(query, 's1');
    expect(summary.totals).toEqual({
      billed: '1160.00', collected: '780.00', outstanding: '380.00',
    });
  });

  it('refuses a term from a different academic year', async () => {
    const svc = await makeService();
    arrange([], []);
    mockPrisma.term.findFirst.mockResolvedValue({ ...TERM_2, academicYearId: 'OTHER' });

    await expect(svc.levelSummary(query, 's1')).rejects.toThrow(
      /does not belong to the selected academic year/,
    );
  });
});
