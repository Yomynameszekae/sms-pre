import {
  ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateLevelDto } from './dto/create-level.dto';
import { UpdateLevelDto } from './dto/update-level.dto';

@Injectable()
export class LevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateLevelDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const level = await this.prisma.level.create({
      data: {
        schoolId,
        name: dto.name,
        gesDesignation: dto.gesDesignation ?? null,
        abekaDesignation: dto.abekaDesignation ?? null,
        orderIndex: dto.orderIndex,
        levelGroup: dto.levelGroup,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'levels.created',
      module: 'levels',
      entityType: 'level',
      entityId: level.id,
      changes: { after: dto },
    });

    return level;
  }

  async findAll(schoolId: string, includeArchived = false) {
    return this.prisma.level.findMany({
      where: { schoolId, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: { orderIndex: 'asc' },
    });
  }

  /** Inverse of archive: isActive back to true. Fixed restore state. */
  async restore(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (existing.isActive) {
      throw new ConflictException('Level is not archived');
    }

    const level = await this.prisma.level.update({
      where: { id },
      data: { isActive: true, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'levels.restored',
      module: 'levels',
      entityType: 'level',
      entityId: id,
      changes: { before: { isActive: false }, after: { isActive: true } },
    });

    return level;
  }

  async findOne(id: string, schoolId: string) {
    const level = await this.prisma.level.findFirst({
      where: { id, schoolId },
    });

    if (!level) {
      throw new NotFoundException('Level not found');
    }

    return level;
  }

  async update(
    id: string,
    dto: UpdateLevelDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    const updated = await this.prisma.level.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.gesDesignation !== undefined && { gesDesignation: dto.gesDesignation }),
        ...(dto.abekaDesignation !== undefined && { abekaDesignation: dto.abekaDesignation }),
        ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
        ...(dto.levelGroup !== undefined && { levelGroup: dto.levelGroup }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'levels.updated',
      module: 'levels',
      entityType: 'level',
      entityId: id,
      changes: {
        before: {
          name: existing.name,
          gesDesignation: existing.gesDesignation,
          abekaDesignation: existing.abekaDesignation,
          orderIndex: existing.orderIndex,
          levelGroup: existing.levelGroup,
        },
        after: dto,
      },
    });

    return updated;
  }

  async archive(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    const archived = await this.prisma.level.update({
      where: { id },
      data: {
        isActive: false,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'levels.archived',
      module: 'levels',
      entityType: 'level',
      entityId: id,
    });

    return archived;
  }
}
