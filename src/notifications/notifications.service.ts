import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationStatus,
  NotificationTrigger,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { normaliseGhanaPhone } from './notifications.phone';
import { analyseSms, degradeToGsm7 } from './notifications.segments';
import {
  DEFAULT_TEMPLATES,
  renderTemplate,
  templateSettingKey,
} from './notifications.templates';

/** What a caller asks for. It does NOT get to say which phone, or whether consent exists. */
export interface EnqueueRequest {
  schoolId: string;
  trigger: NotificationTrigger;
  /** Exactly one of these addressing modes. */
  guardianId?: string;
  /** Send to the student's PRIMARY guardian. */
  studentId?: string;
  /** A staff/guardian login — used by password reset and account setup. */
  userId?: string;
  values: Record<string, string | number | null | undefined>;
  /** Idempotency. Backed by uq_notification_dedupe. */
  dedupeKey?: string;
  contextType?: string;
  contextId?: string;
  batchId?: string;
  actorUserId?: string;
}

export type EnqueueOutcome =
  | { status: 'queued'; id: string }
  | { status: 'duplicate' }
  | { status: 'suppressed'; reason: string; id?: string };

/**
 * A resolved recipient. Producing one of these is the ONLY way a message
 * reaches the outbox, and the only place consent is checked.
 */
interface ResolvedRecipient {
  guardianId: string | null;
  studentId: string | null;
  userId: string | null;
  phoneRaw: string | null;
  guardianName: string;
}

/**
 * A refusal, plus whatever identity was established before the refusal.
 *
 * Resolution can fail AFTER the guardian has been found — "has not given SMS
 * consent" names a specific person the code is holding at that moment. Losing
 * them means the suppressed row says a message was refused without saying who
 * it was refused for, which makes the log unable to answer the only question
 * anyone opens it to ask: why did THIS parent not get their message.
 */
interface SuppressedOutcome {
  suppressed: string;
  /** Set whenever the guardian was identified before the refusal. */
  partial?: { guardianId: string };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // THE CONSENT GATE
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * THE ONE PLACE consent is checked. There is no other.
   *
   * Every trigger — fee receipt, fee reminder, absence alert, password reset,
   * announcement — reaches the outbox through `enqueue`, and `enqueue` reaches
   * the database through this method. A trigger cannot bypass it because a
   * trigger never constructs a row: it hands `enqueue` a recipient *reference*
   * (guardianId / studentId / userId) and this method turns that into a phone
   * number, or refuses.
   *
   * The refusal is a `suppressed` ROW, not a silent drop. A school that has
   * not recorded consent for 40 parents must be able to see that it has not,
   * which is the difference between a consent gate and a feature that appears
   * broken.
   *
   * TWO conditions, both required:
   *   Guardian.smsConsentGiven  — the PERSON consented (Act 843 posture)
   *   StudentGuardian.canReceiveSms — this LINK is reachable for this child
   *
   * A guardian-addressed message (no student context) needs only the first,
   * because there is no link to consult.
   */
  private async resolveRecipient(
    request: EnqueueRequest,
  ): Promise<ResolvedRecipient | SuppressedOutcome> {
    const { schoolId } = request;

    // ── a login (password reset, account setup) ──
    if (request.userId) {
      const user = await this.prisma.user.findFirst({
        where: { id: request.userId, schoolId },
        select: { id: true, phone: true, isActive: true, linkedEntityType: true, linkedEntityId: true },
      });
      if (!user) return { suppressed: 'User not found' };
      if (!user.isActive) return { suppressed: 'User account is deactivated' };

      // A guardian's login is still a guardian: their consent decision governs.
      if (user.linkedEntityType === 'guardian') {
        const guardian = await this.prisma.guardian.findFirst({
          where: { id: user.linkedEntityId, schoolId },
          select: { id: true, smsConsentGiven: true, firstName: true, lastName: true, phonePrimary: true },
        });
        if (!guardian) return { suppressed: 'Linked guardian not found' };
        if (!guardian.smsConsentGiven) {
          return {
            suppressed: 'Guardian has not given SMS consent',
            partial: { guardianId: guardian.id },
          };
        }
        return {
          guardianId: guardian.id,
          studentId: null,
          userId: user.id,
          phoneRaw: user.phone ?? guardian.phonePrimary,
          guardianName: `${guardian.firstName} ${guardian.lastName}`,
        };
      }

      // Staff. Their own login, their own number; consent does not apply to a
      // security message about the account they asked to reset.
      return {
        guardianId: null,
        studentId: null,
        userId: user.id,
        phoneRaw: user.phone,
        guardianName: 'staff user',
      };
    }

    // ── a student: address their PRIMARY guardian ──
    // One recipient by default, because every extra recipient is another paid
    // message. `uq_one_primary_guardian_per_student` makes "the primary" a
    // database-enforced single answer rather than a query that hopes.
    if (request.studentId) {
      const link = await this.prisma.studentGuardian.findFirst({
        where: { studentId: request.studentId, schoolId, isPrimary: true },
        include: { guardian: true },
      });
      if (!link) return { suppressed: 'Student has no primary guardian' };
      if (!link.guardian.smsConsentGiven) {
        return {
          suppressed: 'Guardian has not given SMS consent',
          partial: { guardianId: link.guardianId },
        };
      }
      if (!link.canReceiveSms) {
        return {
          suppressed: 'Guardian is not set to receive SMS for this student',
          partial: { guardianId: link.guardianId },
        };
      }
      if (link.guardian.archivedAt) {
        return {
          suppressed: 'Guardian record is archived',
          partial: { guardianId: link.guardianId },
        };
      }
      return {
        guardianId: link.guardianId,
        studentId: request.studentId,
        userId: null,
        phoneRaw: link.guardian.phonePrimary,
        guardianName: `${link.guardian.firstName} ${link.guardian.lastName}`,
      };
    }

    // ── a guardian directly ──
    if (request.guardianId) {
      const guardian = await this.prisma.guardian.findFirst({
        where: { id: request.guardianId, schoolId },
      });
      if (!guardian) return { suppressed: 'Guardian not found' };
      if (!guardian.smsConsentGiven) {
        return {
          suppressed: 'Guardian has not given SMS consent',
          partial: { guardianId: guardian.id },
        };
      }
      if (guardian.archivedAt) {
        return {
          suppressed: 'Guardian record is archived',
          partial: { guardianId: guardian.id },
        };
      }
      return {
        guardianId: guardian.id,
        studentId: null,
        userId: null,
        phoneRaw: guardian.phonePrimary,
        guardianName: `${guardian.firstName} ${guardian.lastName}`,
      };
    }

    return { suppressed: 'No recipient specified' };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ENQUEUE — the only door into the outbox
  // ───────────────────────────────────────────────────────────────────────────

  private async templateFor(schoolId: string, trigger: NotificationTrigger): Promise<string> {
    const setting = await this.prisma.schoolSetting.findFirst({
      where: { schoolId, key: templateSettingKey(trigger), isActive: true },
    });
    const stored = (setting?.valueJson as any)?.value;
    return typeof stored === 'string' && stored.trim() ? stored : DEFAULT_TEMPLATES[trigger];
  }

  /**
   * Turn a request into an outbox row, or into a recorded refusal.
   *
   * Nothing else in the codebase inserts into `notification_messages`. That is
   * the invariant the consent gate rests on, and it is enforced by the fact
   * that `NotificationsService` is the only exported way in — the triggers all
   * call this method.
   */
  async enqueue(request: EnqueueRequest): Promise<EnqueueOutcome> {
    const resolved = await this.resolveRecipient(request);

    const template = await this.templateFor(request.schoolId, request.trigger);
    const body = degradeToGsm7(renderTemplate(template, request.values));
    const { segments } = analyseSms(body);

    // A refusal is RECORDED, with the reason, so the school can see and fix it.
    if ('suppressed' in resolved) {
      // Carry through whoever was identified before the refusal, so the row
      // names the guardian the message was refused FOR.
      return this.writeSuppressed(request, body, segments, resolved.suppressed, resolved.partial);
    }

    const phone = normaliseGhanaPhone(resolved.phoneRaw);
    if (phone.ok !== true) {
      // A number that cannot be normalised is a `suppressed` row naming the
      // reason, not a failed send attempt. The school sees "3 recipients had
      // unusable numbers" and fixes the records; the gateway is never asked
      // to charge for a message that cannot arrive.
      return this.writeSuppressed(request, body, segments, phone.detail, resolved);
    }

    try {
      const row = await this.prisma.notificationMessage.create({
        data: {
          schoolId: request.schoolId,
          trigger: request.trigger,
          status: NotificationStatus.queued,
          guardianId: resolved.guardianId,
          studentId: resolved.studentId,
          userId: resolved.userId,
          // Frozen at queue time, both of them.
          toPhone: phone.e164,
          body,
          segmentCount: segments,
          dedupeKey: request.dedupeKey ?? null,
          contextType: request.contextType ?? null,
          contextId: request.contextId ?? null,
          batchId: request.batchId ?? null,
          nextAttemptAt: new Date(),
          createdBy: request.actorUserId ?? null,
          updatedBy: request.actorUserId ?? null,
        },
      });
      return { status: 'queued', id: row.id };
    } catch (err) {
      // uq_notification_dedupe. A double-clicked "Send reminders" lands here
      // once per duplicate instead of sending 300 messages twice.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { status: 'duplicate' };
      }
      throw err;
    }
  }

  private async writeSuppressed(
    request: EnqueueRequest,
    body: string,
    segments: number,
    reason: string,
    // Structural, so both a full ResolvedRecipient (the unusable-number path)
    // and a partial identity from a failed resolution satisfy it. The body
    // below is unchanged — it already prefers the resolved id over the
    // request's.
    resolved?: { guardianId?: string | null; studentId?: string | null; userId?: string | null },
  ): Promise<EnqueueOutcome> {
    try {
      const row = await this.prisma.notificationMessage.create({
        data: {
          schoolId: request.schoolId,
          trigger: request.trigger,
          status: NotificationStatus.suppressed,
          guardianId: resolved?.guardianId ?? request.guardianId ?? null,
          studentId: resolved?.studentId ?? request.studentId ?? null,
          userId: resolved?.userId ?? request.userId ?? null,
          // There is no usable number by definition; the column is NOT NULL
          // and this is the honest value.
          toPhone: '',
          body,
          segmentCount: segments,
          dedupeKey: request.dedupeKey ?? null,
          contextType: request.contextType ?? null,
          contextId: request.contextId ?? null,
          batchId: request.batchId ?? null,
          lastError: reason.slice(0, 255),
          failedAt: new Date(),
          createdBy: request.actorUserId ?? null,
          updatedBy: request.actorUserId ?? null,
        },
      });
      return { status: 'suppressed', reason, id: row.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { status: 'duplicate' };
      }
      throw err;
    }
  }

  /**
   * Enqueue many, and write ONE audit entry for the dispatch.
   *
   * `audit_logs` records the DECISION — who sent what to how many people —
   * not one row per message per attempt, which would flood a table whose
   * entire value is that it stays readable. Per-message state lives on the
   * notification row and is read through the log view.
   */
  async dispatchBatch(
    requests: Omit<EnqueueRequest, 'batchId'>[],
    context: {
      schoolId: string;
      actorUserId: string;
      trigger: NotificationTrigger;
      description: string;
      requestId?: string;
    },
  ) {
    const batchId = randomUUID();
    const outcomes = await Promise.all(
      requests.map((r) => this.enqueue({ ...r, batchId, actorUserId: context.actorUserId })),
    );

    const queued = outcomes.filter((o) => o.status === 'queued').length;
    const suppressed = outcomes.filter((o) => o.status === 'suppressed');
    const duplicates = outcomes.filter((o) => o.status === 'duplicate').length;

    await this.auditLogs.create({
      schoolId: context.schoolId,
      userId: context.actorUserId,
      requestId: context.requestId,
      action: 'notifications.dispatched',
      module: 'notifications',
      entityType: 'notification_batch',
      entityId: batchId,
      metadata: {
        trigger: context.trigger,
        description: context.description,
        requested: requests.length,
        queued,
        suppressed: suppressed.length,
        duplicates,
        // The reasons, aggregated — this is what turns "40 didn't send" into
        // something a bursar can act on.
        suppressedReasons: [...new Set(suppressed.map((s: any) => s.reason))],
      },
    });

    return { batchId, requested: requests.length, queued, suppressed: suppressed.length, duplicates };
  }
}
