import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  EnrollmentStatus,
  LinkedEntityType,
  Prisma,
  Term,
  TermStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { MarkRegisterDto } from './dto/mark-register.dto';
import { QueryRegisterDto } from './dto/query-register.dto';
import { QueryRegisterGridDto } from './dto/query-register-grid.dto';
import { ReopenTermDto } from './dto/reopen-term.dto';
import {
  addTallies,
  AttendanceSessions,
  emptyCounts,
  emptyDayShape,
  summarise,
  summariseRecords,
  tally,
} from './attendance.reporting';
import {
  ClassroomRegisterGrid,
  ClassroomRegisterGridRow,
  RegisterGridCell,
  ClassroomTermSummary,
  RegisterStudentRow,
  RegisterView,
  StudentTermSummary,
  SummaryTermInfo,
} from './attendance.types';

/**
 * The four columns a register write actually sets. One shape, so create,
 * amend-detection and the audit entry can never disagree about what an
 * omitted afternoon meant.
 */
interface SessionValues {
  morningStatus: AttendanceStatus;
  morningReason: string | null;
  afternoonStatus: AttendanceStatus;
  afternoonReason: string | null;
}

/** `YYYY-MM-DD` from a Postgres `date` (which Prisma hands back at UTC midnight). */
function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * A `YYYY-MM-DD` string to the UTC-midnight Date a `@db.Date` column wants.
 * UTC deliberately: Ghana is UTC+0 year-round, so this is also the school's
 * civil date, and pinning it removes any dependence on the server's timezone.
 */
function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Both are `YYYY-MM-DD`, which sorts lexicographically as it sorts by date. */
function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

function fullName(student: { firstName: string; lastName: string; middleName?: string | null }) {
  return [student.firstName, student.middleName, student.lastName]
    .filter(Boolean)
    .join(' ');
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── row-level authorisation ───────────────────────────────────────────────

  /**
   * The caller's linked Staff id, or null if their login is not a staff login.
   *
   * A per-request primary-key lookup, deliberately, rather than widening
   * JwtPayload: no token-issuance change, and no fleet of access tokens
   * already in flight that lack the new fields. If a second module ever needs
   * the same resolution (teacher-scoped score entry is the obvious one), that
   * is the moment to reconsider putting it on the token.
   */
  private async resolveActorStaffId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { linkedEntityType: true, linkedEntityId: true },
    });
    if (!user || user.linkedEntityType !== LinkedEntityType.staff) return null;
    return user.linkedEntityId;
  }

  /**
   * Attendance is the first module in Brite that needs row-level
   * authorisation, so this is the pattern every scoped module after it will
   * copy. It lives in the SERVICE, not in PermissionsGuard: the guard stays a
   * pure permission-key check and never learns how to resolve a resource.
   *
   * Holding the `_any` variant bypasses the ownership test entirely.
   */
  private async assertClassroomAccess(
    user: JwtPayload,
    classroom: { id: string; displayName: string; classTeacherId: string | null },
    mode: 'read' | 'mark',
  ): Promise<void> {
    const anyPermission = mode === 'mark' ? 'attendance.mark_any' : 'attendance.read_any';
    if (user.permissions?.includes(anyPermission)) return;

    const staffId = await this.resolveActorStaffId(user.sub);
    if (!staffId || classroom.classTeacherId !== staffId) {
      throw new ForbiddenException(
        `You are not the class teacher of '${classroom.displayName}'. ` +
          `Marking or viewing another classroom's register requires ${anyPermission}.`,
      );
    }
  }

  private async getClassroom(classroomId: string, schoolId: string) {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id: classroomId, schoolId },
      include: { level: true, academicYear: true },
    });
    if (!classroom) {
      throw new NotFoundException('Classroom not found or does not belong to this school');
    }
    return classroom;
  }

  // ── term gating ───────────────────────────────────────────────────────────

  /** The term of `academicYearId` whose date range covers `date`, if any. */
  private async findTermForDate(
    schoolId: string,
    academicYearId: string,
    date: string,
  ): Promise<Term | null> {
    const target = toDateOnly(date);
    return this.prisma.term.findFirst({
      where: {
        schoolId,
        academicYearId,
        startDate: { lte: target },
        endDate: { gte: target },
      },
      orderBy: { termNumber: 'asc' },
    });
  }

  /**
   * Whether a CLOSED term has been reopened for amendment.
   *
   * There is no `reopened` column and no fifth TermStatus. The reopen is a
   * fact in the immutable audit trail, and the trail is also what re-locks
   * it: closing the term again writes a newer `terms.closed` entry, which
   * once more outranks the reopen. That is why this compares timestamps
   * rather than just checking for the reopen's existence.
   *
   * Default is LOCKED. A term with no audit history at all (closed by hand in
   * SQL, say) stays locked rather than falling open.
   */
  private async isReopened(schoolId: string, termId: string): Promise<boolean> {
    const [reopened, closed] = await Promise.all([
      this.prisma.auditLog.findFirst({
        where: {
          schoolId,
          entityType: 'term',
          entityId: termId,
          action: 'attendance.term_reopened',
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.auditLog.findFirst({
        where: { schoolId, entityType: 'term', entityId: termId, action: 'terms.closed' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    if (!reopened) return false;
    // Ties go to the close: locked is the safe default.
    return !closed || reopened.createdAt > closed.createdAt;
  }

  /**
   * Can this term's registers be written to right now?
   *
   * `active`  — yes, the normal case.
   * `draft`   — no. The term has not begun; marking it would be marking the
   *             future by another route.
   * `closed`  — only if reopened (see isReopened).
   */
  private async termWriteState(
    schoolId: string,
    term: Term,
  ): Promise<{ amendable: boolean; reason: string | null }> {
    if (term.status === TermStatus.active) {
      return { amendable: true, reason: null };
    }
    if (term.status === TermStatus.draft) {
      return {
        amendable: false,
        reason: `Term '${term.label}' has not started yet. Activate the term before marking its register.`,
      };
    }
    if (await this.isReopened(schoolId, term.id)) {
      return { amendable: true, reason: null };
    }
    return {
      amendable: false,
      reason: `Term '${term.label}' is closed. A Super Admin must reopen it before its register can be amended.`,
    };
  }

  // ── register: read ────────────────────────────────────────────────────────

  /**
   * The roster LEFT JOINed onto the day's records.
   *
   * A student with no record renders with BOTH session statuses null — "not
   * marked". There is deliberately no stored `not_marked` state; the absence
   * of a row is the state, which is why this register can never show a stale
   * sentinel the way the benchmarked product's did. A row always has both
   * sessions or neither: `afternoon_status` is NOT NULL, so a half-marked row
   * cannot exist.
   */
  async getRegister(user: JwtPayload, query: QueryRegisterDto): Promise<RegisterView> {
    const classroom = await this.getClassroom(query.classroomId, user.schoolId);
    await this.assertClassroomAccess(user, classroom, 'read');

    const date = query.date.slice(0, 10);

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classroomId: classroom.id,
        schoolId: user.schoolId,
        status: EnrollmentStatus.active,
      },
      include: { student: true },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        schoolId: user.schoolId,
        attendanceDate: toDateOnly(date),
        enrollmentId: { in: enrollments.map((e) => e.id) },
      },
    });
    const byEnrollment = new Map(records.map((r) => [r.enrollmentId, r]));

    const rows: RegisterStudentRow[] = enrollments
      .map((enrollment) => {
        const record = byEnrollment.get(enrollment.id);
        return {
          enrollmentId: enrollment.id,
          studentId: enrollment.student.id,
          studentNumber: enrollment.student.studentNumber,
          fullName: fullName(enrollment.student),
          morningStatus: record?.morningStatus ?? null,
          morningReason: record?.morningReason ?? null,
          afternoonStatus: record?.afternoonStatus ?? null,
          afternoonReason: record?.afternoonReason ?? null,
          recordId: record?.id ?? null,
          // `updatedAt > createdAt` is the amendment flag. No amendedAt column
          // exists, and none is wanted — see the note on the Prisma model.
          amended: record ? record.updatedAt.getTime() > record.createdAt.getTime() : false,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const term = await this.findTermForDate(user.schoolId, classroom.academicYearId, date);
    const writeState = term
      ? await this.termWriteState(user.schoolId, term)
      : {
          amendable: false,
          reason: `No term of ${classroom.academicYear.label} covers ${date}.`,
        };

    const inFuture = date > today();

    return {
      classroom: {
        id: classroom.id,
        displayName: classroom.displayName,
        levelName: classroom.level.name,
        academicYearId: classroom.academicYearId,
        academicYearLabel: classroom.academicYear.label,
      },
      date,
      term: term
        ? {
            id: term.id,
            label: term.label,
            status: term.status,
            amendable: writeState.amendable,
          }
        : null,
      editable: writeState.amendable && !inFuture,
      lockReason: inFuture
        ? 'A register cannot be marked for a future date.'
        : writeState.reason,
      counts: tally(records),
      unmarkedCount: rows.filter((r) => r.morningStatus === null).length,
      rows,
    };
  }

  // ── register: create and amend ────────────────────────────────────────────

  /**
   * One endpoint for marking AND amending, because that is how a register is
   * used: mark the class, then change two rows when the latecomers arrive.
   *
   * Idempotent by construction — the upsert keys on
   * (enrollmentId, attendanceDate). Re-sending an unchanged register writes
   * nothing and audits nothing.
   */
  async markRegister(user: JwtPayload, dto: MarkRegisterDto, requestId?: string) {
    const classroom = await this.getClassroom(dto.classroomId, user.schoolId);
    await this.assertClassroomAccess(user, classroom, 'mark');

    const date = dto.date.slice(0, 10);

    // Future dates: a service check, NOT a CHECK constraint. Postgres rejects
    // non-immutable functions such as CURRENT_DATE inside a check constraint,
    // so this rule cannot live in the raw-SQL set however much it looks like
    // it belongs there.
    if (date > today()) {
      throw new BadRequestException('A register cannot be marked for a future date');
    }

    const term = await this.findTermForDate(user.schoolId, classroom.academicYearId, date);
    if (!term) {
      throw new ConflictException(
        `No term of ${classroom.academicYear.label} covers ${date}. ` +
          `Check the date, or the term's start and end dates.`,
      );
    }

    const writeState = await this.termWriteState(user.schoolId, term);
    if (!writeState.amendable) {
      throw new ConflictException(writeState.reason ?? 'This term is not open for marking');
    }

    // Back-dating inside the open term is allowed without limit: a teacher
    // copying up last week's paper register is the normal case.

    const uniqueIds = new Set(dto.marks.map((m) => m.enrollmentId));
    if (uniqueIds.size !== dto.marks.length) {
      throw new BadRequestException('The same student appears more than once in this register');
    }

    // Every enrollment must be ACTIVE and in THIS classroom. Without this a
    // caller authorised for one classroom could write another's register by
    // sending its enrollment ids.
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        id: { in: [...uniqueIds] },
        schoolId: user.schoolId,
        classroomId: classroom.id,
        status: EnrollmentStatus.active,
      },
      select: { id: true },
    });
    if (enrollments.length !== uniqueIds.size) {
      throw new ConflictException(
        `Every student marked must have an active enrollment in '${classroom.displayName}'.`,
      );
    }

    const attendanceDate = toDateOnly(date);
    const existing = await this.prisma.attendanceRecord.findMany({
      where: {
        schoolId: user.schoolId,
        attendanceDate,
        enrollmentId: { in: [...uniqueIds] },
      },
    });
    const byEnrollment = new Map(existing.map((r) => [r.enrollmentId, r]));

    // ONE place resolves a payload mark into the four columns actually
    // written, so create, amend-detection and audit can never disagree about
    // what "afternoon omitted" meant.
    //
    // OMITTED AFTERNOON MIRRORS THE MORNING — on create AND on amend. See the
    // extended note on `RegisterMarkDto.afternoon`: this endpoint is
    // declarative, so a payload describes a complete register state and an
    // omitted afternoon is a statement ("same as the morning"), not a silence.
    // The consequence a client author must know: omitting an afternoon that
    // was previously set RESETS it to the morning. `amendedCount` in the
    // response makes that visible in the same request.
    const resolve = (mark: (typeof dto.marks)[number]): SessionValues => ({
      morningStatus: mark.status,
      morningReason: mark.reason ?? null,
      afternoonStatus: mark.afternoon?.status ?? mark.status,
      afternoonReason: mark.afternoon ? (mark.afternoon.reason ?? null) : (mark.reason ?? null),
    });

    const created: { mark: (typeof dto.marks)[number]; values: SessionValues }[] = [];
    const amended: {
      enrollmentId: string;
      before: SessionValues;
      after: SessionValues;
      /** Which sessions actually moved — makes "afternoon corrections this term" a query. */
      sessions: ('morning' | 'afternoon')[];
    }[] = [];

    for (const mark of dto.marks) {
      const prior = byEnrollment.get(mark.enrollmentId);
      const values = resolve(mark);
      if (!prior) {
        created.push({ mark, values });
        continue;
      }
      const before: SessionValues = {
        morningStatus: prior.morningStatus,
        morningReason: prior.morningReason,
        afternoonStatus: prior.afternoonStatus,
        afternoonReason: prior.afternoonReason,
      };
      const sessions: ('morning' | 'afternoon')[] = [];
      if (
        before.morningStatus !== values.morningStatus ||
        before.morningReason !== values.morningReason
      ) {
        sessions.push('morning');
      }
      if (
        before.afternoonStatus !== values.afternoonStatus ||
        before.afternoonReason !== values.afternoonReason
      ) {
        sessions.push('afternoon');
      }
      if (sessions.length) {
        amended.push({ enrollmentId: mark.enrollmentId, before, after: values, sessions });
      }
      // else: unchanged. Not written, not audited.
    }

    if (created.length || amended.length) {
      const touched = new Set([
        ...created.map((c) => c.mark.enrollmentId),
        ...amended.map((a) => a.enrollmentId),
      ]);

      await this.prisma.$transaction(
        dto.marks
          .filter((mark) => touched.has(mark.enrollmentId))
          .map((mark) => {
            const values = resolve(mark);
            return this.prisma.attendanceRecord.upsert({
              where: {
                enrollmentId_attendanceDate: {
                  enrollmentId: mark.enrollmentId,
                  attendanceDate,
                },
              },
              create: {
                schoolId: user.schoolId,
                enrollmentId: mark.enrollmentId,
                attendanceDate,
                ...values,
                createdBy: user.sub,
                updatedBy: user.sub,
              },
              update: {
                ...values,
                updatedBy: user.sub,
              },
            });
          }),
      );
    }

    // Audit entries only for rows that ACTUALLY changed. Re-saving an
    // untouched register must not flood a table whose whole value is that it
    // stays readable. One entry per operation, not per row.
    const auditBase = {
      schoolId: user.schoolId,
      userId: user.sub,
      requestId,
      module: 'attendance',
      entityType: 'classroom',
      entityId: classroom.id,
    };

    if (created.length) {
      await this.auditLogs.create({
        ...auditBase,
        action: 'attendance.marked',
        metadata: {
          date,
          termId: term.id,
          classroom: classroom.displayName,
          count: created.length,
          marks: created.map((c) => ({
            enrollmentId: c.mark.enrollmentId,
            ...c.values,
          })),
        },
      });
    }

    if (amended.length) {
      await this.auditLogs.create({
        ...auditBase,
        action: 'attendance.amended',
        changes: {
          before: amended.map((a) => ({ enrollmentId: a.enrollmentId, ...a.before })),
          after: amended.map((a) => ({ enrollmentId: a.enrollmentId, ...a.after })),
        },
        metadata: {
          date,
          termId: term.id,
          classroom: classroom.displayName,
          count: amended.length,
          // Which sessions moved across this whole amendment. `before`/`after`
          // carry all four fields on both sides rather than a diff, so a
          // reader can see morning identical and afternoon changed without
          // reconstructing it; this array answers "afternoon corrections this
          // term" as a query rather than a scan.
          sessions: ['morning', 'afternoon'].filter((session) =>
            amended.some((a) => a.sessions.includes(session as 'morning' | 'afternoon')),
          ),
        },
      });
    }

    const register = await this.getRegister(user, {
      classroomId: classroom.id,
      date,
    });

    return {
      ...register,
      createdCount: created.length,
      amendedCount: amended.length,
      unchangedCount: dto.marks.length - created.length - amended.length,
      // Surfaced so a caller can offer "notify guardians" as an explicit,
      // separate action. Absence alerts are deliberately NOT fired from here:
      // a cost-bearing message must not go out on a typo that is corrected ten
      // seconds later. The notification layer is out of this stage entirely.
      // Counted over SESSIONS, consistently with every other figure in this
      // module: a child absent all day contributes 2, one who went home at
      // lunch contributes 1.
      absentCount: dto.marks.reduce((n, m) => {
        const values = resolve(m);
        return (
          n +
          (values.morningStatus === AttendanceStatus.absent ? 1 : 0) +
          (values.afternoonStatus === AttendanceStatus.absent ? 1 : 0)
        );
      }, 0),
    };
  }

  // ── reopen ────────────────────────────────────────────────────────────────

  /**
   * Super Admin, by ROLE rather than by permission.
   *
   * Deliberately not a fifth attendance permission: SCHOOL_ADMIN is seeded
   * with `PERMISSIONS.map(p => p.key)`, so any new permission key is granted
   * to it automatically and "Super Admin only" would quietly become "both
   * admins". The role is the only thing that expresses the restriction and
   * cannot be widened by adding a row.
   */
  private async assertSuperAdmin(user: JwtPayload): Promise<void> {
    const holdsRole = await this.prisma.userRole.findFirst({
      where: { userId: user.sub, role: { code: 'SUPER_ADMIN' } },
      select: { id: true },
    });
    if (!holdsRole) {
      throw new ForbiddenException(
        'Only a Super Admin may reopen a closed term for attendance amendment',
      );
    }
  }

  /**
   * Reopen a closed term's register for amendment.
   *
   * The guarded-reversal pattern from Phase 1B's admission transitions: a
   * permanent, unconditional lock leaves no recourse for a genuine error,
   * which is worse than a rare exception that is restricted, reasoned and
   * audited.
   *
   * Note what this does NOT do: it does not touch `Term.status`. Setting the
   * term back to `active` would collide with
   * uq_one_active_term_per_school whenever another term is already active.
   * The reopen is a fact in the audit trail and nothing else — which is also
   * what re-locks it, since closing the term again writes a newer
   * `terms.closed` entry that outranks the reopen.
   */
  async reopenTerm(
    user: JwtPayload,
    termId: string,
    dto: ReopenTermDto,
    requestId?: string,
  ) {
    await this.assertSuperAdmin(user);

    const term = await this.prisma.term.findFirst({
      where: { id: termId, schoolId: user.schoolId },
    });
    if (!term) {
      throw new NotFoundException('Term not found or does not belong to this school');
    }

    if (term.status !== TermStatus.closed) {
      throw new ConflictException(
        `Term '${term.label}' is ${term.status}, not closed. ` +
          `Only a closed term's register needs reopening.`,
      );
    }

    if (await this.isReopened(user.schoolId, term.id)) {
      throw new ConflictException(
        `Term '${term.label}' has already been reopened for amendment.`,
      );
    }

    await this.auditLogs.create({
      schoolId: user.schoolId,
      userId: user.sub,
      requestId,
      action: 'attendance.term_reopened',
      module: 'attendance',
      entityType: 'term',
      entityId: term.id,
      metadata: {
        reason: dto.reason,
        termLabel: term.label,
        termStatus: term.status,
      },
    });

    return {
      termId: term.id,
      termLabel: term.label,
      status: term.status,
      registerAmendable: true,
      reason: dto.reason,
    };
  }

  // ── reporting ─────────────────────────────────────────────────────────────

  private async getTerm(termId: string, schoolId: string) {
    const term = await this.prisma.term.findFirst({ where: { id: termId, schoolId } });
    if (!term) {
      throw new NotFoundException('Term not found or does not belong to this school');
    }
    return term;
  }

  private termInfo(term: Term): SummaryTermInfo {
    return {
      id: term.id,
      label: term.label,
      startDate: toDateString(term.startDate),
      endDate: toDateString(term.endDate),
      status: term.status,
    };
  }

  private termDateFilter(term: Term): Prisma.DateTimeFilter {
    return { gte: term.startDate, lte: term.endDate };
  }

  /**
   * One student's counts over one term.
   *
   * Term-scoping needs no `termId` on Enrollment: records are dated, a term is
   * a date range, so this is a date-range filter. That is why the fees and
   * attendance work did not have to touch
   * uq_one_active_enrollment_per_student_year.
   */
  async studentTermSummary(
    user: JwtPayload,
    studentId: string,
    termId: string,
  ): Promise<StudentTermSummary> {
    const term = await this.getTerm(termId, user.schoolId);

    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId: user.schoolId },
    });
    if (!student) {
      throw new NotFoundException('Student not found or does not belong to this school');
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId,
        schoolId: user.schoolId,
        academicYearId: term.academicYearId,
      },
      include: { classroom: true },
      orderBy: { createdAt: 'desc' },
    });

    if (enrollment) {
      await this.assertClassroomAccess(user, enrollment.classroom, 'read');
    } else if (!user.permissions?.includes('attendance.read_any')) {
      // No enrollment means no classroom to own, so there is nothing a
      // classroom-scoped caller can be the teacher of.
      throw new ForbiddenException(
        `${student.firstName} ${student.lastName} has no enrollment in this term's ` +
          `academic year. Viewing them requires attendance.read_any.`,
      );
    }

    const records = enrollment
      ? await this.prisma.attendanceRecord.findMany({
          where: {
            schoolId: user.schoolId,
            enrollmentId: enrollment.id,
            attendanceDate: this.termDateFilter(term),
          },
          select: { morningStatus: true, afternoonStatus: true },
        })
      : [];

    return {
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: fullName(student),
      },
      classroom: enrollment
        ? { id: enrollment.classroom.id, displayName: enrollment.classroom.displayName }
        : null,
      term: this.termInfo(term),
      summary: summariseRecords(records),
    };
  }

  /** One classroom's roster with each student's counts, plus a class total. */
  async classroomTermSummary(
    user: JwtPayload,
    classroomId: string,
    termId: string,
  ): Promise<ClassroomTermSummary> {
    const classroom = await this.getClassroom(classroomId, user.schoolId);
    await this.assertClassroomAccess(user, classroom, 'read');

    const term = await this.getTerm(termId, user.schoolId);
    if (term.academicYearId !== classroom.academicYearId) {
      throw new ConflictException(
        `Term '${term.label}' does not belong to ${classroom.academicYear.label}, ` +
          `the academic year of '${classroom.displayName}'.`,
      );
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classroomId: classroom.id,
        schoolId: user.schoolId,
        status: EnrollmentStatus.active,
      },
      include: { student: true },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        schoolId: user.schoolId,
        enrollmentId: { in: enrollments.map((e) => e.id) },
        attendanceDate: this.termDateFilter(term),
      },
      select: {
        enrollmentId: true,
        morningStatus: true,
        afternoonStatus: true,
        attendanceDate: true,
      },
    });

    const byEnrollment = new Map<string, AttendanceSessions[]>();
    const dates = new Set<string>();
    for (const record of records) {
      const bucket = byEnrollment.get(record.enrollmentId) ?? [];
      bucket.push({
        morningStatus: record.morningStatus,
        afternoonStatus: record.afternoonStatus,
      });
      byEnrollment.set(record.enrollmentId, bucket);
      dates.add(toDateString(record.attendanceDate));
    }

    const students = enrollments
      .map((enrollment) => ({
        enrollmentId: enrollment.id,
        studentId: enrollment.student.id,
        studentNumber: enrollment.student.studentNumber,
        fullName: fullName(enrollment.student),
        summary: summariseRecords(byEnrollment.get(enrollment.id) ?? []),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    // The class total folds the raw per-status SESSION counts and the raw
    // day-shape counts, then runs them through the SAME summarise(). It never
    // re-derives sessions-present or daysPartial from the rows'
    // already-summarised numbers, which would be the second definition this
    // module exists to prevent.
    const totals = students.reduce(
      (acc, row) => addTallies(acc, row.summary),
      { ...emptyCounts(), ...emptyDayShape() },
    );

    return {
      classroom: {
        id: classroom.id,
        displayName: classroom.displayName,
        levelName: classroom.level.name,
      },
      term: this.termInfo(term),
      students,
      classroomTotals: summarise(totals),
      datesMarked: dates.size,
    };
  }

  /**
   * The printable register: students down, dates across, AM and PM per cell.
   *
   * Same authorisation and same reporting rule as every other read here — it
   * is a different SHAPE of the same data, not a different definition of it.
   * The per-student and class summaries come from the same `summariseRecords`
   * and `summarise` as the term summary, so a printed sheet and the screen
   * cannot disagree.
   *
   * Only MARKED dates become columns. An unmarked date is not a column of
   * blanks, because Brite has no school calendar and therefore cannot tell
   * "nobody marked the register" from "there was no school that day" — the
   * same denominator caveat the rest of the module carries, and the reason
   * the printed footer states it.
   */
  async classroomRegisterGrid(
    user: JwtPayload,
    query: QueryRegisterGridDto,
  ): Promise<ClassroomRegisterGrid> {
    const classroom = await this.getClassroom(query.classroomId, user.schoolId);
    await this.assertClassroomAccess(user, classroom, 'read');

    const term = await this.getTerm(query.termId, user.schoolId);
    if (term.academicYearId !== classroom.academicYearId) {
      throw new ConflictException(
        `Term '${term.label}' does not belong to ${classroom.academicYear.label}, ` +
          `the academic year of '${classroom.displayName}'.`,
      );
    }

    // The range is clamped INTO the term: a printed register headed with a
    // term must not contain a date outside it.
    const termFrom = toDateString(term.startDate);
    const termTo = toDateString(term.endDate);
    const from = query.from ? maxDate(query.from.slice(0, 10), termFrom) : termFrom;
    const to = query.to ? minDate(query.to.slice(0, 10), termTo) : termTo;
    if (from > to) {
      throw new BadRequestException(
        `The range ${from} to ${to} is empty within term '${term.label}' ` +
          `(${termFrom} to ${termTo}).`,
      );
    }

    const school = await this.prisma.school.findFirst({
      where: { id: user.schoolId },
      select: { name: true },
    });

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classroomId: classroom.id,
        schoolId: user.schoolId,
        status: EnrollmentStatus.active,
      },
      include: { student: true },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        schoolId: user.schoolId,
        enrollmentId: { in: enrollments.map((e) => e.id) },
        attendanceDate: { gte: toDateOnly(from), lte: toDateOnly(to) },
      },
      select: {
        enrollmentId: true,
        attendanceDate: true,
        morningStatus: true,
        afternoonStatus: true,
      },
      orderBy: { attendanceDate: 'asc' },
    });

    const dates = new Set<string>();
    const cellsByEnrollment = new Map<string, Record<string, RegisterGridCell>>();
    const sessionsByEnrollment = new Map<string, AttendanceSessions[]>();

    for (const record of records) {
      const date = toDateString(record.attendanceDate);
      dates.add(date);

      const cells = cellsByEnrollment.get(record.enrollmentId) ?? {};
      cells[date] = { am: record.morningStatus, pm: record.afternoonStatus };
      cellsByEnrollment.set(record.enrollmentId, cells);

      const sessions = sessionsByEnrollment.get(record.enrollmentId) ?? [];
      sessions.push({
        morningStatus: record.morningStatus,
        afternoonStatus: record.afternoonStatus,
      });
      sessionsByEnrollment.set(record.enrollmentId, sessions);
    }

    const rows: ClassroomRegisterGridRow[] = enrollments
      .map((enrollment) => ({
        enrollmentId: enrollment.id,
        studentId: enrollment.student.id,
        studentNumber: enrollment.student.studentNumber,
        fullName: fullName(enrollment.student),
        cells: cellsByEnrollment.get(enrollment.id) ?? {},
        summary: summariseRecords(sessionsByEnrollment.get(enrollment.id) ?? []),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    // Same fold as the term summary: raw tallies summed, then ONE summarise().
    const totals = rows.reduce(
      (acc, row) => addTallies(acc, row.summary),
      { ...emptyCounts(), ...emptyDayShape() },
    );

    return {
      school: { name: school?.name ?? '' },
      classroom: {
        id: classroom.id,
        displayName: classroom.displayName,
        levelName: classroom.level.name,
      },
      term: this.termInfo(term),
      range: { from, to },
      dates: [...dates].sort(),
      rows,
      totals: summarise(totals),
    };
  }

  /**
   * Classrooms the caller may mark, for the register picker.
   *
   * `attendance.read_any` sees every active classroom; a class teacher sees
   * only their own. Same ownership rule as assertClassroomAccess, applied as
   * a filter rather than as an assertion.
   */
  async listAccessibleClassrooms(user: JwtPayload, academicYearId?: string) {
    const where: Prisma.ClassroomWhereInput = {
      schoolId: user.schoolId,
      isActive: true,
      ...(academicYearId ? { academicYearId } : {}),
    };

    if (!user.permissions?.includes('attendance.read_any')) {
      const staffId = await this.resolveActorStaffId(user.sub);
      if (!staffId) return [];
      where.classTeacherId = staffId;
    }

    const classrooms = await this.prisma.classroom.findMany({
      where,
      include: { level: true, academicYear: true },
      orderBy: [{ level: { orderIndex: 'asc' } }, { sectionLabel: 'asc' }],
    });

    // Every classroom in this list is already one the caller may reach, so
    // marking turns only on holding either mark permission.
    const canMark =
      !!user.permissions?.includes('attendance.mark_any') ||
      !!user.permissions?.includes('attendance.mark');

    return classrooms.map((classroom) => ({
      id: classroom.id,
      displayName: classroom.displayName,
      levelName: classroom.level.name,
      academicYearId: classroom.academicYearId,
      academicYearLabel: classroom.academicYear.label,
      canMark,
    }));
  }
}
