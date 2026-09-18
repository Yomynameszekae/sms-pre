import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { getPaginationParams, paginate } from '../common/utils/pagination.util';
import {
  nextDocumentNumber,
  isUniqueViolationOn,
} from '../common/utils/document-number.util';
import { StaffStatus } from '@prisma/client';

function staffDuplicateMessage(target: unknown): string {
  const fields = Array.isArray(target)
    ? (target as string[])
    : typeof target === 'string'
      ? [target]
      : [];
  if (fields.some((f) => f.includes('staff_number') || f.includes('staffNumber'))) {
    return 'A staff member with this staff number already exists in this school';
  }
  if (fields.some((f) => f.includes('phone'))) {
    return 'A staff member with this phone number already exists in this school';
  }
  if (fields.some((f) => f.includes('email'))) {
    return 'A staff member with this email address already exists in this school';
  }
  return 'A staff member with these details already exists in this school';
}

@Injectable()
export class StaffService {
  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  async create(
    dto: CreateStaffDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    try {
      const staff = await this.createWithNumber(dto, userId, schoolId);

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'staff.created',
        module: 'staff',
        entityType: 'staff',
        entityId: staff.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return staff;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException(staffDuplicateMessage(err.meta?.target));
      }
      throw err;
    }
  }


  /**
   * Inserts the staff member, auto-claiming the next STF number when the DTO
   * does not provide one. Same transaction + bounded-retry pattern as
   * StudentsService.createWithNumber.
   */
  private async createWithNumber(
    dto: CreateStaffDto,
    userId: string,
    schoolId: string,
  ) {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const staffNumber =
            dto.staffNumber ??
            (await nextDocumentNumber(tx, schoolId, 'staff_number'));
          return tx.staff.create({
            data: {
              schoolId,
              staffNumber,
              firstName: dto.firstName,
              lastName: dto.lastName,
              phone: dto.phone,
              email: dto.email,
              roleCategory: dto.roleCategory,
              employmentType: dto.employmentType,
              ntcRegistrationNumber: dto.ntcRegistrationNumber,
              ntcStatus: dto.ntcStatus,
              joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
              createdBy: userId,
            },
          });
        });
      } catch (err) {
        if (
          !dto.staffNumber &&
          attempt < MAX_ATTEMPTS &&
          isUniqueViolationOn(err, /staff_number/)
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  async findAll(schoolId: string, query: QueryStaffDto) {
    const { skip, take } = getPaginationParams(query.page, query.limit);

    const where: any = { schoolId };
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { staffNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) where.status = query.status;
    if (query.roleCategory) where.roleCategory = query.roleCategory;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.staff.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.staff.count({ where }),
    ]);

    return paginate(items, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string, schoolId: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id, schoolId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff member with id ${id} not found`);
    }
    return staff;
  }

  async update(
    id: string,
    dto: UpdateStaffDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    try {
      const staff = await this.prisma.staff.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined && { firstName: dto.firstName }),
          ...(dto.lastName !== undefined && { lastName: dto.lastName }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.roleCategory !== undefined && { roleCategory: dto.roleCategory }),
          ...(dto.employmentType !== undefined && { employmentType: dto.employmentType }),
          ...(dto.ntcRegistrationNumber !== undefined && {
            ntcRegistrationNumber: dto.ntcRegistrationNumber,
          }),
          ...(dto.ntcStatus !== undefined && { ntcStatus: dto.ntcStatus }),
          ...(dto.joinedAt !== undefined && { joinedAt: new Date(dto.joinedAt) }),
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'staff.updated',
        module: 'staff',
        entityType: 'staff',
        entityId: staff.id,
        changes: dto as unknown as Record<string, unknown>,
      });

      return staff;
    } catch (err) {
      if (err?.code === 'P2002') {
        throw new ConflictException(staffDuplicateMessage(err.meta?.target));
      }
      throw err;
    }
  }

  /**
   * Inverse of archive. Fixed restore state: status='active' — archive is the
   * only writer of staff status in Phase 1, so the pre-archive status was
   * always 'active' in every reachable case.
   */
  async restore(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (!existing.archivedAt) {
      throw new ConflictException('Staff member is not archived');
    }

    const staff = await this.prisma.staff.update({
      where: { id },
      data: { status: 'active', archivedAt: null, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'staff.restored',
      module: 'staff',
      entityType: 'staff',
      entityId: id,
      changes: {
        before: { status: existing.status, archivedAt: existing.archivedAt },
        after: { status: 'active', archivedAt: null },
      },
    });

    return staff;
  }

  async archive(
    id: string,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    await this.findOne(id, schoolId);

    const staff = await this.prisma.staff.update({
      where: { id },
      data: {
        status: StaffStatus.terminated,
        archivedAt: new Date(),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'staff.archived',
      module: 'staff',
      entityType: 'staff',
      entityId: staff.id,
    });

    return staff;
  }
}
