import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FeePaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  nextDocumentNumber,
  isUniqueViolationOn,
} from '../common/utils/document-number.util';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { parseAmount } from './school-fees.service';
import { collectedFrom, money, toMoneyString, ZERO } from './fees.money';
import { NotificationsTriggers } from '../notifications/notifications.triggers';

const MAX_RECEIPT_ATTEMPTS = 3;

@Injectable()
export class FeePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsTriggers,
  ) {}

  /**
   * Record a payment against one assignment.
   *
   * Three things happen in one transaction, and they must not be separable:
   * the assignment row is LOCKED, the remaining balance is computed under that
   * lock, and the receipt number is claimed. Without the lock two concurrent
   * payments both see the same remaining balance and both succeed, and the
   * child ends up overpaid with two valid receipts. This is the one place in
   * the fees module that needs an explicit lock — the sequence claim gets its
   * own for free from the UPDATE.
   */
  async create(dto: CreatePaymentDto, userId: string, schoolId: string, requestId?: string) {
    const amount = parseAmount(dto.amount);

    // Method/network agreement is also a CHECK constraint, so a direct SQL
    // insert cannot bypass it. Checked here too, to return a field-level
    // message instead of a raw constraint violation.
    if (dto.method === FeePaymentMethod.mobile_money && !dto.providerCode) {
      throw new ConflictException(
        'A mobile money payment must name the network (MTN, TELECEL or AIRTELTIGO)',
      );
    }
    if (dto.method !== FeePaymentMethod.mobile_money && dto.providerCode) {
      throw new ConflictException(
        `providerCode applies only to mobile money payments, not to ${dto.method}`,
      );
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const payment = await this.prisma.$transaction(async (tx) => {
          // Row lock FIRST. Everything after this is serialised per assignment.
          const locked = await tx.$queryRaw<{ id: string; amount_due: Prisma.Decimal }[]>`
            SELECT id, amount_due FROM fee_assignments
            WHERE id = ${dto.feeAssignmentId}::uuid AND school_id = ${schoolId}::uuid
            FOR UPDATE
          `;
          if (!locked.length) throw new NotFoundException('Fee assignment not found');

          const amountDue = money(locked[0].amount_due);
          const existing = await tx.feePayment.findMany({
            where: { feeAssignmentId: dto.feeAssignmentId },
            select: { amount: true },
          });
          const collected = collectedFrom(existing);
          const remaining = amountDue.sub(collected);

          // Overpayment is REFUSED, not accepted as credit. Accepting it would
          // mean defining what a credit is, where it lives and how it applies
          // to next term's bill — a whole feature. The bursar splits a
          // round-number payment across assignments instead.
          if (amount.greaterThan(remaining)) {
            throw new ConflictException(
              `Payment of GHS ${toMoneyString(amount)} exceeds the outstanding balance. ` +
                `The maximum that can be recorded against this fee is GHS ${toMoneyString(remaining)}.`,
            );
          }

          const receiptNumber = await nextDocumentNumber(tx, schoolId, 'receipt_number');

          return tx.feePayment.create({
            data: {
              schoolId,
              feeAssignmentId: dto.feeAssignmentId,
              receiptNumber,
              amount,
              method: dto.method,
              providerCode: dto.providerCode ?? null,
              reference: dto.reference ?? null,
              paidOn: new Date(`${dto.paidOn.slice(0, 10)}T00:00:00.000Z`),
              notes: dto.notes ?? null,
              createdBy: userId,
              updatedBy: userId,
            },
          });
        });

        await this.auditLogs.create({
          schoolId, userId, requestId,
          action: 'fee_payments.created',
          module: 'fee_payments',
          entityType: 'fee_payment',
          entityId: payment.id,
          changes: {
            after: {
              feeAssignmentId: dto.feeAssignmentId,
              amount: toMoneyString(amount),
              method: dto.method,
              providerCode: dto.providerCode ?? null,
              reference: dto.reference ?? null,
              receiptNumber: payment.receiptNumber,
            },
          },
        });

        // AFTER the transaction has committed, never inside it. A gateway
        // problem must never roll back a recorded payment, and a receipt for a
        // payment that was rolled back is worse than no receipt at all.
        // `feeReceipt` swallows its own errors for the same reason.
        await this.notifications.feeReceipt({
          schoolId,
          feePaymentId: payment.id,
          actorUserId: userId,
          requestId,
        });

        return payment;
      } catch (err) {
        // A manually set receipt number can occupy a value the sequence has
        // not reached yet. Same bounded retry Phase 1B established for
        // admission numbers: re-claim and try again, never reuse.
        if (
          attempt < MAX_RECEIPT_ATTEMPTS &&
          isUniqueViolationOn(err, /receipt_number/)
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Corrections are REVERSING ENTRIES, never edits and never deletes.
   *
   * A reversal is a new row with `reversesPaymentId` set and a NEGATIVE
   * amount, which is why every balance in this module is a plain signed SUM
   * with no exclusion subquery. It consumes no receipt number — the original
   * receipt still exists and still says what it said.
   */
  async reverse(id: string, dto: ReversePaymentDto, userId: string, schoolId: string, requestId?: string) {
    const original = await this.prisma.feePayment.findFirst({ where: { id, schoolId } });
    if (!original) throw new NotFoundException('Payment not found');

    if (original.reversesPaymentId) {
      throw new ConflictException(
        'This row is itself a reversal and cannot be reversed. Record a new payment instead.',
      );
    }

    const alreadyReversed = await this.prisma.feePayment.findFirst({
      where: { reversesPaymentId: id },
    });
    if (alreadyReversed) {
      throw new ConflictException(
        `Payment ${original.receiptNumber ?? id} has already been reversed.`,
      );
    }

    const reversal = await this.prisma.feePayment.create({
      data: {
        schoolId,
        feeAssignmentId: original.feeAssignmentId,
        // Deliberately null: a reversal does not consume a receipt number.
        receiptNumber: null,
        amount: original.amount.negated(),
        method: original.method,
        providerCode: original.providerCode,
        reference: original.reference,
        paidOn: original.paidOn,
        reversesPaymentId: original.id,
        reversalReason: dto.reason,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'fee_payments.reversed',
      module: 'fee_payments',
      entityType: 'fee_payment',
      entityId: original.id,
      changes: {
        before: { amount: toMoneyString(original.amount), receiptNumber: original.receiptNumber },
        after: { reversalId: reversal.id, amount: toMoneyString(reversal.amount) },
      },
      metadata: { reason: dto.reason, receiptNumber: original.receiptNumber },
    });

    return reversal;
  }

  async findAll(schoolId: string, query: QueryPaymentsDto) {
    const where: Prisma.FeePaymentWhereInput = {
      schoolId,
      ...(query.feeAssignmentId ? { feeAssignmentId: query.feeAssignmentId } : {}),
      ...(query.studentId
        ? { feeAssignment: { enrollment: { studentId: query.studentId } } }
        : {}),
    };
    if (query.from || query.to) {
      where.paidOn = {
        ...(query.from ? { gte: new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to.slice(0, 10)}T00:00:00.000Z`) } : {}),
      };
    }

    const payments = await this.prisma.feePayment.findMany({
      where,
      include: {
        feeAssignment: {
          include: {
            schoolFee: { include: { feeType: true, term: true } },
            enrollment: { include: { student: true } },
          },
        },
      },
      orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      items: payments,
      // Signed, so a list containing a payment and its reversal totals zero —
      // which is the point of modelling reversals this way.
      totalCollected: toMoneyString(collectedFrom(payments)),
    };
  }

  /** One assignment's payment history plus its live balance. */
  async findForAssignment(feeAssignmentId: string, schoolId: string) {
    const assignment = await this.prisma.feeAssignment.findFirst({
      where: { id: feeAssignmentId, schoolId },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!assignment) throw new NotFoundException('Fee assignment not found');

    const collected = collectedFrom(assignment.payments);
    return {
      feeAssignmentId,
      amountDue: toMoneyString(assignment.amountDue),
      collected: toMoneyString(collected),
      outstanding: toMoneyString(assignment.amountDue.sub(collected)),
      maximumPayable: toMoneyString(
        assignment.amountDue.sub(collected).lessThan(ZERO)
          ? ZERO
          : assignment.amountDue.sub(collected),
      ),
      payments: assignment.payments,
    };
  }
}
