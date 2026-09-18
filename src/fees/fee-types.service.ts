import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LabelCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateFeeTypeDto } from './dto/create-fee-type.dto';
import { UpdateFeeTypeDto } from './dto/update-fee-type.dto';
import { QueryFeeTypesDto } from './dto/query-fee-types.dto';

@Injectable()
export class FeeTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * The Label link is the first and only consumer of Stage 1a's shared
   * classification. It must be a `fee` label: an expenditure heading on a fee
   * type would put the charge on the wrong side of a future profit and loss,
   * and the whole point of scoping Label uniqueness per category was that the
   * same word can legitimately mean different things in different categories.
   */
  private async assertFeeLabel(labelId: string, schoolId: string) {
    const label = await this.prisma.label.findFirst({ where: { id: labelId, schoolId } });
    if (!label) throw new NotFoundException('Label not found');
    if (label.category !== LabelCategory.fee) {
      throw new BadRequestException(
        `Label '${label.name}' is an ${label.category} label. A fee type can only use a fee label.`,
      );
    }
  }

  async create(dto: CreateFeeTypeDto, userId: string, schoolId: string, requestId?: string) {
    if (dto.labelId) await this.assertFeeLabel(dto.labelId, schoolId);

    try {
      const feeType = await this.prisma.feeType.create({
        data: {
          schoolId,
          name: dto.name.trim().replace(/\s+/g, ' '),
          description: dto.description ?? null,
          labelId: dto.labelId ?? null,
          createdBy: userId,
          updatedBy: userId,
        },
        include: { label: true },
      });

      await this.auditLogs.create({
        schoolId, userId, requestId,
        action: 'fee_types.created',
        module: 'fee_types',
        entityType: 'fee_type',
        entityId: feeType.id,
        changes: { after: dto },
      });

      return feeType;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `A fee type named '${dto.name}' already exists in this school`,
        );
      }
      throw err;
    }
  }

  async findAll(schoolId: string, query: QueryFeeTypesDto) {
    return this.prisma.feeType.findMany({
      where: { schoolId, ...(query.includeArchived ? {} : { isActive: true }) },
      include: { label: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, schoolId: string) {
    const feeType = await this.prisma.feeType.findFirst({
      where: { id, schoolId },
      include: { label: true },
    });
    if (!feeType) throw new NotFoundException('Fee type not found');
    return feeType;
  }

  async update(id: string, dto: UpdateFeeTypeDto, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (dto.labelId) await this.assertFeeLabel(dto.labelId, schoolId);

    try {
      const updated = await this.prisma.feeType.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim().replace(/\s+/g, ' ') }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.labelId !== undefined && { labelId: dto.labelId }),
          updatedBy: userId,
        },
        include: { label: true },
      });

      await this.auditLogs.create({
        schoolId, userId, requestId,
        action: 'fee_types.updated',
        module: 'fee_types',
        entityType: 'fee_type',
        entityId: id,
        changes: {
          before: { name: existing.name, description: existing.description, labelId: existing.labelId },
          after: dto,
        },
      });

      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `A fee type named '${dto.name}' already exists in this school`,
        );
      }
      throw err;
    }
  }

  /**
   * Archiving is allowed even when fees already exist under this type. Those
   * fees and their assignments keep resolving; the type simply drops out of
   * pickers. Blocking it would be the archive-dependency guard applied where
   * it is not warranted — a school reorganising its fee structure mid-year is
   * normal, and the money already billed under the old type is still real.
   */
  async archive(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (!existing.isActive) throw new ConflictException('Fee type is already archived');

    const archived = await this.prisma.feeType.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
      include: { label: true },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'fee_types.archived',
      module: 'fee_types',
      entityType: 'fee_type',
      entityId: id,
      changes: { before: { isActive: true }, after: { isActive: false } },
    });

    return archived;
  }

  async restore(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (existing.isActive) throw new ConflictException('Fee type is not archived');

    const restored = await this.prisma.feeType.update({
      where: { id },
      data: { isActive: true, updatedBy: userId },
      include: { label: true },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'fee_types.restored',
      module: 'fee_types',
      entityType: 'fee_type',
      entityId: id,
      changes: { before: { isActive: false }, after: { isActive: true } },
    });

    return restored;
  }
}
