import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { parseAmount } from './school-fees.service';
import { collectedFrom, ledgerTotals, paymentState, serialiseTotals, toMoneyString } from './fees.money';

@Injectable()
export class FeeAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * THE FREEZE GUARD.
   *
   * An invoice stores no money — every figure on it is read live through its
   * lines. That is only safe if the amounts underneath cannot move after the
   * document is issued; otherwise an invoice printed at GH¢400 reprints at
   * GH¢450 under the same number, with no record it ever said anything else,
   * which is precisely the "a number that means something different every time
   * it is printed" problem that argued against invoice numbering in the first
   * place.
   *
   * So the invoice is not a copy of the money protected from drift — the
   * invoice is what MAKES the money immutable. Correcting a billed amount
   * after issue means correcting the invoice, which is a real, audited,
   * numbered act rather than a silent edit.
   */
  private async assertNotInvoiced(feeAssignmentId: string) {
    const liveLine = await this.prisma.invoiceLine.findFirst({
      where: { feeAssignmentId, voidedAt: null },
      include: { invoice: true },
    });
    if (liveLine) {
      throw new ConflictException(
        `This fee is on invoice ${liveLine.invoice.invoiceNumber}, so its amount is locked. ` +
          `Correct or cancel that invoice first.`,
      );
    }
  }

  async findOne(id: string, schoolId: string) {
    const assignment = await this.prisma.feeAssignment.findFirst({
      where: { id, schoolId },
      include: {
        payments: { orderBy: { createdAt: 'asc' } },
        schoolFee: { include: { feeType: true, term: true, level: true } },
        enrollment: { include: { student: true, classroom: true } },
        invoiceLines: { where: { voidedAt: null }, include: { invoice: true } },
      },
    });
    if (!assignment) throw new NotFoundException('Fee assignment not found');

    const totals = ledgerTotals(assignment.amountDue, collectedFrom(assignment.payments));
    const liveInvoice = assignment.invoiceLines[0]?.invoice ?? null;

    return {
      ...assignment,
      ...serialiseTotals(totals),
      paymentState: paymentState(totals),
      amountLocked: !!liveInvoice,
      lockedByInvoice: liveInvoice
        ? { id: liveInvoice.id, invoiceNumber: liveInvoice.invoiceNumber }
        : null,
    };
  }

  /**
   * Change what THIS child was billed. The one legitimate way to alter a
   * frozen amount — and it is refused while an invoice covers it.
   */
  async update(id: string, dto: UpdateAssignmentDto, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.prisma.feeAssignment.findFirst({
      where: { id, schoolId },
      include: { payments: { select: { amount: true } } },
    });
    if (!existing) throw new NotFoundException('Fee assignment not found');

    await this.assertNotInvoiced(id);

    const amountDue = parseAmount(dto.amountDue, 'amountDue');
    const collected = collectedFrom(existing.payments);

    // Reducing a bill below what has already been paid would manufacture a
    // credit, and credits are deliberately not a concept here.
    if (amountDue.lessThan(collected)) {
      throw new ConflictException(
        `GHS ${toMoneyString(collected)} has already been paid against this fee, so it ` +
          `cannot be reduced to GHS ${toMoneyString(amountDue)}. Reverse a payment first.`,
      );
    }

    const updated = await this.prisma.feeAssignment.update({
      where: { id },
      data: { amountDue, updatedBy: userId },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'fee_assignments.updated',
      module: 'fee_assignments',
      entityType: 'fee_assignment',
      entityId: id,
      changes: {
        before: { amountDue: toMoneyString(existing.amountDue) },
        after: { amountDue: toMoneyString(amountDue) },
      },
    });

    return updated;
  }
}
