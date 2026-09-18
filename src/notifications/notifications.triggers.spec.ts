import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AttendanceStatus, NotificationTrigger, Prisma } from '@prisma/client';
import { NotificationsTriggers } from './notifications.triggers';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const d = (v: string) => new Prisma.Decimal(v);

const mockPrisma: any = {
  school: { findUnique: jest.fn() },
  classroom: { findFirst: jest.fn() },
  term: { findFirst: jest.fn() },
  enrollment: { findMany: jest.fn() },
  feeAssignment: { findMany: jest.fn() },
  feePayment: { findFirst: jest.fn() },
  attendanceRecord: { findMany: jest.fn() },
};
const mockNotifications = { enqueue: jest.fn(), dispatchBatch: jest.fn() };

async function makeTriggers(): Promise<NotificationsTriggers> {
  const module = await Test.createTestingModule({
    providers: [
      NotificationsTriggers,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: NotificationsService, useValue: mockNotifications },
    ],
  }).compile();
  return module.get(NotificationsTriggers);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.school.findUnique.mockResolvedValue({ id: 's1', name: 'Adom' });
  mockNotifications.enqueue.mockResolvedValue({ status: 'queued', id: 'n1' });
  mockNotifications.dispatchBatch.mockImplementation((reqs: any[]) =>
    Promise.resolve({ batchId: 'b1', requested: reqs.length, queued: reqs.length, suppressed: 0, duplicates: 0 }),
  );
});

// ── absence alerts ───────────────────────────────────────────────────────────

describe('absence alerts fire off the SESSION-LEVEL attendance record', () => {
  function arrange(records: any[]) {
    mockPrisma.classroom.findFirst.mockResolvedValue({
      id: 'c1', displayName: 'Basic 3A', level: { name: 'Basic 3' },
    });
    mockPrisma.attendanceRecord.findMany.mockResolvedValue(records);
  }

  const record = (
    id: string,
    studentId: string,
    morningStatus: AttendanceStatus = AttendanceStatus.absent,
    afternoonStatus: AttendanceStatus = morningStatus,
  ) => ({
    id, enrollmentId: `e-${id}`, morningStatus, afternoonStatus,
    enrollment: { studentId, student: { firstName: 'Ama', middleName: null, lastName: 'Boakye' } },
  });

  it('queries for EITHER session absent on that date and classroom', async () => {
    // Either-session rather than all-day: a child who went home at lunch is
    // exactly the case a parent wants to hear about, and it is the choice that
    // cannot under-report. For pre-Part-B rows, whose sessions were backfilled
    // equal, this selects precisely the same students the day-level condition
    // did.
    const t = await makeTriggers();
    arrange([record('r1', 'stu1')]);

    await t.absenceAlerts({ schoolId: 's1', classroomId: 'c1', date: '2026-09-18', actorUserId: 'u1' });

    const where = mockPrisma.attendanceRecord.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { morningStatus: AttendanceStatus.absent },
      { afternoonStatus: AttendanceStatus.absent },
    ]);
    expect(where.status).toBeUndefined();
    expect(where.enrollment).toMatchObject({ classroomId: 'c1', status: 'active' });
  });

  it('tells the parent WHICH sessions, so a half-day is not reported as a whole one', async () => {
    const t = await makeTriggers();
    arrange([
      record('r1', 'stu1', AttendanceStatus.absent, AttendanceStatus.absent),
      record('r2', 'stu2', AttendanceStatus.present, AttendanceStatus.absent),
      record('r3', 'stu3', AttendanceStatus.absent, AttendanceStatus.present),
    ]);

    await t.absenceAlerts({ schoolId: 's1', classroomId: 'c1', date: '2026-09-18', actorUserId: 'u1' });

    const requests = mockNotifications.dispatchBatch.mock.calls[0][0];
    expect(requests.map((r: any) => r.values.sessions)).toEqual([
      'all day', 'for the afternoon', 'for the morning',
    ]);
  });

  it('still sends ONE message for a child absent both sessions, not two', async () => {
    const t = await makeTriggers();
    arrange([record('r1', 'stu1', AttendanceStatus.absent, AttendanceStatus.absent)]);

    const result = await t.absenceAlerts({
      schoolId: 's1', classroomId: 'c1', date: '2026-09-18', actorUserId: 'u1',
    });

    expect(result.queued).toBe(1);
  });

  it('enqueues one alert per absent student, addressed by student', async () => {
    const t = await makeTriggers();
    arrange([record('r1', 'stu1'), record('r2', 'stu2')]);

    const result = await t.absenceAlerts({
      schoolId: 's1', classroomId: 'c1', date: '2026-09-18', actorUserId: 'u1',
    });

    expect(result.queued).toBe(2);
    const requests = mockNotifications.dispatchBatch.mock.calls[0][0];
    expect(requests.map((r: any) => r.studentId)).toEqual(['stu1', 'stu2']);
    expect(requests[0].trigger).toBe(NotificationTrigger.attendance_absence);
  });

  it('dedupes per child per day, so re-running after a correction does not re-send', async () => {
    const t = await makeTriggers();
    arrange([record('r1', 'stu1')]);

    await t.absenceAlerts({ schoolId: 's1', classroomId: 'c1', date: '2026-09-18', actorUserId: 'u1' });

    expect(mockNotifications.dispatchBatch.mock.calls[0][0][0].dedupeKey)
      .toBe('attendance_absence:e-r1:2026-09-18');
  });

  it('refuses when nobody is absent, rather than sending zero messages silently', async () => {
    const t = await makeTriggers();
    arrange([]);

    await expect(
      t.absenceAlerts({ schoolId: 's1', classroomId: 'c1', date: '2026-09-18', actorUserId: 'u1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('is an EXPLICIT action — nothing in the attendance save path calls it', async () => {
    // Firing on every `absent` upsert would mean firing while a teacher is
    // still marking: a mistyped row corrected ten seconds later would already
    // have cost money and alarmed a parent. `PUT /attendance/register`
    // therefore returns absentCount and this is the separate click.
    const attendanceService = require('fs').readFileSync(
      require('path').join(__dirname, '../attendance/attendance.service.ts'), 'utf8',
    );
    expect(attendanceService).not.toMatch(/absenceAlerts|NotificationsTriggers/);
  });
});

// ── fee receipt ──────────────────────────────────────────────────────────────

describe('fee receipt', () => {
  function arrangePayment(over: any = {}) {
    mockPrisma.feePayment.findFirst.mockResolvedValue({
      id: 'p1', receiptNumber: 'RCT-00001', amount: d('200.00'), reversesPaymentId: null,
      feeAssignment: {
        amountDue: d('500.00'),
        payments: [{ amount: d('200.00') }],
        schoolFee: { feeType: { name: 'Tuition' } },
        enrollment: { studentId: 'stu1', student: { firstName: 'Ama', middleName: null, lastName: 'Boakye' } },
      },
      ...over,
    });
  }

  it('enqueues a receipt with the amount, receipt number and remaining balance', async () => {
    const t = await makeTriggers();
    arrangePayment();

    await t.feeReceipt({ schoolId: 's1', feePaymentId: 'p1' });

    const req = mockNotifications.enqueue.mock.calls[0][0];
    expect(req.trigger).toBe(NotificationTrigger.fee_receipt);
    expect(req.values.amount).toBe('200.00');
    expect(req.values.receipt).toBe('RCT-00001');
    expect(req.values.outstanding).toBe('300.00');
  });

  it('does NOT send a receipt for a reversal — nobody was paid anything', async () => {
    const t = await makeTriggers();
    arrangePayment({ reversesPaymentId: 'p0', amount: d('-200.00') });

    await t.feeReceipt({ schoolId: 's1', feePaymentId: 'p1' });
    expect(mockNotifications.enqueue).not.toHaveBeenCalled();
  });

  it('dedupes per payment, so one payment can only ever produce one receipt', async () => {
    const t = await makeTriggers();
    arrangePayment();

    await t.feeReceipt({ schoolId: 's1', feePaymentId: 'p1' });
    expect(mockNotifications.enqueue.mock.calls[0][0].dedupeKey).toBe('fee_receipt:p1');
  });

  it('SWALLOWS its own failure — a notification must never unwind a payment', async () => {
    const t = await makeTriggers();
    arrangePayment();
    mockNotifications.enqueue.mockRejectedValue(new Error('outbox down'));

    // The payment is already committed. The caller must not learn otherwise
    // because a message could not be queued.
    await expect(t.feeReceipt({ schoolId: 's1', feePaymentId: 'p1' })).resolves.toBeUndefined();
  });
});

// ── fee reminders ────────────────────────────────────────────────────────────

describe('fee reminders', () => {
  function arrange(enrollments: any[], assignments: any[]) {
    mockPrisma.term.findFirst.mockResolvedValue({ id: 't1', label: 'Term 3', academicYearId: 'y1' });
    mockPrisma.enrollment.findMany.mockResolvedValue(enrollments);
    mockPrisma.feeAssignment.findMany.mockResolvedValue(assignments);
  }
  const enrollment = (id: string, studentId: string) => ({
    id, studentId, student: { firstName: 'Ama', middleName: null, lastName: 'Boakye' },
  });

  it('reminds ONLY students who actually owe something', async () => {
    const t = await makeTriggers();
    arrange(
      [enrollment('e1', 'stu1'), enrollment('e2', 'stu2')],
      [
        { enrollmentId: 'e1', amountDue: d('500.00'), payments: [{ amount: d('100.00') }] },
        { enrollmentId: 'e2', amountDue: d('500.00'), payments: [{ amount: d('500.00') }] },
      ],
    );

    const result = await t.feeReminders({ schoolId: 's1', termId: 't1', actorUserId: 'u1' });

    // Reminding a parent who has paid in full is a paid message that damages
    // trust.
    expect(result.queued).toBe(1);
    expect(mockNotifications.dispatchBatch.mock.calls[0][0][0].studentId).toBe('stu1');
  });

  it('carries the real outstanding figure into the message', async () => {
    const t = await makeTriggers();
    arrange(
      [enrollment('e1', 'stu1')],
      [{ enrollmentId: 'e1', amountDue: d('500.00'), payments: [{ amount: d('120.00') }] }],
    );

    await t.feeReminders({ schoolId: 's1', termId: 't1', actorUserId: 'u1' });
    expect(mockNotifications.dispatchBatch.mock.calls[0][0][0].values.outstanding).toBe('380.00');
  });

  it('counts a reversal, so a reversed payment puts the debt back', async () => {
    const t = await makeTriggers();
    arrange(
      [enrollment('e1', 'stu1')],
      [{
        enrollmentId: 'e1', amountDue: d('500.00'),
        payments: [{ amount: d('500.00') }, { amount: d('-500.00') }],
      }],
    );

    const result = await t.feeReminders({ schoolId: 's1', termId: 't1', actorUserId: 'u1' });
    expect(result.queued).toBe(1);
  });

  it('dedupes per student per term per DAY — a double click sends once', async () => {
    const t = await makeTriggers();
    arrange(
      [enrollment('e1', 'stu1')],
      [{ enrollmentId: 'e1', amountDue: d('500.00'), payments: [] }],
    );

    await t.feeReminders({ schoolId: 's1', termId: 't1', actorUserId: 'u1' });
    const today = new Date().toISOString().slice(0, 10);
    expect(mockNotifications.dispatchBatch.mock.calls[0][0][0].dedupeKey)
      .toBe(`fee_reminder:stu1:t1:${today}`);
  });

  it('sends nothing, and says so, when nobody owes anything', async () => {
    const t = await makeTriggers();
    arrange(
      [enrollment('e1', 'stu1')],
      [{ enrollmentId: 'e1', amountDue: d('500.00'), payments: [{ amount: d('500.00') }] }],
    );

    const result = await t.feeReminders({ schoolId: 's1', termId: 't1', actorUserId: 'u1' });
    expect(result.queued).toBe(0);
    expect(mockNotifications.dispatchBatch).not.toHaveBeenCalled();
  });

  it('refuses a selection matching no active enrolments', async () => {
    const t = await makeTriggers();
    arrange([], []);

    await expect(
      t.feeReminders({ schoolId: 's1', termId: 't1', actorUserId: 'u1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ── password reset ───────────────────────────────────────────────────────────

describe('password reset', () => {
  it('enqueues the token to the account holder', async () => {
    const t = await makeTriggers();
    await t.passwordReset({ schoolId: 's1', userId: 'u1', token: 'abc123', expiresInMinutes: 60 });

    const req = mockNotifications.enqueue.mock.calls[0][0];
    expect(req.trigger).toBe(NotificationTrigger.password_reset);
    expect(req.userId).toBe('u1');
    expect(req.values.token).toBe('abc123');
  });

  it('carries NO dedupeKey — a second, legitimate request must reach them', async () => {
    const t = await makeTriggers();
    await t.passwordReset({ schoolId: 's1', userId: 'u1', token: 'abc', expiresInMinutes: 60 });
    expect(mockNotifications.enqueue.mock.calls[0][0].dedupeKey).toBeUndefined();
  });

  it('swallows failure, so the response cannot vary and leak account existence', async () => {
    const t = await makeTriggers();
    mockNotifications.enqueue.mockRejectedValue(new Error('outbox down'));

    await expect(
      t.passwordReset({ schoolId: 's1', userId: 'u1', token: 'abc', expiresInMinutes: 60 }),
    ).resolves.toBeUndefined();
  });
});
