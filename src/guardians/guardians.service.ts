import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { QueryGuardiansDto } from './dto/query-guardians.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';

@Injectable()
export class GuardiansService {
  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateGuardianDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    try {
      const guardian = await this.prisma.guardian.create({
        data: {
          schoolId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phonePrimary: dto.phonePrimary,
          phoneSecondary: dto.phoneSecondary,
          email: dto.email,
          occupation: dto.occupation,
          address: dto.address,
          createdBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'guardians.created',
        module: 'guardians',
        entityType: 'guardian',
        entityId: guardian.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return guardian;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A guardian with this primary phone number already exists in this school',
        );
      }
      throw err;
    }
  }

  async findAll(schoolId: string, query: QueryGuardiansDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: any = { schoolId, archivedAt: null };
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.guardian.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.guardian.count({ where }),
    ]);

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    const guardian = await this.prisma.guardian.findFirst({
      where: { id, schoolId },
    });
    if (!guardian) {
      throw new NotFoundException(`Guardian with id ${id} not found`);
    }
    return guardian;
  }

  async update(
    id: string,
    dto: UpdateGuardianDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    try {
      const guardian = await this.prisma.guardian.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined && { firstName: dto.firstName }),
          ...(dto.lastName !== undefined && { lastName: dto.lastName }),
          ...(dto.phonePrimary !== undefined && { phonePrimary: dto.phonePrimary }),
          ...(dto.phoneSecondary !== undefined && { phoneSecondary: dto.phoneSecondary }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.occupation !== undefined && { occupation: dto.occupation }),
          ...(dto.address !== undefined && { address: dto.address }),
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'guardians.updated',
        module: 'guardians',
        entityType: 'guardian',
        entityId: guardian.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return guardian;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'A guardian with this primary phone number already exists in this school',
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

    const guardian = await this.prisma.guardian.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'guardians.archived',
      module: 'guardians',
      entityType: 'guardian',
      entityId: guardian.id,
    });

    return guardian;
  }

  async getStudents(id: string, schoolId: string) {
    await this.findOne(id, schoolId);

    return this.prisma.studentGuardian.findMany({
      where: { guardianId: id, schoolId },
      include: { student: true },
    });
  }
}
