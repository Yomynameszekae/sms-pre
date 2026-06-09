import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateAdmissionDto } from './dto/create-admission.dto';
import { UpdateAdmissionDto } from './dto/update-admission.dto';
import { OfferAdmissionDto } from './dto/offer-admission.dto';
import { EnrollAdmissionDto } from './dto/enroll-admission.dto';
import { QueryAdmissionsDto } from './dto/query-admissions.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateAdmissionDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const admission = await this.prisma.admissionApplication.create({
      data: {
        schoolId,
        studentId: dto.studentId ?? null,
        intendedLevelId: dto.intendedLevelId ?? null,
        curriculumInterest: dto.curriculumInterest,
        enquirySource: dto.enquirySource ?? null,
        notes: dto.notes ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'admissions.created',
      module: 'admissions',
      entityType: 'admission_application',
      entityId: admission.id,
      changes: { after: dto },
    });

    return admission;
  }

  async findAll(schoolId: string, query: QueryAdmissionsDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: Prisma.AdmissionApplicationWhereInput = { schoolId };
    if (query.status) where.status = query.status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.admissionApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.admissionApplication.count({ where }),
    ]);

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    const admission = await this.prisma.admissionApplication.findFirst({
      where: { id, schoolId },
    });

    if (!admission) {
      throw new NotFoundException('Admission application not found');
    }

    return admission;
  }

  async update(
    id: string,
    dto: UpdateAdmissionDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    const updated = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        ...(dto.admissionNumber !== undefined && { admissionNumber: dto.admissionNumber }),
        ...(dto.studentId !== undefined && { studentId: dto.studentId }),
        ...(dto.intendedLevelId !== undefined && { intendedLevelId: dto.intendedLevelId }),
        ...(dto.curriculumInterest !== undefined && { curriculumInterest: dto.curriculumInterest }),
        ...(dto.enquirySource !== undefined && { enquirySource: dto.enquirySource }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.status !== undefined && { status: dto.status }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'admissions.updated',
      module: 'admissions',
      entityType: 'admission_application',
      entityId: id,
      changes: {
        before: {
          admissionNumber: existing.admissionNumber,
          status: existing.status,
          notes: existing.notes,
          curriculumInterest: existing.curriculumInterest,
          enquirySource: existing.enquirySource,
        },
        after: dto,
      },
    });

    return updated;
  }

  async offer(
    id: string,
    dto: OfferAdmissionDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    if (
      existing.status !== 'enquiry' &&
      existing.status !== 'application'
    ) {
      throw new BadRequestException(
        'Offer can only be made for applications in enquiry or application status',
      );
    }

    const updated = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        status: 'offered',
        offeredAt: new Date(),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'admissions.offered',
      module: 'admissions',
      entityType: 'admission_application',
      entityId: id,
      changes: {
        before: { status: existing.status },
        after: { status: 'offered', offeredAt: updated.offeredAt },
      },
    });

    return updated;
  }

  async enroll(
    id: string,
    dto: EnrollAdmissionDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const admission = await this.findOne(id, schoolId);

    // If a studentId is provided in the DTO, verify the student belongs to this school
    if (dto.studentId) {
      const student = await this.prisma.student.findFirst({
        where: { id: dto.studentId, schoolId },
      });
      if (!student) {
        throw new NotFoundException(
          'Student not found or does not belong to this school',
        );
      }
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

    // Determine the studentId to use (from DTO or from existing admission)
    const effectiveStudentId = dto.studentId ?? admission.studentId;
    if (!effectiveStudentId) {
      throw new BadRequestException(
        'A studentId must be provided either in the request or already associated with the admission application',
      );
    }

    // Create enrollment record
    let enrollment: any;
    try {
      enrollment = await this.prisma.enrollment.create({
        data: {
          schoolId,
          studentId: effectiveStudentId,
          classroomId: dto.classroomId,
          academicYearId: dto.academicYearId,
          curriculumTrack: dto.curriculumTrack,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Student already has an active enrollment for this academic year',
        );
      }
      throw err;
    }

    // Update the admission application
    const updatedAdmission = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        status: 'enrolled',
        enrolledAt: new Date(),
        ...(dto.studentId && { studentId: dto.studentId }),
        updatedBy: userId,
      },
    });

    // Audit log for admission update
    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'admissions.updated',
      module: 'admissions',
      entityType: 'admission_application',
      entityId: id,
      changes: {
        before: { status: admission.status, studentId: admission.studentId },
        after: { status: 'enrolled', studentId: effectiveStudentId, enrolledAt: updatedAdmission.enrolledAt },
      },
    });

    // Audit log for enrollment creation
    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'enrollments.created',
      module: 'enrollments',
      entityType: 'enrollment',
      entityId: enrollment.id,
      changes: {
        after: {
          studentId: effectiveStudentId,
          classroomId: dto.classroomId,
          academicYearId: dto.academicYearId,
          curriculumTrack: dto.curriculumTrack,
        },
      },
    });

    return { admission: updatedAdmission, enrollment };
  }
}
