import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { WithdrawEnrollmentDto } from './dto/withdraw-enrollment.dto';
import { QueryEnrollmentsDto } from './dto/query-enrollments.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateEnrollmentDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    // Verify student belongs to this school
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId },
    });
    if (!student) {
      throw new NotFoundException(
        'Student not found or does not belong to this school',
      );
    }

    // Verify classroom belongs to this school
    const classroom = await this.prisma.classroom.findFirst({
      where: { id: dto.classroomId, schoolId },
    });
    if (!classroom) {
      throw new NotFoundException(
        'Classroom not found or does not belong to this school',
      );
    }

    // Verify academic year belongs to this school
    const academicYear = await this.prisma.academicYear.findFirst({
      where: { id: dto.academicYearId, schoolId },
    });
    if (!academicYear) {
      throw new NotFoundException(
        'Academic year not found or does not belong to this school',
      );
    }

    try {
      const enrollment = await this.prisma.enrollment.create({
        data: {
          schoolId,
          studentId: dto.studentId,
          classroomId: dto.classroomId,
          academicYearId: dto.academicYearId,
          curriculumTrack: dto.curriculumTrack,
          ...(dto.enrollmentDate && { enrollmentDate: new Date(dto.enrollmentDate) }),
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'enrollments.created',
        module: 'enrollments',
        entityType: 'enrollment',
        entityId: enrollment.id,
        changes: { after: dto },
      });

      return enrollment;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Student already has an active enrollment for this academic year and curriculum track',
        );
      }
      throw err;
    }
  }

  async findAll(schoolId: string, query: QueryEnrollmentsDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: Prisma.EnrollmentWhereInput = { schoolId };
    if (query.studentId) where.studentId = query.studentId;
    if (query.classroomId) where.classroomId = query.classroomId;
    if (query.academicYearId) where.academicYearId = query.academicYearId;
    if (query.status) where.status = query.status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.enrollment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.enrollment.count({ where }),
    ]);

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id, schoolId },
    });

    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    return enrollment;
  }

  async update(
    id: string,
    dto: UpdateEnrollmentDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    const updated = await this.prisma.enrollment.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'enrollments.updated',
      module: 'enrollments',
      entityType: 'enrollment',
      entityId: id,
      changes: {
        before: { status: existing.status },
        after: dto,
      },
    });

    return updated;
  }

  async withdraw(
    id: string,
    dto: WithdrawEnrollmentDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    const updated = await this.prisma.enrollment.update({
      where: { id },
      data: {
        status: 'withdrawn',
        exitDate: new Date(dto.exitDate),
        exitReason: dto.exitReason,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'enrollments.withdrawn',
      module: 'enrollments',
      entityType: 'enrollment',
      entityId: id,
      changes: {
        before: { status: existing.status, exitDate: existing.exitDate, exitReason: existing.exitReason },
        after: { status: 'withdrawn', exitDate: dto.exitDate, exitReason: dto.exitReason },
      },
    });

    return updated;
  }
}
