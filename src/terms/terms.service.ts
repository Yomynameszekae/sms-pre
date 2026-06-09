import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TermStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';

@Injectable()
export class TermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateTermDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    // Verify the academic year belongs to the same school
    const academicYear = await this.prisma.academicYear.findFirst({
      where: { id: dto.academicYearId, schoolId },
    });

    if (!academicYear) {
      throw new NotFoundException(
        'Academic year not found or does not belong to this school',
      );
    }

    const term = await this.prisma.term.create({
      data: {
        schoolId,
        academicYearId: dto.academicYearId,
        termNumber: dto.termNumber,
        label: dto.label,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        ...(dto.examStartDate && { examStartDate: new Date(dto.examStartDate) }),
        ...(dto.examEndDate && { examEndDate: new Date(dto.examEndDate) }),
        ...(dto.curriculumScope && { curriculumScope: dto.curriculumScope }),
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'terms.created',
      module: 'terms',
      entityType: 'term',
      entityId: term.id,
      changes: { after: dto },
    });

    return term;
  }

  async findAll(schoolId: string, academicYearId?: string) {
    return this.prisma.term.findMany({
      where: {
        schoolId,
        ...(academicYearId && { academicYearId }),
      },
      orderBy: [{ academicYearId: 'asc' }, { termNumber: 'asc' }],
    });
  }

  async findOne(id: string, schoolId: string) {
    const term = await this.prisma.term.findFirst({
      where: { id, schoolId },
    });

    if (!term) {
      throw new NotFoundException('Term not found');
    }

    return term;
  }

  async update(
    id: string,
    dto: UpdateTermDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    // If academicYearId is being changed, verify it belongs to the same school
    if (dto.academicYearId && dto.academicYearId !== existing.academicYearId) {
      const academicYear = await this.prisma.academicYear.findFirst({
        where: { id: dto.academicYearId, schoolId },
      });
      if (!academicYear) {
        throw new NotFoundException(
          'Academic year not found or does not belong to this school',
        );
      }
    }

    const updated = await this.prisma.term.update({
      where: { id },
      data: {
        ...(dto.academicYearId !== undefined && { academicYearId: dto.academicYearId }),
        ...(dto.termNumber !== undefined && { termNumber: dto.termNumber }),
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
        ...(dto.examStartDate !== undefined && {
          examStartDate: dto.examStartDate ? new Date(dto.examStartDate) : null,
        }),
        ...(dto.examEndDate !== undefined && {
          examEndDate: dto.examEndDate ? new Date(dto.examEndDate) : null,
        }),
        ...(dto.curriculumScope !== undefined && { curriculumScope: dto.curriculumScope }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'terms.updated',
      module: 'terms',
      entityType: 'term',
      entityId: id,
      changes: {
        before: {
          termNumber: existing.termNumber,
          label: existing.label,
          startDate: existing.startDate,
          endDate: existing.endDate,
          examStartDate: existing.examStartDate,
          examEndDate: existing.examEndDate,
          curriculumScope: existing.curriculumScope,
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
      const activated = await this.prisma.term.update({
        where: { id },
        data: {
          status: TermStatus.active,
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'terms.activated',
        module: 'terms',
        entityType: 'term',
        entityId: id,
      });

      return activated;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another term is already active for this school',
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

    const closed = await this.prisma.term.update({
      where: { id },
      data: {
        status: TermStatus.closed,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'terms.closed',
      module: 'terms',
      entityType: 'term',
      entityId: id,
    });

    return closed;
  }
}
