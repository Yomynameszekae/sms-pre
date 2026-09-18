import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { AttendanceStatus, EnrollmentStatus, NotificationTrigger, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { collectedFrom, ledgerTotals, toMoneyString, ZERO } from '../fees/fees.money';

/**
 * The v1 triggers. Every one of them goes through `NotificationsService.enqueue`
 * and none of them touches `notification_messages` directly — that is what the
 * consent gate rests on.
 */
@Injectable()
export class NotificationsTriggers {
  private readonly logger = new Logger(NotificationsTriggers.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private fullName(s: { firstName: string; middleName?: string | null; lastName: string }) {
    return [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');
  }

  private async schoolName(schoolId: string) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    return school?.name ?? 'School';
  }

  /**
   * FEE RECEIPT — automatic, on payment.
   *
   * Called AFTER the payment transaction has committed, never inside it. A
   * gateway problem must never roll back a recorded payment, and a receipt for
   * a payment that was rolled back is worse than no receipt at all. This
   * method therefore swallows its own errors: the payment succeeded, and the
   * caller must not learn otherwise because of a notification.
   */
  async feeReceipt(params: {
    schoolId: string;
    feePaymentId: string;
    actorUserId?: string;
    requestId?: string;
  }): Promise<void> {
    try {
      const payment = await this.prisma.feePayment.findFirst({
        where: { id: params.feePaymentId, schoolId: params.schoolId },
        include: {
          feeAssignment: {
            include: {
              payments: { select: { amount: true } },
              schoolFee: { include: { feeType: true } },
              enrollment: { include: { student: true } },
            },
          },
        },
      });
      // A reversal is not a receipt. The parent was not paid anything.
      if (!payment || payment.reversesPaymentId) return;

      const assignment = payment.feeAssignment;
      const totals = ledgerTotals(assignment.amountDue, collectedFrom(assignment.payments));

      await this.notifications.enqueue({
        schoolId: params.schoolId,
        trigger: NotificationTrigger.fee_receipt,
        studentId: assignment.enrollment.studentId,
        values: {
          school: await this.schoolName(params.schoolId),
          student: this.fullName(assignment.enrollment.student),
          amount: toMoneyString(payment.amount),
          feeName: assignment.schoolFee.feeType.name,
          receipt: payment.receiptNumber ?? '',
          outstanding: toMoneyString(
            totals.outstanding.lessThan(ZERO) ? ZERO : totals.outstanding,
          ),
        },
        // One receipt per payment, ever, however many times this fires.
        dedupeKey: `fee_receipt:${payment.id}`,
        contextType: 'fee_payment',
        contextId: payment.id,
        actorUserId: params.actorUserId,
      });
    } catch (err) {
      this.logger.error(
        `Fee receipt notification failed for payment ${params.feePaymentId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * FEE REMINDER — manual, per student or per level.
   *
   * Cost-bearing and judgement-bearing, so a human triggers it. Brite has no
   * scheduler, and an automatic reminder round is exactly the feature that
   * should not arrive by accident.
   *
   * Dedupe is per student per DAY: a bursar who clicks twice sends once.
   */
  async feeReminders(params: {
    schoolId: string;
    termId: string;
    levelId?: string;
    studentId?: string;
    actorUserId: string;
    requestId?: string;
  }) {
    const term = await this.prisma.term.findFirst({
      where: { id: params.termId, schoolId: params.schoolId },
    });
    if (!term) throw new NotFoundException('Term not found');

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        schoolId: params.schoolId,
        status: EnrollmentStatus.active,
        academicYearId: term.academicYearId,
        ...(params.studentId ? { studentId: params.studentId } : {}),
        ...(params.levelId
          ? { classroom: { levelId: params.levelId, academicYearId: term.academicYearId } }
          : {}),
      },
      include: { student: true },
    });

    if (!enrollments.length) {
      throw new ConflictException('No actively enrolled students match this selection');
    }

    const assignments = await this.prisma.feeAssignment.findMany({
      where: {
        schoolId: params.schoolId,
        enrollmentId: { in: enrollments.map((e) => e.id) },
        schoolFee: { termId: params.termId },
      },
      include: { payments: { select: { amount: true } } },
    });

    const owedByEnrollment = new Map<string, Prisma.Decimal>();
    for (const a of assignments) {
      const owed = a.amountDue.sub(collectedFrom(a.payments));
      owedByEnrollment.set(
        a.enrollmentId,
        (owedByEnrollment.get(a.enrollmentId) ?? ZERO).add(owed),
      );
    }

    const school = await this.schoolName(params.schoolId);
    const today = new Date().toISOString().slice(0, 10);

    // Only students who ACTUALLY owe something. Reminding a parent who has
    // paid in full is a paid message that damages trust.
    const requests = enrollments
      .filter((e) => (owedByEnrollment.get(e.id) ?? ZERO).greaterThan(ZERO))
      .map((e) => ({
        schoolId: params.schoolId,
        trigger: NotificationTrigger.fee_reminder,
        studentId: e.studentId,
        values: {
          school,
          student: this.fullName(e.student),
          outstanding: toMoneyString(owedByEnrollment.get(e.id)!),
          term: term.label,
        },
        dedupeKey: `fee_reminder:${e.studentId}:${params.termId}:${today}`,
        contextType: 'term',
        contextId: params.termId,
      }));

    if (!requests.length) {
      return {
        batchId: null,
        requested: 0,
        queued: 0,
        suppressed: 0,
        duplicates: 0,
        message: 'Nobody in this selection currently owes anything',
      };
    }

    return this.notifications.dispatchBatch(requests, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      trigger: NotificationTrigger.fee_reminder,
      description: params.studentId
        ? `Fee reminder for one student, ${term.label}`
        : `Fee reminders for a level, ${term.label}`,
      requestId: params.requestId,
    });
  }

  /**
   * ABSENCE ALERT — an explicit action over a saved register, not a hook on
   * the save itself.
   *
   * The trigger CONDITION is exactly what the brief asks for: a student the
   * register has as `absent` for that date. What is deliberate is that a human
   * fires it. Marking a register is a live, error-prone act — a mistyped row
   * corrected ten seconds later would already have cost money and alarmed a
   * parent — so `PUT /attendance/register` returns `absentCount` and this is
   * the separate click. Same condition, one human between it and the money.
   *
   * SESSION-LEVEL. A student qualifies when EITHER session is `absent`, and
   * the message says which — 'all day', 'for the morning' or 'for the
   * afternoon'. These are PHRASES, not labels: they are substituted into the
   * middle of the sentence so the qualifier sits inside the claim rather than
   * in a parenthetical after it.
   * Either-session rather than all-day because a child who went home at lunch
   * is exactly the case a parent wants to hear about, and because it is the
   * choice that cannot under-report. For pre-Part-B rows, whose two sessions
   * were backfilled equal, this selects precisely the same students the
   * day-level condition did.
   *
   * `late` and `excused` still do not alert: `excused` means the school
   * already knows why, and alerting on it would tell a parent something they
   * told the school.
   *
   * The dedupe key is per enrollment per DATE, not per session, so a child
   * absent both sessions gets one message rather than two.
   */
  async absenceAlerts(params: {
    schoolId: string;
    classroomId: string;
    date: string;
    actorUserId: string;
    requestId?: string;
  }) {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id: params.classroomId, schoolId: params.schoolId },
      include: { level: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');

    const date = params.date.slice(0, 10);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        schoolId: params.schoolId,
        attendanceDate: new Date(`${date}T00:00:00.000Z`),
        OR: [
          { morningStatus: AttendanceStatus.absent },
          { afternoonStatus: AttendanceStatus.absent },
        ],
        enrollment: { classroomId: params.classroomId, status: EnrollmentStatus.active },
      },
      include: { enrollment: { include: { student: true } } },
    });

    if (!records.length) {
      throw new ConflictException(
        `No students are marked absent in ${classroom.displayName} on ${date}`,
      );
    }

    const school = await this.schoolName(params.schoolId);

    const requests = records.map((r) => ({
      schoolId: params.schoolId,
      trigger: NotificationTrigger.attendance_absence,
      studentId: r.enrollment.studentId,
      values: {
        school,
        student: this.fullName(r.enrollment.student),
        classroom: classroom.displayName,
        date,
        sessions:
          r.morningStatus === AttendanceStatus.absent &&
          r.afternoonStatus === AttendanceStatus.absent
            ? 'all day'
            : r.morningStatus === AttendanceStatus.absent
              ? 'for the morning'
              : 'for the afternoon',
      },
      // One alert per child per day, so re-running after a correction does
      // not re-send for children who were already notified.
      dedupeKey: `attendance_absence:${r.enrollmentId}:${date}`,
      contextType: 'attendance_record',
      contextId: r.id,
    }));

    return this.notifications.dispatchBatch(requests, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      trigger: NotificationTrigger.attendance_absence,
      description: `Absence alerts for ${classroom.displayName} on ${date}`,
      requestId: params.requestId,
    });
  }

  /**
   * PASSWORD RESET — automatic, on token creation.
   *
   * This is what retires the `_devToken` wart: Phase 1 returned the raw reset
   * token in the HTTP response body under a TODO. Consent does NOT gate this:
   * it is a security message to the holder of an account, sent to the number
   * on that account, at their own request.
   */
  async passwordReset(params: {
    schoolId: string;
    userId: string;
    token: string;
    expiresInMinutes: number;
    requestId?: string;
  }): Promise<void> {
    try {
      await this.notifications.enqueue({
        schoolId: params.schoolId,
        trigger: NotificationTrigger.password_reset,
        userId: params.userId,
        values: {
          school: await this.schoolName(params.schoolId),
          token: params.token,
          expiresInMinutes: params.expiresInMinutes,
        },
        contextType: 'auth_token',
        // Deliberately NO dedupeKey: a user may legitimately request a second
        // reset, and the second token must reach them.
      });
    } catch (err) {
      // Never let a notification failure change what the caller is told —
      // the response is deliberately identical whether or not the account
      // exists, and that must stay true.
      this.logger.error(`Password reset SMS failed: ${(err as Error).message}`);
    }
  }
}
