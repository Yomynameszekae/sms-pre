import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class SchoolSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(schoolId: string) {
    return this.prisma.schoolSetting.findMany({
      where: { schoolId, isActive: true },
      orderBy: { key: 'asc' },
    });
  }

  async findByKey(schoolId: string, key: string) {
    const setting = await this.prisma.schoolSetting.findUnique({
      where: { schoolId_key: { schoolId, key } },
    });

    if (!setting) {
      throw new NotFoundException(`School setting '${key}' not found`);
    }

    return setting;
  }

  async update(
    schoolId: string,
    key: string,
    valueJson: any,
    userId: string,
    requestId?: string,
  ) {
    const existing = await this.prisma.schoolSetting.findUnique({
      where: { schoolId_key: { schoolId, key } },
    });

    const upserted = await this.prisma.schoolSetting.upsert({
      where: { schoolId_key: { schoolId, key } },
      create: {
        schoolId,
        key,
        valueJson,
        isActive: true,
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        valueJson,
        isActive: true,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'school_settings.updated',
      module: 'school_settings',
      entityType: 'school_setting',
      entityId: upserted.id,
      changes: {
        before: existing ? { key, valueJson: existing.valueJson } : null,
        after: { key, valueJson },
      },
    });

    return upserted;
  }
}
