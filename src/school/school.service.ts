import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UpdateSchoolDto } from './dto/update-school.dto';

@Injectable()
export class SchoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findOne(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    return school;
  }

  async update(
    schoolId: string,
    dto: UpdateSchoolDto,
    userId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(schoolId);

    const updated = await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        ...dto,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'school.updated',
      module: 'school',
      entityType: 'school',
      entityId: schoolId,
      changes: {
        before: {
          name: existing.name,
          logoUrl: existing.logoUrl,
          address: existing.address,
          ghanaPostGps: existing.ghanaPostGps,
          phone: existing.phone,
          email: existing.email,
          motto: existing.motto,
          registrationNumber: existing.registrationNumber,
        },
        after: dto,
      },
    });

    return updated;
  }
}
