import { Injectable } from '@nestjs/common';
import { NotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

/**
 * The delivery log.
 *
 * This exists because the failure mode of a notification system is a school
 * believing 300 reminders went out when 40 did not. A failures list nobody
 * opens is the same as no failures list, so this is paired with a counts
 * endpoint that the billing and register screens surface as a badge.
 */
@Injectable()
export class NotificationsLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(schoolId: string, query: QueryNotificationsDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: Prisma.NotificationMessageWhereInput = {
      schoolId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.trigger ? { trigger: query.trigger } : {}),
      ...(query.guardianId ? { guardianId: query.guardianId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
    };
    if (query.from || query.to) {
      where.queuedAt = {
        ...(query.from ? { gte: new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) } : {}),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationMessage.findMany({
        where,
        include: {
          guardian: { select: { id: true, firstName: true, lastName: true } },
          student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
        },
        orderBy: { queuedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notificationMessage.count({ where }),
    ]);

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    return this.prisma.notificationMessage.findFirst({
      where: { id, schoolId },
      include: {
        guardian: { select: { id: true, firstName: true, lastName: true } },
        student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
      },
    });
  }

  /**
   * Counts by status, plus the two numbers a screen puts in a badge.
   *
   * `needsAttention` is failed + suppressed together, because from a school's
   * point of view they are the same problem — a parent who was not told —
   * even though their causes differ.
   */
  async counts(schoolId: string, since?: string) {
    const where: Prisma.NotificationMessageWhereInput = {
      schoolId,
      ...(since ? { queuedAt: { gte: new Date(`${since.slice(0, 10)}T00:00:00.000Z`) } } : {}),
    };

    const grouped = await this.prisma.notificationMessage.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { segmentCount: true },
    });

    const byStatus = Object.fromEntries(
      Object.values(NotificationStatus).map((s) => [s, 0]),
    ) as Record<NotificationStatus, number>;
    let segments = 0;
    for (const row of grouped) {
      byStatus[row.status] = row._count._all;
      segments += row._sum.segmentCount ?? 0;
    }

    return {
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      needsAttention: byStatus.failed + byStatus.suppressed,
      inFlight: byStatus.queued + byStatus.sending,
      // Billing is per segment, so this — not the message count — is what a
      // school's SMS spend tracks.
      segments,
    };
  }
}
