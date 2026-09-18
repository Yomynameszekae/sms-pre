import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';

/**
 * Attendance is the first module in Brite with row-level authorisation, and
 * the first with a write gate that depends on the audit trail (the OQ-7
 * reopen). Both are tested here, along with the idempotent create-and-amend
 * path that keeps `audit_logs` readable.
 */
const mockPrisma: any = {
  classroom: { findFirst: jest.fn(), findMany: jest.fn() },
  user: { findUnique: jest.fn() },
  userRole: { findFirst: jest.fn() },
  enrollment: { findMany: jest.fn(), findFirst: jest.fn() },
  attendanceRecord: { findMany: jest.fn(), upsert: jest.fn() },
  term: { findFirst: jest.fn() },
  auditLog: { findFirst: jest.fn() },
  student: { findFirst: jest.fn() },
  $transaction: jest.fn((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
};
const mockAuditLogs = { create: jest.fn() };

// The demo/test clock: every date below sits inside ACTIVE_TERM and in the
// past relative to it, so nothing here depends on the real calendar except
// the deliberate future-date test.
const TODAY = new Date().toISOString().slice(0, 10);
const PAST = '2020-05-14';
const FUTURE = '2999-01-01';

const ACTIVE_TERM = {
  id: 't1', schoolId: 's1', academicYearId: 'y1', label: 'Term 3',
  status: 'active', startDate: new Date('2020-01-01T00:00:00Z'),
  endDate: new Date('2020-12-31T00:00:00Z'), termNumber: 3,
};
const CLOSED_TERM = { ...ACTIVE_TERM, id: 't2', label: 'Term 1', status: 'closed' };
const DRAFT_TERM = { ...ACTIVE_TERM, id: 't3', label: 'Term 1', status: 'draft' };

const CLASSROOM = {
  id: 'c1', schoolId: 's1', displayName: 'Basic 3A', classTeacherId: 'staff-owner',
  academicYearId: 'y1',
  level: { name: 'Basic 3', orderIndex: 3 },
  academicYear: { id: 'y1', label: '2025/2026' },
};

function user(permissions: string[], sub = 'u1'): JwtPayload {
  return { sub, schoolId: 's1', sessionId: 'sess1', permissions };
}

const TEACHER = user(['attendance.read', 'attendance.mark'], 'u-teacher');
const ADMIN = user(['attendance.read_any', 'attendance.mark_any'], 'u-admin');

async function makeService(): Promise<AttendanceService> {
  const module = await Test.createTestingModule({
    providers: [
      AttendanceService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AuditLogsService, useValue: mockAuditLogs },
    ],
  }).compile();
  return module.get(AttendanceService);
}

/** The happy-path fixture: one classroom, one active enrollment, no records. */
function arrangeRegister({
  term = ACTIVE_TERM,
  records = [] as any[],
  linkedStaffId = 'staff-owner',
} = {}) {
  mockPrisma.classroom.findFirst.mockResolvedValue(CLASSROOM);
  mockPrisma.user.findUnique.mockResolvedValue({
    linkedEntityType: 'staff', linkedEntityId: linkedStaffId,
  });
  mockPrisma.enrollment.findMany.mockResolvedValue([
    { id: 'e1', student: { id: 'stu1', studentNumber: 'STU-0001', firstName: 'Ama', lastName: 'Boakye', middleName: null } },
  ]);
  mockPrisma.attendanceRecord.findMany.mockResolvedValue(records);
  mockPrisma.term.findFirst.mockResolvedValue(term);
  mockPrisma.attendanceRecord.upsert.mockImplementation((args: any) => args);
  mockPrisma.auditLog.findFirst.mockResolvedValue(null);
}

beforeEach(() => jest.clearAllMocks());

// ── row-level authorisation ───────────────────────────────────────────────────

describe('row-level authorisation', () => {
  it('a class teacher may mark their own classroom', async () => {
    const svc = await makeService();
    arrangeRegister({ linkedStaffId: 'staff-owner' });

    await expect(
      svc.markRegister(TEACHER, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).resolves.toBeDefined();
  });

  it("403s a teacher marking another teacher's classroom", async () => {
    const svc = await makeService();
    arrangeRegister({ linkedStaffId: 'staff-someone-else' });

    await expect(
      svc.markRegister(TEACHER, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
  });

  it("403s a teacher READING another teacher's register", async () => {
    const svc = await makeService();
    arrangeRegister({ linkedStaffId: 'staff-someone-else' });

    await expect(
      svc.getRegister(TEACHER, { classroomId: 'c1', date: PAST }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the _any variant bypasses the ownership check entirely', async () => {
    const svc = await makeService();
    arrangeRegister({ linkedStaffId: 'staff-someone-else' });

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).resolves.toBeDefined();

    // The bypass is total: an _any holder never needs a linked staff row, so
    // the lookup must not even happen.
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('403s a guardian login, which has no linked staff row at all', async () => {
    const svc = await makeService();
    arrangeRegister();
    mockPrisma.user.findUnique.mockResolvedValue({
      linkedEntityType: 'guardian', linkedEntityId: 'g1',
    });

    await expect(
      svc.getRegister(TEACHER, { classroomId: 'c1', date: PAST }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses enrollment ids belonging to another classroom', async () => {
    const svc = await makeService();
    arrangeRegister();
    // The roster lookup returns nothing for the smuggled id.
    mockPrisma.enrollment.findMany.mockResolvedValueOnce([]);

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e-from-another-class', status: AttendanceStatus.present }],
      }),
    ).rejects.toThrow(/active enrollment in 'Basic 3A'/);
  });
});

// ── create and amend ──────────────────────────────────────────────────────────

describe('mark register — idempotent create and amend', () => {
  it('creates on first save and audits attendance.marked', async () => {
    const svc = await makeService();
    arrangeRegister({ records: [] });

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
    });

    expect(result.createdCount).toBe(1);
    expect(result.amendedCount).toBe(0);
    const actions = mockAuditLogs.create.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['attendance.marked']);
  });

  it('re-saving an unchanged register writes nothing and audits nothing', async () => {
    const svc = await makeService();
    const existing = {
      id: 'r1', enrollmentId: 'e1',
        morningStatus: AttendanceStatus.present, morningReason: null,
        afternoonStatus: AttendanceStatus.present, afternoonReason: null,
      createdAt: new Date('2020-05-14T08:00:00Z'), updatedAt: new Date('2020-05-14T08:00:00Z'),
    };
    arrangeRegister({ records: [existing] });

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
    });

    expect(result.createdCount).toBe(0);
    expect(result.amendedCount).toBe(0);
    expect(result.unchangedCount).toBe(1);
    expect(mockPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
    expect(mockAuditLogs.create).not.toHaveBeenCalled();
  });

  it('amends a changed status and audits before/after', async () => {
    const svc = await makeService();
    arrangeRegister({
      records: [{
        id: 'r1', enrollmentId: 'e1',
        morningStatus: AttendanceStatus.absent, morningReason: null,
        afternoonStatus: AttendanceStatus.absent, afternoonReason: null,
        createdAt: new Date('2020-05-14T08:00:00Z'), updatedAt: new Date('2020-05-14T08:00:00Z'),
      }],
    });

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{ enrollmentId: 'e1', status: AttendanceStatus.late, reason: 'Arrived at 09:10' }],
    });

    expect(result.amendedCount).toBe(1);
    const entry = mockAuditLogs.create.mock.calls.find(
      (c) => c[0].action === 'attendance.amended',
    )?.[0];
    // All four fields on BOTH sides, not a diff — a reader must be able to see
    // that the morning moved and the afternoon followed without reconstructing it.
    expect(entry.changes.before[0]).toEqual({
      enrollmentId: 'e1',
      morningStatus: 'absent', morningReason: null,
      afternoonStatus: 'absent', afternoonReason: null,
    });
    expect(entry.changes.after[0]).toEqual({
      enrollmentId: 'e1',
      morningStatus: 'late', morningReason: 'Arrived at 09:10',
      afternoonStatus: 'late', afternoonReason: 'Arrived at 09:10',
    });
    expect(entry.metadata.sessions).toEqual(['morning', 'afternoon']);
  });

  it('treats a reason-only edit as an amendment', async () => {
    const svc = await makeService();
    arrangeRegister({
      records: [{
        id: 'r1', enrollmentId: 'e1',
        morningStatus: AttendanceStatus.excused, morningReason: 'Sick',
        afternoonStatus: AttendanceStatus.excused, afternoonReason: 'Sick',
        createdAt: new Date('2020-05-14T08:00:00Z'), updatedAt: new Date('2020-05-14T08:00:00Z'),
      }],
    });

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{ enrollmentId: 'e1', status: AttendanceStatus.excused, reason: 'Medical appointment' }],
    });

    expect(result.amendedCount).toBe(1);
  });

  it('rejects the same student appearing twice in one payload', async () => {
    const svc = await makeService();
    arrangeRegister();

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [
          { enrollmentId: 'e1', status: AttendanceStatus.present },
          { enrollmentId: 'e1', status: AttendanceStatus.absent },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ── date and term gating ──────────────────────────────────────────────────────

describe('mark register — date and term gating', () => {
  it('rejects a future date', async () => {
    const svc = await makeService();
    arrangeRegister();

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: FUTURE,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).rejects.toThrow(/future date/i);
  });

  it('accepts today', async () => {
    const svc = await makeService();
    arrangeRegister({
      term: {
        ...ACTIVE_TERM,
        startDate: new Date('2000-01-01T00:00:00Z'),
        endDate: new Date('2999-12-31T00:00:00Z'),
      },
    });

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: TODAY,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).resolves.toBeDefined();
  });

  it('allows back-dating inside the active term without limit', async () => {
    const svc = await makeService();
    arrangeRegister();

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: '2020-01-02',
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a date no term covers', async () => {
    const svc = await makeService();
    arrangeRegister({ term: null as any });
    mockPrisma.term.findFirst.mockResolvedValue(null);

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).rejects.toThrow(/No term of 2025\/2026 covers/);
  });

  it('rejects a draft term — the term has not begun', async () => {
    const svc = await makeService();
    arrangeRegister({ term: DRAFT_TERM });

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).rejects.toThrow(/has not started yet/);
  });

  it('rejects a closed term', async () => {
    const svc = await makeService();
    arrangeRegister({ term: CLOSED_TERM });

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).rejects.toThrow(/is closed. A Super Admin must reopen it/);
  });
});

// ── OQ-7: reopen ──────────────────────────────────────────────────────────────

describe('term reopen (OQ-7 guarded reversal)', () => {
  const SUPER = user(['attendance.mark_any'], 'u-super');

  function asSuperAdmin(is = true) {
    mockPrisma.userRole.findFirst.mockResolvedValue(is ? { id: 'ur1' } : null);
  }

  it('403s a non-SUPER_ADMIN even with attendance.mark_any', async () => {
    const svc = await makeService();
    asSuperAdmin(false);
    mockPrisma.term.findFirst.mockResolvedValue(CLOSED_TERM);

    await expect(
      svc.reopenTerm(ADMIN, 't2', { reason: 'Correcting a March register error' }),
    ).rejects.toThrow(/Only a Super Admin/);

    // The role check must run BEFORE anything else happens.
    expect(mockAuditLogs.create).not.toHaveBeenCalled();
  });

  it('409s on a term that is not closed', async () => {
    const svc = await makeService();
    asSuperAdmin();
    mockPrisma.term.findFirst.mockResolvedValue(ACTIVE_TERM);

    await expect(
      svc.reopenTerm(SUPER, 't1', { reason: 'Correcting a March register error' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('writes attendance.term_reopened carrying the reason and the actor', async () => {
    const svc = await makeService();
    asSuperAdmin();
    mockPrisma.term.findFirst.mockResolvedValue(CLOSED_TERM);
    mockPrisma.auditLog.findFirst.mockResolvedValue(null); // not already reopened

    const result = await svc.reopenTerm(
      SUPER, 't2', { reason: 'Term 1 register had a transcription error on 3 Oct' }, 'req-1',
    );

    expect(result.registerAmendable).toBe(true);
    const entry = mockAuditLogs.create.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'attendance.term_reopened',
      module: 'attendance',
      entityType: 'term',
      entityId: 't2',
      userId: 'u-super',
      requestId: 'req-1',
    });
    expect(entry.metadata.reason).toBe('Term 1 register had a transcription error on 3 Oct');
  });

  it('does NOT change Term.status — that would collide with the one-active-term index', async () => {
    const svc = await makeService();
    asSuperAdmin();
    mockPrisma.term.findFirst.mockResolvedValue(CLOSED_TERM);
    mockPrisma.auditLog.findFirst.mockResolvedValue(null);

    const result = await svc.reopenTerm(SUPER, 't2', { reason: 'Correcting a register error' });

    expect(result.status).toBe('closed');
    expect(mockPrisma.term).not.toHaveProperty('update');
  });

  it('refuses to reopen a term that is already reopened', async () => {
    const svc = await makeService();
    asSuperAdmin();
    mockPrisma.term.findFirst.mockResolvedValue(CLOSED_TERM);
    // isReopened(): a reopen entry newer than the close entry.
    mockPrisma.auditLog.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.action === 'attendance.term_reopened'
          ? { createdAt: new Date('2026-02-01T00:00:00Z') }
          : { createdAt: new Date('2026-01-01T00:00:00Z') },
      ),
    );

    await expect(
      svc.reopenTerm(SUPER, 't2', { reason: 'Correcting a register error' }),
    ).rejects.toThrow(/already been reopened/);
  });

  it('a reopened closed term accepts amendments through the normal path', async () => {
    const svc = await makeService();
    arrangeRegister({ term: CLOSED_TERM });
    mockPrisma.auditLog.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.action === 'attendance.term_reopened'
          ? { createdAt: new Date('2026-02-01T00:00:00Z') }
          : { createdAt: new Date('2026-01-01T00:00:00Z') },
      ),
    );

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).resolves.toBeDefined();
  });

  it('closing the term again re-locks it: a newer terms.closed outranks the reopen', async () => {
    const svc = await makeService();
    arrangeRegister({ term: CLOSED_TERM });
    mockPrisma.auditLog.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.action === 'attendance.term_reopened'
          ? { createdAt: new Date('2026-02-01T00:00:00Z') }
          : { createdAt: new Date('2026-03-01T00:00:00Z') }, // closed AFTER the reopen
      ),
    );

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).rejects.toThrow(/is closed/);
  });

  it('reopens a term that has NO terms.closed entry — the seeded/legacy case', async () => {
    // Terms that reached `closed` without passing through TermsService.close()
    // have no `terms.closed` audit entry at all: seed-demo.ts writes the status
    // directly, and so would any term closed before that action existed. The
    // tie-break must not require a close entry to compare against — with none,
    // any reopen is by definition the latest word.
    const svc = await makeService();
    arrangeRegister({ term: CLOSED_TERM });
    mockPrisma.auditLog.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.action === 'attendance.term_reopened'
          ? { createdAt: new Date('2026-02-01T00:00:00Z') }
          : null, // no terms.closed entry has ever been written for this term
      ),
    );

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).resolves.toBeDefined();
  });

  it('a term with no audit history at all stays locked (default deny)', async () => {
    const svc = await makeService();
    arrangeRegister({ term: CLOSED_TERM });
    mockPrisma.auditLog.findFirst.mockResolvedValue(null);

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: PAST,
        marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
      }),
    ).rejects.toThrow(/is closed/);
  });
});

// ── register view ─────────────────────────────────────────────────────────────

describe('register view', () => {
  it('renders an unmarked student as status null, not a stored sentinel', async () => {
    const svc = await makeService();
    arrangeRegister({ records: [] });

    const view = await svc.getRegister(ADMIN, { classroomId: 'c1', date: PAST });

    expect(view.rows[0].morningStatus).toBeNull();
    expect(view.rows[0].afternoonStatus).toBeNull();
    expect(view.unmarkedCount).toBe(1);
  });

  it('flags an amended row via updatedAt > createdAt', async () => {
    const svc = await makeService();
    arrangeRegister({
      records: [{
        id: 'r1', enrollmentId: 'e1',
        morningStatus: AttendanceStatus.present, morningReason: null,
        afternoonStatus: AttendanceStatus.present, afternoonReason: null,
        createdAt: new Date('2020-05-14T08:00:00Z'),
        updatedAt: new Date('2020-05-14T09:30:00Z'),
      }],
    });

    const view = await svc.getRegister(ADMIN, { classroomId: 'c1', date: PAST });
    expect(view.rows[0].amended).toBe(true);
  });

  it('reports a closed term as not editable, with the reason', async () => {
    const svc = await makeService();
    arrangeRegister({ term: CLOSED_TERM });

    const view = await svc.getRegister(ADMIN, { classroomId: 'c1', date: PAST });
    expect(view.editable).toBe(false);
    expect(view.lockReason).toMatch(/is closed/);
  });

  it('reports a future date as not editable', async () => {
    const svc = await makeService();
    arrangeRegister({
      term: {
        ...ACTIVE_TERM,
        startDate: new Date('2000-01-01T00:00:00Z'),
        endDate: new Date('2999-12-31T00:00:00Z'),
      },
    });

    const view = await svc.getRegister(ADMIN, { classroomId: 'c1', date: FUTURE });
    expect(view.editable).toBe(false);
    expect(view.lockReason).toMatch(/future date/);
  });
});

// ── session-level marking ─────────────────────────────────────────────────────

/** The record the upsert would have written, pulled off the mock. */
function upsertedValues() {
  const args = mockPrisma.attendanceRecord.upsert.mock.calls[0][0];
  return args.create;
}

describe('session-level marking', () => {
  it('an OMITTED afternoon mirrors the morning on CREATE', async () => {
    const svc = await makeService();
    arrangeRegister();

    await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{ enrollmentId: 'e1', status: AttendanceStatus.late, reason: 'Arrived 09:10' }],
    });

    expect(upsertedValues()).toMatchObject({
      morningStatus: AttendanceStatus.late, morningReason: 'Arrived 09:10',
      afternoonStatus: AttendanceStatus.late, afternoonReason: 'Arrived 09:10',
    });
  });

  it('a PRESENT afternoon is set independently of the morning', async () => {
    const svc = await makeService();
    arrangeRegister();

    await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{
        enrollmentId: 'e1',
        status: AttendanceStatus.present,
        afternoon: { status: AttendanceStatus.absent, reason: 'Collected after lunch' },
      }],
    });

    expect(upsertedValues()).toMatchObject({
      morningStatus: AttendanceStatus.present, morningReason: null,
      afternoonStatus: AttendanceStatus.absent, afternoonReason: 'Collected after lunch',
    });
  });

  it('an afternoon with no reason of its own does NOT inherit the morning note', async () => {
    // A note explains the session that deviated. Copying a morning "Sick" onto
    // an afternoon the child attended would assert something nobody recorded.
    const svc = await makeService();
    arrangeRegister();

    await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{
        enrollmentId: 'e1',
        status: AttendanceStatus.absent, reason: 'Sick',
        afternoon: { status: AttendanceStatus.present },
      }],
    });

    expect(upsertedValues()).toMatchObject({
      morningStatus: AttendanceStatus.absent, morningReason: 'Sick',
      afternoonStatus: AttendanceStatus.present, afternoonReason: null,
    });
  });

  it('an afternoon-only change is an amendment, and the audit names the session', async () => {
    const svc = await makeService();
    arrangeRegister({
      records: [{
        id: 'r1', enrollmentId: 'e1',
        morningStatus: AttendanceStatus.present, morningReason: null,
        afternoonStatus: AttendanceStatus.present, afternoonReason: null,
        createdAt: new Date('2020-05-14T08:00:00Z'), updatedAt: new Date('2020-05-14T08:00:00Z'),
      }],
    });

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{
        enrollmentId: 'e1',
        status: AttendanceStatus.present,
        afternoon: { status: AttendanceStatus.absent, reason: 'Left after lunch — clinic' },
      }],
    });

    expect(result.amendedCount).toBe(1);
    const entry = mockAuditLogs.create.mock.calls.find(
      (c) => c[0].action === 'attendance.amended',
    )?.[0];
    // Morning identical on both sides, afternoon differing.
    expect(entry.changes.before[0].morningStatus).toBe('present');
    expect(entry.changes.after[0].morningStatus).toBe('present');
    expect(entry.changes.after[0].afternoonStatus).toBe('absent');
    // ONLY the afternoon is named — this is what makes "afternoon corrections
    // this term" a query rather than a scan.
    expect(entry.metadata.sessions).toEqual(['afternoon']);
  });

  it('re-sending an identical row including its afternoon writes and audits nothing', async () => {
    const svc = await makeService();
    arrangeRegister({
      records: [{
        id: 'r1', enrollmentId: 'e1',
        morningStatus: AttendanceStatus.present, morningReason: null,
        afternoonStatus: AttendanceStatus.absent, afternoonReason: 'Clinic',
        createdAt: new Date('2020-05-14T08:00:00Z'), updatedAt: new Date('2020-05-14T08:00:00Z'),
      }],
    });

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{
        enrollmentId: 'e1', status: AttendanceStatus.present,
        afternoon: { status: AttendanceStatus.absent, reason: 'Clinic' },
      }],
    });

    expect(result.unchangedCount).toBe(1);
    expect(mockPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
    expect(mockAuditLogs.create).not.toHaveBeenCalled();
  });

  it('THE FOOTGUN: omitting a previously-set afternoon RESETS it, and says so via amendedCount', async () => {
    // Documented on RegisterMarkDto.afternoon. "Omitted means mirror" applies
    // on amend too, so a client that sends a partial patch loses the afternoon
    // it set earlier. This test exists so the behaviour cannot change by
    // accident, in either direction — if someone later makes omission mean
    // "preserve", this fails and they have to justify it.
    const svc = await makeService();
    arrangeRegister({
      records: [{
        id: 'r1', enrollmentId: 'e1',
        morningStatus: AttendanceStatus.present, morningReason: null,
        afternoonStatus: AttendanceStatus.absent, afternoonReason: 'Left at lunch',
        createdAt: new Date('2020-05-14T08:00:00Z'), updatedAt: new Date('2020-05-14T08:00:00Z'),
      }],
    });

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{ enrollmentId: 'e1', status: AttendanceStatus.present }],
    });

    expect(upsertedValues()).toMatchObject({
      afternoonStatus: AttendanceStatus.present,
      afternoonReason: null,
    });
    // Visible in the same request rather than discovered at term end.
    expect(result.amendedCount).toBe(1);
  });

  it('absentCount is over SESSIONS, so a half-day counts once', async () => {
    const svc = await makeService();
    arrangeRegister();

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{
        enrollmentId: 'e1', status: AttendanceStatus.present,
        afternoon: { status: AttendanceStatus.absent },
      }],
    });

    expect(result.absentCount).toBe(1);
  });

  it('an all-day absence counts twice in absentCount', async () => {
    const svc = await makeService();
    arrangeRegister();

    const result = await svc.markRegister(ADMIN, {
      classroomId: 'c1', date: PAST,
      marks: [{ enrollmentId: 'e1', status: AttendanceStatus.absent }],
    });

    expect(result.absentCount).toBe(2);
  });

  it('Stage 1a validation still applies to the ROW, not per session', async () => {
    // A future date is refused before any session is looked at.
    const svc = await makeService();
    arrangeRegister();

    await expect(
      svc.markRegister(ADMIN, {
        classroomId: 'c1', date: FUTURE,
        marks: [{
          enrollmentId: 'e1', status: AttendanceStatus.present,
          afternoon: { status: AttendanceStatus.present },
        }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
  });
});

// ── the printable register grid ───────────────────────────────────────────────

describe('classroomRegisterGrid', () => {
  function arrangeGrid(records: any[] = []) {
    arrangeRegister();
    mockPrisma.term.findFirst.mockResolvedValue(ACTIVE_TERM);
    mockPrisma.school = { findFirst: jest.fn().mockResolvedValue({ name: 'Brite Academy' }) };
    mockPrisma.attendanceRecord.findMany.mockResolvedValue(records);
  }

  const REC = (date: string, am: AttendanceStatus, pm: AttendanceStatus) => ({
    enrollmentId: 'e1',
    attendanceDate: new Date(`${date}T00:00:00Z`),
    morningStatus: am,
    afternoonStatus: pm,
  });

  it('builds a cell per marked date and summarises with the SAME rule as the term summary', async () => {
    const svc = await makeService();
    arrangeGrid([
      REC('2020-05-11', AttendanceStatus.present, AttendanceStatus.present),
      REC('2020-05-12', AttendanceStatus.present, AttendanceStatus.absent),
    ]);

    const grid = await svc.classroomRegisterGrid(ADMIN, { classroomId: 'c1', termId: 't1' });

    expect(grid.dates).toEqual(['2020-05-11', '2020-05-12']);
    expect(grid.rows[0].cells['2020-05-12']).toEqual({
      am: AttendanceStatus.present, pm: AttendanceStatus.absent,
    });
    expect(grid.rows[0].summary.sessionsMarked).toBe(4);
    expect(grid.rows[0].summary.sessionsPresent).toBe(3);
    expect(grid.rows[0].summary.daysPartial).toBe(1);
    expect(grid.totals.attendanceRate).toBe(75);
  });

  it('only MARKED dates become columns — an unmarked day is not a column of blanks', async () => {
    // Brite has no school calendar and cannot tell a holiday from a day
    // nobody marked, so it must not print either as a column.
    const svc = await makeService();
    arrangeGrid([REC('2020-05-11', AttendanceStatus.present, AttendanceStatus.present)]);

    const grid = await svc.classroomRegisterGrid(ADMIN, { classroomId: 'c1', termId: 't1' });

    expect(grid.dates).toEqual(['2020-05-11']);
  });

  it('clamps the requested range INTO the term', async () => {
    // A sheet headed with a term must not contain a date outside it.
    const svc = await makeService();
    arrangeGrid([]);

    const grid = await svc.classroomRegisterGrid(ADMIN, {
      classroomId: 'c1', termId: 't1', from: '2019-01-01', to: '2099-12-31',
    });

    expect(grid.range).toEqual({ from: '2020-01-01', to: '2020-12-31' });
  });

  it('400s on a range that lands entirely outside the term', async () => {
    const svc = await makeService();
    arrangeGrid([]);

    await expect(
      svc.classroomRegisterGrid(ADMIN, {
        classroomId: 'c1', termId: 't1', from: '2021-01-01', to: '2021-06-30',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies the SAME row-level authorisation as every other read', async () => {
    const svc = await makeService();
    arrangeGrid([]);
    mockPrisma.user.findUnique.mockResolvedValue({
      linkedEntityType: 'staff', linkedEntityId: 'staff-someone-else',
    });

    await expect(
      svc.classroomRegisterGrid(TEACHER, { classroomId: 'c1', termId: 't1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
