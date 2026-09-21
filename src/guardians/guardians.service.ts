import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { QueryGuardiansDto } from './dto/query-guardians.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';

@Injectable()
export class GuardiansService {
  /**
   * Record SMS consent for this guardian.
   *
   * Consent is a RECORD, not a preference toggle: who recorded it, when, and
   * on what basis. The method matters because it is what a school would have
   * to produce if anyone asked how consent was obtained — a boolean answers
   * "may we message them", not "on what basis", and Act 843 cares about the
   * second.
   *
   * Inbound SMS is deferred (there is no webhook, no short code, no keyword
   * parser), so a guardian cannot reply YES to opt in. Staff capture it on
   * their behalf, against their own user id, and the audit trail is the proof.
   */
  async grantSmsConsent(
    id: string,
    method: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    const guardian = await this.prisma.guardian.update({
      where: { id },
      data: {
        smsConsentGiven: true,
        smsConsentGivenAt: new Date(),
        smsConsentGivenBy: userId,
        smsConsentMethod: method,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'guardian.sms_consent_granted',
      module: 'guardians',
      entityType: 'guardian',
      entityId: id,
      changes: {
        before: { smsConsentGiven: existing.smsConsentGiven },
        after: { smsConsentGiven: true, smsConsentMethod: method },
      },
      metadata: {
        guardian: `${existing.firstName} ${existing.lastName}`,
        method,
        // Named explicitly so the trail says WHO vouched for this, which is
        // the whole point of a staff-captured consent record.
        recordedBy: userId,
      },
    });

    return guardian;
  }

  /**
   * Withdraw consent. Takes effect on the NEXT send, not eventually.
   *
   * There is no cached consent anywhere: NotificationsService re-reads
   * `smsConsentGiven` from the database inside every single enqueue. Revoking
   * therefore stops future sends the moment this transaction commits, and the
   * only messages that still go out are ones already sitting in the outbox —
   * which is why this also CANCELS those.
   *
   * The three detail columns are nulled. The immutable `audit_logs` trail
   * keeps the history of when consent was held and how it was obtained, per
   * the house rule that the row is current state and the audit is the story.
   */
  async revokeSmsConsent(
    id: string,
    reason: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);
    if (!existing.smsConsentGiven) {
      throw new ConflictException(
        `${existing.firstName} ${existing.lastName} has not given SMS consent, so there is nothing to withdraw`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const guardian = await tx.guardian.update({
        where: { id },
        data: {
          smsConsentGiven: false,
          smsConsentGivenAt: null,
          smsConsentGivenBy: null,
          smsConsentMethod: null,
          updatedBy: userId,
        },
      });

      // Every link goes unreachable with them — a per-child flag cannot
      // outlive the consent it depends on.
      const links = await tx.studentGuardian.updateMany({
        where: { guardianId: id, canReceiveSms: true },
        data: { canReceiveSms: false },
      });

      // Anything already queued must not go out. A message sent after consent
      // was withdrawn is the exact thing withdrawal exists to prevent, and
      // "it was already in the queue" is not a defence anyone would accept.
      const cancelled = await tx.notificationMessage.updateMany({
        where: { guardianId: id, status: { in: ['queued', 'sending'] } },
        data: {
          status: 'cancelled',
          lastError: 'SMS consent withdrawn before this message was sent',
          nextAttemptAt: null,
        },
      });

      return { guardian, linksDisabled: links.count, queuedCancelled: cancelled.count };
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'guardian.sms_consent_revoked',
      module: 'guardians',
      entityType: 'guardian',
      entityId: id,
      changes: {
        before: {
          smsConsentGiven: true,
          smsConsentMethod: existing.smsConsentMethod,
          smsConsentGivenAt: existing.smsConsentGivenAt,
        },
        after: { smsConsentGiven: false },
      },
      metadata: {
        guardian: `${existing.firstName} ${existing.lastName}`,
        reason,
        linksDisabled: result.linksDisabled,
        queuedMessagesCancelled: result.queuedCancelled,
      },
    });

    return {
      ...result.guardian,
      linksDisabled: result.linksDisabled,
      queuedMessagesCancelled: result.queuedCancelled,
    };
  }

  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateGuardianDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    try {
      const guardian = await this.prisma.guardian.create({
        data: {
          schoolId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phonePrimary: dto.phonePrimary,
          phoneSecondary: dto.phoneSecondary,
          email: dto.email,
          occupation: dto.occupation,
          address: dto.address,
          createdBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'guardians.created',
        module: 'guardians',
        entityType: 'guardian',
        entityId: guardian.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return guardian;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A guardian with this primary phone number already exists in this school',
        );
      }
      throw err;
    }
  }

  async findAll(schoolId: string, query: QueryGuardiansDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: any = { schoolId, ...(query.includeArchived ? {} : { archivedAt: null }) };
    if (query.search?.trim()) {
      const term = query.search.trim();
      // Each field on its own, which is what a single word wants.
      where.OR = [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
      ];

      // A FULL NAME spans two columns, so no single `contains` can match it:
      // "Samuel Boakye" is not a substring of either "Samuel" or "Boakye", and
      // typing somebody's whole name returned nothing at all. Every word must
      // match some name field, which covers "Samuel Boakye" and "Boakye
      // Samuel" alike — people write names in both orders, and matching a
      // concatenation would only have handled one of them.
      const words = term.split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        where.OR.push({
          AND: words.map((word) => ({
            OR: [
              { firstName: { contains: word, mode: 'insensitive' } },
              { lastName: { contains: word, mode: 'insensitive' } },
            ],
          })),
        });
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.guardian.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.guardian.count({ where }),
    ]);

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    const guardian = await this.prisma.guardian.findFirst({
      where: { id, schoolId },
    });
    if (!guardian) {
      throw new NotFoundException(`Guardian with id ${id} not found`);
    }
    return guardian;
  }

  async update(
    id: string,
    dto: UpdateGuardianDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    try {
      const guardian = await this.prisma.guardian.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined && { firstName: dto.firstName }),
          ...(dto.lastName !== undefined && { lastName: dto.lastName }),
          ...(dto.phonePrimary !== undefined && { phonePrimary: dto.phonePrimary }),
          ...(dto.phoneSecondary !== undefined && { phoneSecondary: dto.phoneSecondary }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.occupation !== undefined && { occupation: dto.occupation }),
          ...(dto.address !== undefined && { address: dto.address }),
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'guardians.updated',
        module: 'guardians',
        entityType: 'guardian',
        entityId: guardian.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return guardian;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A guardian with this primary phone number already exists in this school',
        );
      }
      throw err;
    }
  }

  async archive(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    const guardian = await this.prisma.guardian.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'guardians.archived',
      module: 'guardians',
      entityType: 'guardian',
      entityId: guardian.id,
    });

    return guardian;
  }

  /**
   * Inverse of archive. Links (including isPrimary) were never touched by
   * archive, so restore is lossless by construction.
   */
  async restore(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (!existing.archivedAt) {
      throw new ConflictException('Guardian is not archived');
    }

    const guardian = await this.prisma.guardian.update({
      where: { id },
      data: { archivedAt: null, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'guardians.restored',
      module: 'guardians',
      entityType: 'guardian',
      entityId: id,
      changes: { before: { archivedAt: existing.archivedAt }, after: { archivedAt: null } },
    });

    return guardian;
  }

  async getStudents(id: string, schoolId: string) {
    await this.findOne(id, schoolId);

    return this.prisma.studentGuardian.findMany({
      where: { guardianId: id, schoolId },
      include: { student: true },
    });
  }
}
