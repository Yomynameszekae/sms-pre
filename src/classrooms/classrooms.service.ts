import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';

@Injectable()
export class ClassroomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateClassroomDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    // Verify the level belongs to the same school
    const level = await this.prisma.level.findFirst({
      where: { id: dto.levelId, schoolId },
    });
    if (!level) {
      throw new NotFoundException(
        'Level not found or does not belong to this school',
      );
    }

    // Verify the academic year belongs to the same school
    const academicYear = await this.prisma.academicYear.findFirst({
      where: { id: dto.academicYearId, schoolId },
    });
    if (!academicYear) {
      throw new NotFoundException(
        'Academic year not found or does not belong to this school',
      );
    }

    const classroom = await this.prisma.classroom.create({
      data: {
        schoolId,
        levelId: dto.levelId,
        academicYearId: dto.academicYearId,
        sectionLabel: dto.sectionLabel,
        displayName: dto.displayName,
        capacity: dto.capacity ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'classrooms.created',
      module: 'classrooms',
      entityType: 'classroom',
      entityId: classroom.id,
      changes: { after: dto },
    });

    return classroom;
  }

  async findAll(
    schoolId: string,
    levelId?: string,
    academicYearId?: string,
  ) {
    return this.prisma.classroom.findMany({
      where: {
        schoolId,
        ...(levelId && { levelId }),
        ...(academicYearId && { academicYearId }),
      },
      include: {
        level: true,
        academicYear: true,
        classTeacher: true,
      },
      orderBy: { displayName: 'asc' },
    });
  }

  async findOne(id: string, schoolId: string) {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id, schoolId },
      include: {
        level: true,
        academicYear: true,
        classTeacher: true,
      },
    });

    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    return classroom;
  }

  async update(
    id: string,
    dto: UpdateClassroomDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);

    // If levelId is being changed, verify it belongs to the same school
    if (dto.levelId && dto.levelId !== existing.levelId) {
      const level = await this.prisma.level.findFirst({
        where: { id: dto.levelId, schoolId },
      });
      if (!level) {
        throw new NotFoundException(
          'Level not found or does not belong to this school',
        );
      }
    }

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

    const updated = await this.prisma.classroom.update({
      where: { id },
      data: {
        ...(dto.levelId !== undefined && { levelId: dto.levelId }),
        ...(dto.academicYearId !== undefined && { academicYearId: dto.academicYearId }),
        ...(dto.sectionLabel !== undefined && { sectionLabel: dto.sectionLabel }),
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'classrooms.updated',
      module: 'classrooms',
      entityType: 'classroom',
      entityId: id,
      changes: {
        before: {
          levelId: existing.levelId,
          academicYearId: existing.academicYearId,
          sectionLabel: existing.sectionLabel,
          displayName: existing.displayName,
          capacity: existing.capacity,
        },
        after: dto,
      },
    });

    return updated;
  }

  /**
   * Inverse of archive. Restoring under an archived level is refused — level
   * dropdowns list active levels only, so the classroom would reference an
   * invisible parent. Year state is deliberately NOT checked: inactive years
   * include future ones, and blocking on them would be wrong.
   */
  async restore(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (existing.isActive) {
      throw new ConflictException('Classroom is not archived');
    }

    const level = await this.prisma.level.findFirst({
      where: { id: existing.levelId, schoolId },
    });
    if (level && !level.isActive) {
      throw new ConflictException(`Restore the level '${level.name}' first.`);
    }

    const classroom = await this.prisma.classroom.update({
      where: { id },
      data: { isActive: true, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'classrooms.restored',
      module: 'classrooms',
      entityType: 'classroom',
      entityId: id,
      changes: { before: { isActive: false }, after: { isActive: true } },
    });

    return classroom;
  }

  async assignTeacher(
    id: string,
    staffId: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    // Verify the staff member belongs to the same school
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, schoolId },
    });
    if (!staff) {
      throw new NotFoundException(
        'Staff member not found or does not belong to this school',
      );
    }

    // Only active staff can receive new assignments. An EXISTING assignment
    // survives the teacher's termination (persist-with-flag: history of who
    // taught the class is kept; the Assign Teacher dialog flags them).
    if (staff.status !== 'active') {
      throw new ConflictException(
        `Cannot assign ${staff.firstName} ${staff.lastName}: staff member is ${staff.status.replace('_', ' ')}`,
      );
    }

    const updated = await this.prisma.classroom.update({
      where: { id },
      data: {
        classTeacherId: staffId,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'classrooms.teacher_assigned',
      module: 'classrooms',
      entityType: 'classroom',
      entityId: id,
      changes: { staffId },
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

    const archived = await this.prisma.classroom.update({
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
      action: 'classrooms.archived',
      module: 'classrooms',
      entityType: 'classroom',
      entityId: id,
    });

    return archived;
  }
}
