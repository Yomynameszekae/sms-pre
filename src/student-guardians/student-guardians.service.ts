import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateStudentGuardianDto } from './dto/create-student-guardian.dto';
import { UpdateStudentGuardianDto } from './dto/update-student-guardian.dto';

@Injectable()
export class StudentGuardiansService {
  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  async link(
    dto: CreateStudentGuardianDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    // Verify student belongs to this school
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId },
      select: { id: true, schoolId: true },
    });
    if (!student) {
      throw new NotFoundException(`Student with id ${dto.studentId} not found`);
    }
    if (student.schoolId !== schoolId) {
      throw new BadRequestException('Student does not belong to this school');
    }

    // Verify guardian belongs to this school
    const guardian = await this.prisma.guardian.findFirst({
      where: { id: dto.guardianId },
      select: { id: true, schoolId: true },
    });
    if (!guardian) {
      throw new NotFoundException(`Guardian with id ${dto.guardianId} not found`);
    }
    if (guardian.schoolId !== schoolId) {
      throw new BadRequestException('Guardian does not belong to this school');
    }

    try {
      const studentGuardian = await this.prisma.studentGuardian.create({
        data: {
          schoolId,
          studentId: dto.studentId,
          guardianId: dto.guardianId,
          relationship: dto.relationship,
          isPrimary: dto.isPrimary ?? false,
          isEmergencyContact: dto.isEmergencyContact ?? false,
          canReceiveSms: dto.canReceiveSms ?? true,
          canAccessPortal: dto.canAccessPortal ?? true,
          createdBy: userId,
        },
        include: {
          student: true,
          guardian: true,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'student_guardians.linked',
        module: 'student-guardians',
        entityType: 'studentGuardian',
        entityId: studentGuardian.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return studentGuardian;
    } catch (err) {
      if (err?.code === 'P2002') {
        // Could be the unique index on (studentId, guardianId) or the partial
        // index uq_one_primary_guardian_per_student
        if (dto.isPrimary) {
          throw new ConflictException('Student already has a primary guardian');
        }
        throw new ConflictException(
          'This guardian is already linked to this student',
        );
      }
      throw err;
    }
  }

  private async findStudentGuardian(id: string, schoolId: string) {
    const record = await this.prisma.studentGuardian.findFirst({
      where: { id, schoolId },
    });
    if (!record) {
      throw new NotFoundException(`StudentGuardian with id ${id} not found`);
    }
    return record;
  }

  async update(
    id: string,
    dto: UpdateStudentGuardianDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findStudentGuardian(id, schoolId);

    try {
      const record = await this.prisma.studentGuardian.update({
        where: { id },
        data: {
          ...(dto.relationship !== undefined && { relationship: dto.relationship }),
          ...(dto.isPrimary !== undefined && { isPrimary: dto.isPrimary }),
          ...(dto.isEmergencyContact !== undefined && {
            isEmergencyContact: dto.isEmergencyContact,
          }),
          ...(dto.canReceiveSms !== undefined && { canReceiveSms: dto.canReceiveSms }),
          ...(dto.canAccessPortal !== undefined && { canAccessPortal: dto.canAccessPortal }),
        },
        include: {
          student: true,
          guardian: true,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'student_guardians.updated',
        module: 'student-guardians',
        entityType: 'studentGuardian',
        entityId: record.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return record;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException('Student already has a primary guardian');
      }
      throw err;
    }
  }

  async setPrimary(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const link = await this.findStudentGuardian(id, schoolId);

    // Two-step swap in one transaction, respecting
    // uq_one_primary_guardian_per_student. An ARCHIVED guardian still holding
    // the primary slot is an anomaly — its link is demoted silently. An
    // ACTIVE guardian holding it is a deliberate state — displacing it stays
    // an explicit 409, exactly as before.
    let displaced: { id: string; guardianName: string } | null = null;
    const record = await this.prisma.$transaction(async (tx) => {
      const current = await tx.studentGuardian.findFirst({
        where: { studentId: link.studentId, isPrimary: true, NOT: { id } },
        include: { guardian: { select: { archivedAt: true, firstName: true, lastName: true } } },
      });
      if (current && !current.guardian.archivedAt) {
        throw new ConflictException('Student already has a primary guardian');
      }
      if (current) {
        await tx.studentGuardian.update({
          where: { id: current.id },
          data: { isPrimary: false },
        });
        displaced = {
          id: current.id,
          guardianName: `${current.guardian.firstName} ${current.guardian.lastName}`,
        };
      }
      return tx.studentGuardian.update({
        where: { id },
        data: { isPrimary: true },
        include: { student: true, guardian: true },
      });
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'student_guardians.primary_set',
      module: 'student-guardians',
      entityType: 'studentGuardian',
      entityId: record.id,
      changes: displaced
        ? { displacedArchivedGuardianLink: displaced }
        : undefined,
    });

    return record;
  }

  async unlink(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findStudentGuardian(id, schoolId);

    await this.prisma.studentGuardian.delete({ where: { id } });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'student_guardians.unlinked',
      module: 'student-guardians',
      entityType: 'studentGuardian',
      entityId: id,
    });

    return { message: 'Student-guardian link removed successfully' };
  }
}
