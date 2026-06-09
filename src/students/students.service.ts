import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { QueryStudentsDto } from './dto/query-students.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';
import { EnrollmentStatus } from '@prisma/client';

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateStudentDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    try {
      const student = await this.prisma.student.create({
        data: {
          schoolId,
          studentNumber: dto.studentNumber,
          firstName: dto.firstName,
          middleName: dto.middleName,
          lastName: dto.lastName,
          preferredName: dto.preferredName,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          nationality: dto.nationality,
          religion: dto.religion,
          ghanaCardId: dto.ghanaCardId,
          previousSchool: dto.previousSchool,
          admissionDate: dto.admissionDate ? new Date(dto.admissionDate) : undefined,
          createdBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'students.created',
        module: 'students',
        entityType: 'student',
        entityId: student.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return student;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A student with this student number already exists in this school',
        );
      }
      throw err;
    }
  }

  async findAll(schoolId: string, query: QueryStudentsDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: any = { schoolId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.student.count({ where }),
    ]);

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId },
    });
    if (!student) {
      throw new NotFoundException(`Student with id ${id} not found`);
    }
    return student;
  }

  async update(
    id: string,
    dto: UpdateStudentDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    try {
      const student = await this.prisma.student.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined && { firstName: dto.firstName }),
          ...(dto.middleName !== undefined && { middleName: dto.middleName }),
          ...(dto.lastName !== undefined && { lastName: dto.lastName }),
          ...(dto.preferredName !== undefined && { preferredName: dto.preferredName }),
          ...(dto.dateOfBirth !== undefined && { dateOfBirth: new Date(dto.dateOfBirth) }),
          ...(dto.gender !== undefined && { gender: dto.gender }),
          ...(dto.nationality !== undefined && { nationality: dto.nationality }),
          ...(dto.religion !== undefined && { religion: dto.religion }),
          ...(dto.ghanaCardId !== undefined && { ghanaCardId: dto.ghanaCardId }),
          ...(dto.previousSchool !== undefined && { previousSchool: dto.previousSchool }),
          ...(dto.admissionDate !== undefined && {
            admissionDate: new Date(dto.admissionDate),
          }),
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'students.updated',
        module: 'students',
        entityType: 'student',
        entityId: student.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return student;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A student with this student number already exists in this school',
        );
      }
      throw err;
    }
  }

  async archive(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    const student = await this.prisma.student.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        status: EnrollmentStatus.withdrawn,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'students.archived',
      module: 'students',
      entityType: 'student',
      entityId: student.id,
    });

    return student;
  }

  async getGuardians(id: string, schoolId: string) {
    await this.findOne(id, schoolId);

    return this.prisma.studentGuardian.findMany({
      where: { studentId: id, schoolId },
      include: { guardian: true },
    });
  }

  async getEnrollments(id: string, schoolId: string) {
    await this.findOne(id, schoolId);

    return this.prisma.enrollment.findMany({
      where: { studentId: id },
    });
  }
}
