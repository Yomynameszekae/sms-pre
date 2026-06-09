import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';

@Injectable()
export class AuditLogsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAuditLogDto) {
    return this.prisma.auditLog.create({
      data: {
        schoolId: dto.schoolId || null,
        userId: dto.userId || null,
        requestId: dto.requestId || null,
        actorType: dto.actorType || 'user',
        action: dto.action,
        module: dto.module || null,
        entityType: dto.entityType || null,
        entityId: dto.entityId || null,
        changes: dto.changes || undefined,
        metadata: dto.metadata || {},
        ipAddress: dto.ipAddress || null,
        userAgent: dto.userAgent || null,
      },
    });
  }

  async findAll(schoolId: string, query: QueryAuditLogsDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: any = { schoolId };
    if (query.action) where.action = { contains: query.action };
    if (query.module) where.module = query.module;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.requestId) where.requestId = query.requestId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(items, total, query.page || 1, query.limit || 20);
  }

  async findOne(id: string, schoolId: string) {
    return this.prisma.auditLog.findFirst({ where: { id, schoolId } });
  }
}
