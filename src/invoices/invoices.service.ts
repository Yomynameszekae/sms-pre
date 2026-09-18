import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  nextDocumentNumber,
  isUniqueViolationOn,
} from '../common/utils/document-number.util';
import {
  collectedFrom,
  ledgerTotals,
  paymentState,
  serialiseTotals,
  sum,
  toMoneyString,
  ZERO,
} from '../fees/fees.money';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { CorrectInvoiceDto } from './dto/correct-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';

const MAX_NUMBER_ATTEMPTS = 3;

/** Everything a detail read needs, loaded once. */
const DETAIL_INCLUDE = {
  enrollment: { include: { student: true, classroom: true, academicYear: true } },
  term: true,
  lines: {
    include: {
      feeAssignment: {
        include: {
          payments: { select: { amount: true } },
          schoolFee: { include: { feeType: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ── validation shared by issue and correct ────────────────────────────────

  /**
   * Every assignment must belong to this enrollment and this term, and must
   * not already sit on a live invoice.
   *
   * The uniqueness half is ALSO a partial unique index
   * (`uq_one_live_invoice_line_per_assignment`), so a race that slips past
   * this check still fails at the database. This check exists to return a
   * message naming the offending invoice instead of a raw constraint error.
   */
  private async loadAssignmentsForInvoice(
    tx: Prisma.TransactionClient,
    schoolId: string,
    enrollmentId: string,
    termId: string,
    feeAssignmentIds: string[],
  ) {
    const unique = [...new Set(feeAssignmentIds)];
    if (unique.length !== feeAssignmentIds.length) {
      throw new ConflictException('The same fee appears more than once on this invoice');
    }

    const assignments = await tx.feeAssignment.findMany({
      where: { id: { in: unique }, schoolId },
      include: { schoolFee: { include: { feeType: true } }, invoiceLines: { where: { voidedAt: null }, include: { invoice: true } } },
    });

    if (assignments.length !== unique.length) {
      throw new NotFoundException('One or more fee assignments were not found');
    }

    for (const a of assignments) {
      if (a.enrollmentId !== enrollmentId) {
        throw new ConflictException(
          `Fee '${a.schoolFee.name}' does not belong to this student's enrollment`,
        );
      }
      // One term per invoice. Spanning terms would formally re-bill arrears
      // that are, by design, only ever reported and never re-billed.
      if (a.schoolFee.termId !== termId) {
        throw new ConflictException(
          `Fee '${a.schoolFee.name}' belongs to a different term. An invoice covers one term; ` +
            `earlier unpaid terms appear as a brought-forward figure, not as lines.`,
        );
      }
      const live = a.invoiceLines[0];
      if (live) {
        throw new ConflictException(
          `Fee '${a.schoolFee.name}' is already on invoice ${live.invoice.invoiceNumber}.`,
        );
      }
    }

    return assignments;
  }

  /** Claims a number and writes the invoice + lines. Caller owns the transaction. */
  private async insertInvoice(
    tx: Prisma.TransactionClient,
    params: {
      schoolId: string;
      userId: string;
      enrollmentId: string;
      termId: string;
      assignmentIds: string[];
      dueOn?: string;
      notes?: string;
      supersedesInvoiceId?: string;
    },
  ) {
    const invoiceNumber = await nextDocumentNumber(tx, params.schoolId, 'invoice_number');

    const invoice = await tx.invoice.create({
      data: {
        schoolId: params.schoolId,
        invoiceNumber,
        enrollmentId: params.enrollmentId,
        termId: params.termId,
        status: InvoiceStatus.issued,
        issuedOn: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'),
        dueOn: params.dueOn
          ? new Date(`${params.dueOn.slice(0, 10)}T00:00:00.000Z`)
          : null,
        notes: params.notes ?? null,
        supersedesInvoiceId: params.supersedesInvoiceId ?? null,
        createdBy: params.userId,
        updatedBy: params.userId,
      },
    });

    await tx.invoiceLine.createMany({
      data: params.assignmentIds.map((feeAssignmentId) => ({
        schoolId: params.schoolId,
        invoiceId: invoice.id,
        feeAssignmentId,
        createdBy: params.userId,
      })),
    });

    return invoice;
  }

  /** Voids an invoice's lines, releasing its assignments and lifting the freeze. */
  private async voidLines(tx: Prisma.TransactionClient, invoiceId: string) {
    await tx.invoiceLine.updateMany({
      where: { invoiceId, voidedAt: null },
      data: { voidedAt: new Date() },
    });
  }

  // ── issue ─────────────────────────────────────────────────────────────────

  async create(dto: CreateInvoiceDto, userId: string, schoolId: string, requestId?: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: dto.enrollmentId, schoolId },
      include: { student: true },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const term = await this.prisma.term.findFirst({ where: { id: dto.termId, schoolId } });
    if (!term) throw new NotFoundException('Term not found');
    if (term.academicYearId !== enrollment.academicYearId) {
      throw new ConflictException(
        `Term '${term.label}' does not belong to this student's academic year`,
      );
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const invoice = await this.prisma.$transaction(async (tx) => {
          await this.loadAssignmentsForInvoice(
            tx, schoolId, dto.enrollmentId, dto.termId, dto.feeAssignmentIds,
          );
          return this.insertInvoice(tx, {
            schoolId,
            userId,
            enrollmentId: dto.enrollmentId,
            termId: dto.termId,
            assignmentIds: [...new Set(dto.feeAssignmentIds)],
            dueOn: dto.dueOn,
            notes: dto.notes,
          });
        });

        await this.auditLogs.create({
          schoolId, userId, requestId,
          action: 'invoices.issued',
          module: 'invoices',
          entityType: 'invoice',
          entityId: invoice.id,
          metadata: {
            invoiceNumber: invoice.invoiceNumber,
            lineCount: dto.feeAssignmentIds.length,
            termId: dto.termId,
            student: `${enrollment.student.firstName} ${enrollment.student.lastName}`,
          },
        });

        return this.findOne(invoice.id, schoolId);
      } catch (err) {
        if (attempt < MAX_NUMBER_ATTEMPTS && isUniqueViolationOn(err, /invoice_number/)) {
          continue;
        }
        throw err;
      }
    }
  }

  // ── read, with the live figures and the full chain ────────────────────────

  private composeDetail(invoice: any, chain: { backward: any[]; forward: any[] }) {
    const lines = invoice.lines.map((line: any) => {
      const a = line.feeAssignment;
      const totals = ledgerTotals(a.amountDue, collectedFrom(a.payments));
      return {
        invoiceLineId: line.id,
        feeAssignmentId: a.id,
        feeTypeName: a.schoolFee.feeType.name,
        name: a.schoolFee.name,
        voidedAt: line.voidedAt,
        ...serialiseTotals(totals),
      };
    });

    const totals = ledgerTotals(
      sum(invoice.lines.map((l: any) => l.feeAssignment.amountDue)),
      sum(invoice.lines.map((l: any) => collectedFrom(l.feeAssignment.payments))),
    );

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      // DERIVED, every time. Never stored, so a reversal turning a paid
      // invoice back into partially_paid needs no sync to notice.
      paymentState: paymentState(totals),
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      notes: invoice.notes,
      cancelledAt: invoice.cancelledAt,
      cancellationReason: invoice.cancellationReason,
      student: {
        id: invoice.enrollment.student.id,
        studentNumber: invoice.enrollment.student.studentNumber,
        fullName: [
          invoice.enrollment.student.firstName,
          invoice.enrollment.student.middleName,
          invoice.enrollment.student.lastName,
        ].filter(Boolean).join(' '),
      },
      classroom: invoice.enrollment.classroom.displayName,
      academicYear: invoice.enrollment.academicYear.label,
      term: { id: invoice.term.id, label: invoice.term.label },
      lines,
      ...serialiseTotals(totals),
      // Both directions, so opening ANY invoice in a chain shows the whole
      // history rather than only its own state.
      supersedesInvoiceId: invoice.supersedesInvoiceId,
      supersededByInvoiceId: chain.forward[0]?.id ?? null,
      chain: {
        supersedes: chain.backward,
        supersededBy: chain.forward,
      },
    };
  }

  /**
   * Walks the correction chain in both directions.
   *
   * Only ONE column exists (`supersedesInvoiceId`, on the newer invoice). The
   * forward pointer is the Prisma back-relation, so there is no second column
   * that could disagree with the first. `@unique` on the FK keeps the chain
   * linear — an invoice can be superseded at most once.
   */
  private async loadChain(invoiceId: string, schoolId: string) {
    const summary = {
      select: { id: true, invoiceNumber: true, status: true, issuedOn: true, cancellationReason: true },
    };

    // Both walks are BOUNDED and track what they have already seen.
    //
    // A cycle cannot be created through this service — `correct` always issues
    // a brand-new invoice, and `@unique` on the FK keeps the chain linear — so
    // this is insurance against hand-edited data, not against a known path.
    // It is worth having anyway: an unbounded walk over a self-referencing
    // table turns one bad row into a hung request and, in a list endpoint,
    // into an out-of-memory crash.
    const MAX_CHAIN = 50;
    const seen = new Set<string>([invoiceId]);

    const backward: any[] = [];
    let cursor = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, schoolId },
      select: { supersedesInvoiceId: true },
    });
    while (cursor?.supersedesInvoiceId && backward.length < MAX_CHAIN) {
      if (seen.has(cursor.supersedesInvoiceId)) break;
      const prev = await this.prisma.invoice.findFirst({
        where: { id: cursor.supersedesInvoiceId, schoolId },
        select: { ...summary.select, supersedesInvoiceId: true },
      });
      if (!prev) break;
      seen.add(prev.id);
      backward.push(prev);
      cursor = { supersedesInvoiceId: prev.supersedesInvoiceId };
    }

    const forward: any[] = [];
    let nextOf: string | null = invoiceId;
    while (nextOf && forward.length < MAX_CHAIN) {
      const next: any = await this.prisma.invoice.findFirst({
        where: { supersedesInvoiceId: nextOf, schoolId },
        select: summary.select,
      });
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      forward.push(next);
      nextOf = next.id;
    }

    return { backward, forward };
  }

  async findOne(id: string, schoolId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, schoolId },
      include: DETAIL_INCLUDE,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const chain = await this.loadChain(id, schoolId);
    return this.composeDetail(invoice, chain);
  }

  async findAll(query: QueryInvoicesDto, schoolId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        ...(query.enrollmentId ? { enrollmentId: query.enrollmentId } : {}),
        ...(query.termId ? { termId: query.termId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.studentId ? { enrollment: { studentId: query.studentId } } : {}),
      },
      include: DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    const items = invoices.map((invoice) => {
      const totals = ledgerTotals(
        sum(invoice.lines.map((l) => l.feeAssignment.amountDue)),
        sum(invoice.lines.map((l) => collectedFrom(l.feeAssignment.payments))),
      );
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        paymentState: paymentState(totals),
        issuedOn: invoice.issuedOn,
        dueOn: invoice.dueOn,
        student: {
          id: invoice.enrollment.student.id,
          studentNumber: invoice.enrollment.student.studentNumber,
          fullName: [
            invoice.enrollment.student.firstName,
            invoice.enrollment.student.lastName,
          ].filter(Boolean).join(' '),
        },
        term: { id: invoice.term.id, label: invoice.term.label },
        lineCount: invoice.lines.length,
        supersedesInvoiceId: invoice.supersedesInvoiceId,
        ...serialiseTotals(totals),
      };
    });

    // Payment state is derived, so it cannot be a SQL WHERE clause.
    const filtered = query.paymentState
      ? items.filter((i) => i.paymentState === query.paymentState)
      : items;

    return { items: filtered, total: filtered.length };
  }

  // ── cancel ────────────────────────────────────────────────────────────────

  /**
   * Cancelling does NOT touch money.
   *
   * Payments recorded against the covered assignments stay exactly as they
   * are: same rows, same receipt numbers, same amounts. The invoice is a
   * demand for payment; withdrawing the demand does not unmake the payment.
   * Money is only ever corrected by a reversing entry on FeePayment, and a
   * cancel that silently reversed payments would be a second, hidden
   * money-correction path in the same module.
   *
   * Because the payment state is DERIVED, re-invoicing the released
   * assignments produces an invoice that already reads `partially_paid` — the
   * payments never went anywhere and the derivation finds them.
   */
  async cancel(id: string, dto: CancelInvoiceDto, userId: string, schoolId: string, requestId?: string) {
    const existing = await this.loadIssuedOrExplain(id, schoolId, 'cancelled');

    const retained = await this.retainedPayments(id);

    await this.prisma.$transaction(async (tx) => {
      await this.voidLines(tx, id);
      await tx.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.cancelled,
          cancelledAt: new Date(),
          cancelledBy: userId,
          cancellationReason: dto.reason,
          updatedBy: userId,
        },
      });
    });

    await this.auditLogs.create({
      schoolId, userId, requestId,
      action: 'invoices.cancelled',
      module: 'invoices',
      entityType: 'invoice',
      entityId: id,
      changes: {
        before: { status: InvoiceStatus.issued },
        after: { status: InvoiceStatus.cancelled },
      },
      metadata: {
        reason: dto.reason,
        invoiceNumber: existing.invoiceNumber,
        paymentsRetained: retained.count,
        paymentsRetainedTotal: retained.total,
      },
    });

    return {
      ...(await this.findOne(id, schoolId)),
      // Surfaced so the UI can state what was NOT done.
      paymentsRetained: retained.count,
      paymentsRetainedTotal: retained.total,
    };
  }

  // ── correct ───────────────────────────────────────────────────────────────

  /**
   * Cancel-and-reissue as ONE atomic act.
   *
   * A correction is not two independent operations that a crash could leave
   * half-done — an invoice cancelled with no replacement, or worse, two live
   * invoices over the same assignments. Everything below happens in a single
   * transaction, and the partial unique index is the backstop if it somehow
   * did not.
   */
  async correct(id: string, dto: CorrectInvoiceDto, userId: string, schoolId: string, requestId?: string) {
    const original = await this.loadIssuedOrExplain(id, schoolId, 'corrected');

    const retained = await this.retainedPayments(id);
    const assignmentIds = dto.feeAssignmentIds
      ? [...new Set(dto.feeAssignmentIds)]
      : original.lines.map((l) => l.feeAssignmentId);

    for (let attempt = 1; ; attempt++) {
      try {
        const replacement = await this.prisma.$transaction(async (tx) => {
          // 1. Void the original's lines — releases the assignments and lifts
          //    the amount freeze so a corrected amount can be applied.
          await this.voidLines(tx, id);

          // 2. Cancel the original.
          await tx.invoice.update({
            where: { id },
            data: {
              status: InvoiceStatus.cancelled,
              cancelledAt: new Date(),
              cancelledBy: userId,
              cancellationReason: dto.reason,
              updatedBy: userId,
            },
          });

          // 3. Validate and issue the replacement over the (possibly
          //    corrected) set. The lines just voided no longer block it.
          await this.loadAssignmentsForInvoice(
            tx, schoolId, original.enrollmentId, original.termId, assignmentIds,
          );

          return this.insertInvoice(tx, {
            schoolId,
            userId,
            enrollmentId: original.enrollmentId,
            termId: original.termId,
            assignmentIds,
            dueOn: dto.dueOn,
            notes: dto.notes ?? original.notes ?? undefined,
            // 4. The single supersession pointer. The reverse direction is the
            //    Prisma back-relation, so there is no second column to sync.
            supersedesInvoiceId: id,
          });
        });

        // 5. Two audit entries, one per document, so each invoice's own trail
        //    explains its own state.
        await this.auditLogs.create({
          schoolId, userId, requestId,
          action: 'invoices.cancelled',
          module: 'invoices',
          entityType: 'invoice',
          entityId: id,
          changes: {
            before: { status: InvoiceStatus.issued },
            after: { status: InvoiceStatus.cancelled },
          },
          metadata: {
            reason: dto.reason,
            invoiceNumber: original.invoiceNumber,
            paymentsRetained: retained.count,
            paymentsRetainedTotal: retained.total,
            // What distinguishes this from a plain cancel.
            supersededBy: replacement.id,
            supersededByNumber: replacement.invoiceNumber,
          },
        });

        await this.auditLogs.create({
          schoolId, userId, requestId,
          action: 'invoices.corrected',
          module: 'invoices',
          entityType: 'invoice',
          entityId: replacement.id,
          metadata: {
            reason: dto.reason,
            invoiceNumber: replacement.invoiceNumber,
            supersedes: id,
            supersedesNumber: original.invoiceNumber,
            lineCount: assignmentIds.length,
            lineCountBefore: original.lines.length,
          },
        });

        return this.findOne(replacement.id, schoolId);
      } catch (err) {
        if (attempt < MAX_NUMBER_ATTEMPTS && isUniqueViolationOn(err, /invoice_number/)) {
          continue;
        }
        throw err;
      }
    }
  }

  // ── shared guards ─────────────────────────────────────────────────────────

  /**
   * Both cancel and correct require an `issued` invoice. When it is not, the
   * error has to say WHICH of the two reasons applies — "already cancelled"
   * and "already superseded" send the user to different places, and the second
   * must point at the invoice that actually replaced this one.
   */
  private async loadIssuedOrExplain(id: string, schoolId: string, verb: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, schoolId },
      include: { lines: { where: { voidedAt: null } }, supersededBy: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.supersededBy) {
      throw new ConflictException(
        `Invoice ${invoice.invoiceNumber} has already been corrected and replaced by ` +
          `${invoice.supersededBy.invoiceNumber}. Work on that invoice instead.`,
      );
    }
    if (invoice.status !== InvoiceStatus.issued) {
      throw new ConflictException(
        `Invoice ${invoice.invoiceNumber} is ${invoice.status} and cannot be ${verb}.`,
      );
    }
    return invoice;
  }

  /** What a cancel leaves untouched — surfaced before the act, not after. */
  private async retainedPayments(invoiceId: string) {
    const lines = await this.prisma.invoiceLine.findMany({
      where: { invoiceId },
      include: { feeAssignment: { include: { payments: { select: { amount: true } } } } },
    });
    const payments = lines.flatMap((l) => l.feeAssignment.payments);
    const total = collectedFrom(payments);
    return {
      count: payments.length,
      total: toMoneyString(total.lessThan(ZERO) ? ZERO : total),
    };
  }
}
