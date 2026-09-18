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
import { TransitionNotesDto } from './dto/transition-admission.dto';
import { EnrollAdmissionDto } from './dto/enroll-admission.dto';
import { QueryAdmissionsDto } from './dto/query-admissions.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';
import {
  nextDocumentNumber,
  isUniqueViolationOn,
} from '../common/utils/document-number.util';

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
    // The admission number is claimed from the document sequence inside the
    // same transaction as the insert, so number consumption and record
    // creation commit together. A manually edited number can occupy a value
    // the sequence has not reached yet; on that P2002 we claim the next value
    // and retry, bounded.
    const MAX_ATTEMPTS = 3;
    let admission!: Awaited<
      ReturnType<typeof this.prisma.admissionApplication.create>
    >;
    for (let attempt = 1; ; attempt++) {
      try {
        admission = await this.prisma.$transaction(async (tx) => {
          const admissionNumber = await nextDocumentNumber(
            tx,
            schoolId,
            'admission_number',
          );
          return tx.admissionApplication.create({
            data: {
              schoolId,
              admissionNumber,
              studentId: dto.studentId ?? null,
              intendedLevelId: dto.intendedLevelId ?? null,
              curriculumInterest: dto.curriculumInterest,
              enquirySource: dto.enquirySource ?? null,
              notes: dto.notes ?? null,
              createdBy: userId,
              updatedBy: userId,
            },
          });
        });
        break;
      } catch (err) {
        if (
          attempt < MAX_ATTEMPTS &&
          isUniqueViolationOn(err, /admission_number|admission_school_number/)
        ) {
          continue;
        }
        throw err;
      }
    }

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'admissions.created',
      module: 'admissions',
      entityType: 'admission_application',
      entityId: admission.id,
      changes: { after: { ...dto, admissionNumber: admission.admissionNumber } },
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

    let updated;
    try {
      updated = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        ...(dto.admissionNumber !== undefined && { admissionNumber: dto.admissionNumber }),
        ...(dto.studentId !== undefined && { studentId: dto.studentId }),
        ...(dto.intendedLevelId !== undefined && { intendedLevelId: dto.intendedLevelId }),
        ...(dto.curriculumInterest !== undefined && { curriculumInterest: dto.curriculumInterest }),
        ...(dto.enquirySource !== undefined && { enquirySource: dto.enquirySource }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedBy: userId,
      },
      });
    } catch (err) {
      if (isUniqueViolationOn(err, /admission_number|admission_school_number/)) {
        throw new ConflictException(
          `Admission number ${dto.admissionNumber} is already in use`,
        );
      }
      throw err;
    }

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
      throw new ConflictException(
        'Offer can only be made for applications in enquiry or application status',
      );
    }

    // approvedBy is a foreign key to STAFF, not users — resolve the acting
    // user's linked staff record. Users linked to a guardian (or nothing)
    // approve with a null staff link; the audit entry still records userId.
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { linkedEntityType: true, linkedEntityId: true },
    });
    const approvedBy =
      actor?.linkedEntityType === 'staff' ? actor.linkedEntityId : null;

    const now = new Date();
    const updated = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        status: 'offered',
        offeredAt: now,
        approvedBy,
        approvedAt: now,
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
        after: { status: 'offered', offeredAt: updated.offeredAt, approvedBy },
      },
    });

    return updated;
  }

  /** enquiry → application: the paperwork stage is formally opened. */
  async apply(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (existing.status !== 'enquiry') {
      throw new ConflictException(
        `Only an enquiry can move to application (this admission is ${existing.status})`,
      );
    }

    const updated = await this.prisma.admissionApplication.update({
      where: { id },
      data: { status: 'application', updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'admissions.application_submitted',
      module: 'admissions',
      entityType: 'admission_application',
      entityId: id,
      changes: { before: { status: existing.status }, after: { status: 'application' } },
    });

    return updated;
  }

  /**
   * offered → application. Clears exactly what offer() set. The student link
   * is retained on every reversal — it is a factual association, not stage
   * state.
   */
  async revertOffer(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (existing.status !== 'offered') {
      throw new ConflictException(
        `Only an offered admission can have its offer reverted (this admission is ${existing.status})`,
      );
    }

    const updated = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        status: 'application',
        offeredAt: null,
        approvedBy: null,
        approvedAt: null,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'admissions.offer_reverted',
      module: 'admissions',
      entityType: 'admission_application',
      entityId: id,
      changes: {
        before: { status: 'offered', offeredAt: existing.offeredAt, approvedBy: existing.approvedBy },
        after: { status: 'application', offeredAt: null, approvedBy: null },
      },
    });

    return updated;
  }

  /** enquiry | application | offered → rejected (terminal). School declines. */
  async reject(
    id: string,
    dto: TransitionNotesDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    return this.terminalTransition(id, 'rejected', 'admissions.rejected', dto, userId, schoolId, requestId);
  }

  /** enquiry | application | offered → withdrawn (terminal). Family declines. */
  async withdraw(
    id: string,
    dto: TransitionNotesDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    return this.terminalTransition(id, 'withdrawn', 'admissions.withdrawn', dto, userId, schoolId, requestId);
  }

  private async terminalTransition(
    id: string,
    target: 'rejected' | 'withdrawn',
    action: string,
    dto: TransitionNotesDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);
    const allowed = ['enquiry', 'application', 'offered'];
    if (!allowed.includes(existing.status)) {
      throw new ConflictException(
        `An admission can only be ${target} while in enquiry, application, or offered status (this admission is ${existing.status})`,
      );
    }

    const updated = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        status: target,
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action,
      module: 'admissions',
      entityType: 'admission_application',
      entityId: id,
      changes: { before: { status: existing.status }, after: { status: target } },
    });

    return updated;
  }

  /**
   * enrolled → offered — mistake correction only.
   *
   * Guard: the admission's student must have NO enrollment in any state other
   * than 'withdrawn'. An active enrollment must be withdrawn first (through
   * the enrollments module, with its own exit date, reason, and audit trail).
   * A completed, graduated, or transferred enrollment records a REAL outcome —
   * the offer was genuinely taken up and run to term — and reverting the
   * admission would falsify that history, so it is refused outright.
   *
   * The guard is student-wide because the admission record does not store
   * which enrollment its enroll() call created (and the approved design adds
   * no columns). Conservative over-blocking of stale-admission reverts after
   * a student re-enrolls elsewhere is accepted.
   */
  async revertEnrollment(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (existing.status !== 'enrolled') {
      throw new ConflictException(
        `Only an enrolled admission can have its enrollment reverted (this admission is ${existing.status})`,
      );
    }

    if (existing.studentId) {
      const blocking = await this.prisma.enrollment.findFirst({
        where: {
          schoolId,
          studentId: existing.studentId,
          status: { not: 'withdrawn' },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (blocking?.status === 'active') {
        throw new ConflictException('Withdraw the enrollment first.');
      }
      if (blocking) {
        throw new ConflictException(
          `Cannot revert: the student's enrollment is ${blocking.status}, which records a real outcome. Reversal is only available after an enrollment is withdrawn.`,
        );
      }
    }

    const updated = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        status: 'offered',
        enrolledAt: null,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'admissions.enrollment_reverted',
      module: 'admissions',
      entityType: 'admission_application',
      entityId: id,
      changes: {
        before: { status: 'enrolled', enrolledAt: existing.enrolledAt, studentId: existing.studentId },
        after: { status: 'offered', enrolledAt: null, studentId: existing.studentId },
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

    // Enrollments may be created for the active year, a not-yet-activated
    // current year, or a future year (pre-enrollment is the admissions
    // season). Only a year that has already ENDED is refused.
    if (academicYear.endDate < new Date()) {
      throw new ConflictException(
        `Cannot enroll into ${academicYear.label}: the academic year ended on ` +
          `${academicYear.endDate.toISOString().slice(0, 10)}.`,
      );
    }

    // The classroom must belong to the selected academic year. The
    // one-active-enrollment constraint keys on academicYearId, so a
    // mismatched pair would leave the duplicate guard protecting a year the
    // student has no classroom in.
    if (classroom.academicYearId !== dto.academicYearId) {
      const classroomYear = await this.prisma.academicYear.findFirst({
        where: { id: classroom.academicYearId },
        select: { label: true },
      });
      throw new ConflictException(
        `Classroom '${classroom.displayName}' belongs to the ` +
          `${classroomYear?.label ?? 'unknown'} academic year, not ` +
          `${academicYear.label}. Pick a classroom from the selected year.`,
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
        // Same constraint as EnrollmentsService.create — see the note there.
        throw new ConflictException(
          'Student already has an active enrollment for this academic year. ' +
            'Withdraw it before creating another one.',
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
