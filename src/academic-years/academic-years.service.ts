import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AcademicYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateAcademicYearDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const academicYear = await this.prisma.academicYear.create({
      data: {
        schoolId,
        label: dto.label,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'academic_years.created',
      module: 'academic-years',
      entityType: 'academic_year',
      entityId: academicYear.id,
      changes: { after: dto },
    });

    return academicYear;
  }

  async findAll(schoolId: string) {
    return this.prisma.academicYear.findMany({
      where: { schoolId },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(id: string, schoolId: string) {
    const academicYear = await this.prisma.academicYear.findFirst({
      where: { id, schoolId },
    });

    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }

    return academicYear;
  }

  async update(
    id: string,
    dto: UpdateAcademicYearDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    const updated = await this.prisma.academicYear.update({
      where: { id },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'academic_years.updated',
      module: 'academic-years',
      entityType: 'academic_year',
      entityId: id,
      changes: {
        before: {
          label: existing.label,
          startDate: existing.startDate,
          endDate: existing.endDate,
        },
        after: dto,
      },
    });

    return updated;
  }

  async activate(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    try {
      const activated = await this.prisma.academicYear.update({
        where: { id },
        data: {
          isActive: true,
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'academic_years.activated',
        module: 'academic-years',
        entityType: 'academic_year',
        entityId: id,
      });

      return activated;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another academic year is already active for this school',
        );
      }
      throw err;
    }
  }

  async close(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    const closed = await this.prisma.academicYear.update({
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
      action: 'academic_years.closed',
      module: 'academic-years',
      entityType: 'academic_year',
      entityId: id,
    });

    return closed;
  }
}
