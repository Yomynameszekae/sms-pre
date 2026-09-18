import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateSchoolFeeDto } from './dto/create-school-fee.dto';
import { UpdateSchoolFeeDto } from './dto/update-school-fee.dto';
import { QuerySchoolFeesDto } from './dto/query-school-fees.dto';
import { money } from './fees.money';

/** Parses a money string into a Decimal, rejecting anything not billable. */
export function parseAmount(raw: string, field = 'amount'): Prisma.Decimal {
  let value: Prisma.Decimal;
  try {
    value = money(raw);
  } catch {
    throw new BadRequestException(`${field} is not a valid amount`);
  }
  if (!value.isFinite()) throw new BadRequestException(`${field} is not a valid amount`);
  if (value.lte(0)) throw new BadRequestException(`${field} must be greater than zero`);
  if (value.decimalPlaces() > 2) {
    throw new BadRequestException(`${field} cannot have more than 2 decimal places`);
  }
  if (value.greaterThan(new Prisma.Decimal('9999999999.99'))) {
    throw new BadRequestException(`${field} exceeds the maximum supported value`);
  }
  return value;
}

@Injectable()
export class SchoolFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Every active enrollment that should hold an assignment for this fee.
   *
   * This is the `Level → Classroom → Enrollment` walk. The benchmarked product
   * could read enrolments directly off the fee's level because its level WAS
   * the enrolment unit; Brite's fee target and enrolment target are two
   * different entities, so the walk is the whole difference.
   */
  private async targetEnrollmentIds(
    tx: Prisma.TransactionClient,
    schoolId: string,
    levelId: string,
    academicYearId: string,
  ): Promise<string[]> {
    const enrollments = await tx.enrollment.findMany({
      where: {
        schoolId,
        status: EnrollmentStatus.active,
        academicYearId,
        classroom: { levelId, academicYearId },
      },
      select: { id: true },
    });
    return enrollments.map((e) => e.id);
  }

  async create(dto: CreateSchoolFeeDto, userId: string, schoolId: string, requestId?: string) {
    const amount = parseAmount(dto.amount);

    const [feeType, level, term] = await Promise.all([
      this.prisma.feeType.findFirst({ where: { id: dto.feeTypeId, schoolId } }),
      this.prisma.level.findFirst({ where: { id: dto.levelId, schoolId } }),
      this.prisma.term.findFirst({ where: { id: dto.termId, schoolId } }),
    ]);
    if (!feeType) throw new NotFoundException('Fee type not found');
    if (!level) throw new NotFoundException('Level not found');
    if (!term) throw new NotFoundException('Term not found');
    if (term.academicYearId !== dto.academicYearId) {
      throw new ConflictException(
        `Term '${term.label}' does not belong to the selected academic year`,
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const fee = await tx.schoolFee.create({
          data: {
            schoolId,
            feeTypeId: dto.feeTypeId,
            levelId: dto.levelId,
            academicYearId: dto.academicYearId,
            termId: dto.termId,
            name: dto.name.trim().replace(/\s+/g, ' '),
            amount,
            createdBy: userId,
            updatedBy: userId,
          },
        });

        // Assignment happens in the SAME transaction as the fee. A fee that
        // exists but assigned nobody, because the second statement failed, is
        // a silent revenue hole.
        const enrollmentIds = await this.targetEnrollmentIds(
          tx, schoolId, dto.levelId, dto.academicYearId,
        );

        if (enrollmentIds.length) {
          await tx.feeAssignment.createMany({
            data: enrollmentIds.map((enrollmentId) => ({
              schoolId,
              schoolFeeId: fee.id,
              enrollmentId,
              // COPIED, not read through — the price freeze. See the note on
              // model FeeAssignment.
              amountDue: amount,
              createdBy: userId,
              updatedBy: userId,
            })),
            skipDuplicates: true,
          });
        }

        return { fee, assignedCount: enrollmentIds.length };
      });

      await this.auditLogs.create({
        schoolId, userId, requestId,
        action: 'school_fees.created',
        module: 'school_fees',
        entityType: 'school_fee',
        entityId: result.fee.id,
        changes: { after: { ...dto, amount: amount.toFixed(2) } },
        metadata: { assignedCount: result.assignedCount },
      });

      return { ...result.fee, assignedCount: result.assignedCount };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `A '${feeType.name}' fee already exists for ${level.name} in ${term.label}. ` +
            `Edit that fee instead of creating a second one.`,
        );
      }
      throw err;
    }
  }

  async findAll(schoolId: string, query: QuerySchoolFeesDto) {
    return this.prisma.schoolFee.findMany({
      where: {
        schoolId,
        ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
        ...(query.termId ? { termId: query.termId } : {}),
        ...(query.levelId ? { levelId: query.levelId } : {}),
        ...(query.includeArchived ? {} : { isActive: true }),
      },
      include: {
        feeType: { include: { label: true } },
        level: true,
        term: true,
        academicYear: true,
        _count: { select: { assignments: true } },
      },
      orderBy: [{ level: { orderIndex: 'asc' } }, { name: 'asc' }],
    });
  }

  async findOne(id: string, schoolId: string) {
    const fee = await this.prisma.schoolFee.findFirst({
      where: { id, schoolId },
      include: {
        feeType: { include: { label: true } },
        level: true,
        term: true,
        academicYear: true,
        _count: { select: { assignments: true } },
      },
    });
    if (!fee) throw new NotFoundException('School fee not found');
    return fee;
  }

  /**
   * Editing `amount` affects only FUTURE assignments. Existing assignments
   * keep the amount frozen at the time they were created, so bills already
   * handed to parents do not silently change and receipts already issued still
   * reconcile. Changing one child's bill is an explicit action on that child's
   * assignment (and is refused while it sits on a live invoice).
   */
  async update(id: string, dto: UpdateSchoolFeeDto, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    const amount = dto.amount === undefined ? undefined : parseAmount(dto.amount);

    const updated = await this.prisma.schoolFee.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim().replace(/\s+/g, ' ') }),
        ...(amount !== undefined && { amount }),
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'school_fees.updated',
      module: 'school_fees',
      entityType: 'school_fee',
      entityId: id,
      changes: {
        before: { name: existing.name, amount: existing.amount.toFixed(2) },
        after: { ...dto },
      },
      metadata: {
        existingAssignmentsUnchanged: existing._count.assignments,
        note: 'Amount applies to future assignments only; existing assignments keep their frozen amount.',
      },
    });

    return updated;
  }

  async archive(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (!existing.isActive) throw new ConflictException('School fee is already archived');

    const archived = await this.prisma.schoolFee.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'school_fees.archived',
      module: 'school_fees',
      entityType: 'school_fee',
      entityId: id,
      changes: { before: { isActive: true }, after: { isActive: false } },
    });

    return archived;
  }

  async restore(id: string, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.findOne(id, schoolId);
    if (existing.isActive) throw new ConflictException('School fee is not archived');

    const restored = await this.prisma.schoolFee.update({
      where: { id },
      data: { isActive: true, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'school_fees.restored',
      module: 'school_fees',
      entityType: 'school_fee',
      entityId: id,
      changes: { before: { isActive: false }, after: { isActive: true } },
    });

    return restored;
  }

  /**
   * Close the late-enrollment hole.
   *
   * A student who enrols after a fee was created has no assignment for it.
   * Brite has no event bus, and hooking `EnrollmentsService` would make a
   * Phase 1 module call into a Phase 2 one, so this is an explicit action the
   * bursar runs — made safe by the `unassignedStudentCount` the billing
   * summary puts next to it. A reconcile nobody remembers to run is a silent
   * revenue hole; a reconcile beside a number saying "4 students have no fees
   * assigned" is not.
   *
   * IDEMPOTENT by construction: `@@unique([schoolFeeId, enrollmentId])` plus
   * `skipDuplicates`. Running it twice creates nothing the second time, and it
   * uses the fee's CURRENT amount for the new assignments — which is correct,
   * because a child joining in week six is billed today's price.
   */
  async reconcile(id: string, userId: string, schoolId: string, requestId?: string) {
    const fee = await this.findOne(id, schoolId);

    const created = await this.prisma.$transaction(async (tx) => {
      const enrollmentIds = await this.targetEnrollmentIds(
        tx, schoolId, fee.levelId, fee.academicYearId,
      );
      if (!enrollmentIds.length) return 0;

      const result = await tx.feeAssignment.createMany({
        data: enrollmentIds.map((enrollmentId) => ({
          schoolId,
          schoolFeeId: fee.id,
          enrollmentId,
          amountDue: fee.amount,
          createdBy: userId,
          updatedBy: userId,
        })),
        skipDuplicates: true,
      });
      return result.count;
    });

    // Only audit when something actually happened — a reconcile that finds
    // nothing to do is the normal case and must not flood the trail.
    if (created > 0) {
      await this.auditLogs.create({
        schoolId, userId, requestId,
        action: 'fee_assignments.reconciled',
        module: 'fee_assignments',
        entityType: 'school_fee',
        entityId: fee.id,
        metadata: { createdCount: created, feeName: fee.name, level: fee.level.name },
      });
    }

    return { schoolFeeId: fee.id, createdCount: created };
  }
}
