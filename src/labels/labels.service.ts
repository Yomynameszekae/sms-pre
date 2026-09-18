import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LabelCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { QueryLabelsDto } from './dto/query-labels.dto';

const CATEGORY_WORD: Record<LabelCategory, string> = {
  fee: 'fee',
  income: 'income',
  expenditure: 'expenditure',
};

/**
 * Trims and collapses internal whitespace runs to a single space.
 *
 * This is validation, not a constraint, and it removes the commonest kind of
 * duplicate ("Tuition " vs "Tuition"). The actual rule is the raw-SQL
 * expression index uq_label_school_category_name_lower.
 */
export function normaliseLabelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

@Injectable()
export class LabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * The uniqueness rule lives in Postgres, not here — a pre-flight SELECT
   * would race. uq_label_school_category_name_lower is
   * (school_id, category, lower(name)), so the same word IS allowed in two
   * different categories: "Transport" can be both an income and an
   * expenditure heading. That per-category scoping is the whole point.
   */
  private conflict(category: LabelCategory, name: string): ConflictException {
    return new ConflictException(
      `A ${CATEGORY_WORD[category]} label named '${name}' already exists in this school`,
    );
  }

  async create(
    dto: CreateLabelDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const name = normaliseLabelName(dto.name);

    try {
      const label = await this.prisma.label.create({
        data: {
          schoolId,
          category: dto.category,
          name,
          description: dto.description ?? null,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'labels.created',
        module: 'labels',
        entityType: 'label',
        entityId: label.id,
        changes: { after: { ...dto, name } },
      });

      return label;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw this.conflict(dto.category, name);
      }
      throw err;
    }
  }

  async findAll(schoolId: string, query: QueryLabelsDto) {
    return this.prisma.label.findMany({
      where: {
        schoolId,
        ...(query.category ? { category: query.category } : {}),
        ...(query.includeArchived ? {} : { isActive: true }),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string, schoolId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id, schoolId },
    });

    if (!label) {
      throw new NotFoundException('Label not found');
    }

    return label;
  }

  /** `category` is intentionally absent from UpdateLabelDto — see that file. */
  async update(
    id: string,
    dto: UpdateLabelDto,
    userId: string,
    schoolId: string,
    requestId?: string,
  ) {
    const existing = await this.findOne(id, schoolId);
    const name = dto.name === undefined ? undefined : normaliseLabelName(dto.name);

    try {
      const updated = await this.prisma.label.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(dto.description !== undefined && { description: dto.description }),
          updatedBy: userId,
        },
      });

      await this.auditLogs.create({
        schoolId,
        userId,
        requestId,
        action: 'labels.updated',
        module: 'labels',
        entityType: 'label',
        entityId: id,
        changes: {
          before: { name: existing.name, description: existing.description },
          after: { ...dto, ...(name !== undefined && { name }) },
        },
      });

      return updated;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw this.conflict(existing.category, name ?? existing.name);
      }
      throw err;
    }
  }

  /**
   * Archiving a label that a consumer already points at is ALLOWED. Archived
   * labels drop out of pickers; rows that already reference them still
   * resolve. A school reorganising its headings mid-year is normal, and
   * blocking it would be the archive-dependency guard applied where it is not
   * warranted.
   */
  async archive(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (!existing.isActive) {
      throw new ConflictException('Label is already archived');
    }

    const archived = await this.prisma.label.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'labels.archived',
      module: 'labels',
      entityType: 'label',
      entityId: id,
      changes: { before: { isActive: true }, after: { isActive: false } },
    });

    return archived;
  }

  /** Inverse of archive: isActive back to true. Fixed restore state. */
  async restore(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (existing.isActive) {
      throw new ConflictException('Label is not archived');
    }

    const restored = await this.prisma.label.update({
      where: { id },
      data: { isActive: true, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId,
      userId,
      requestId,
      action: 'labels.restored',
      module: 'labels',
      entityType: 'label',
      entityId: id,
      changes: { before: { isActive: false }, after: { isActive: true } },
    });

    return restored;
  }
}
