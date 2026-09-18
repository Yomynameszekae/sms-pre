import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryFeeSummaryDto } from './dto/query-summary.dto';
import { QueryLedgerDto } from './dto/query-ledger.dto';
import {
  collectedFrom,
  ledgerTotals,
  paymentState,
  serialiseTotals,
  sum,
  toMoneyString,
  ZERO,
} from './fees.money';

/** Assignment with everything the read models need, loaded once. */
const ASSIGNMENT_INCLUDE = {
  payments: { select: { amount: true } },
  schoolFee: { include: { feeType: true, term: true } },
} as const;

@Injectable()
export class FeesReportingService {
  constructor(private readonly prisma: PrismaService) {}

  private fullName(s: { firstName: string; middleName?: string | null; lastName: string }) {
    return [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');
  }

  /**
   * One student's itemised bill for a term, with arrears.
   *
   * ARREARS ARE COMPUTED, NEVER ROLLED OVER. There is no synthetic
   * "Arrears b/f" assignment and no rollover job: `broughtForward` is the
   * outstanding sum over everything billed to this student BEFORE this term,
   * recomputed on every read. Manufacturing a real financial record that
   * duplicates other real records would give the product two answers to "what
   * does this child owe", which is exactly the defect this module is built to
   * avoid.
   *
   * Arrears follow the STUDENT, not the enrollment: the query anchors on
   * `enrollment.studentId`, so a child who leaves and returns in a later year
   * carries the debt with them.
   */
  async bill(studentId: string, termId: string, schoolId: string) {
    const [student, term] = await Promise.all([
      this.prisma.student.findFirst({ where: { id: studentId, schoolId } }),
      this.prisma.term.findFirst({ where: { id: termId, schoolId } }),
    ]);
    if (!student) throw new NotFoundException('Student not found');
    if (!term) throw new NotFoundException('Term not found');

    const assignments = await this.prisma.feeAssignment.findMany({
      where: { schoolId, enrollment: { studentId } },
      include: {
        ...ASSIGNMENT_INCLUDE,
        enrollment: { include: { classroom: true, academicYear: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const lines: any[] = [];
    let priorBilled = ZERO;
    let priorCollected = ZERO;

    for (const a of assignments) {
      const collected = collectedFrom(a.payments);
      const totals = ledgerTotals(a.amountDue, collected);

      if (a.schoolFee.termId === termId) {
        lines.push({
          feeAssignmentId: a.id,
          feeTypeName: a.schoolFee.feeType.name,
          name: a.schoolFee.name,
          ...serialiseTotals(totals),
          paymentState: paymentState(totals),
        });
      } else if (a.schoolFee.term.startDate < term.startDate) {
        // Strictly EARLIER terms only. A fee for a later term is not arrears.
        priorBilled = priorBilled.add(a.amountDue);
        priorCollected = priorCollected.add(collected);
      }
    }

    const currentBilled = sum(
      assignments.filter((a) => a.schoolFee.termId === termId).map((a) => a.amountDue),
    );
    const currentCollected = sum(
      assignments
        .filter((a) => a.schoolFee.termId === termId)
        .map((a) => collectedFrom(a.payments)),
    );
    const current = ledgerTotals(currentBilled, currentCollected);
    const broughtForward = ledgerTotals(priorBilled, priorCollected).outstanding;

    return {
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        fullName: this.fullName(student),
      },
      term: { id: term.id, label: term.label },
      lines,
      currentTermDue: toMoneyString(current.billed),
      currentTermPaid: toMoneyString(current.collected),
      currentTermOutstanding: toMoneyString(current.outstanding),
      // Informational, not a line: including prior terms as lines would
      // formally re-bill debt already billed.
      broughtForward: toMoneyString(broughtForward.lessThan(ZERO) ? ZERO : broughtForward),
      totalDue: toMoneyString(
        current.outstanding.add(broughtForward.lessThan(ZERO) ? ZERO : broughtForward),
      ),
      paymentState: paymentState(current),
    };
  }

  /**
   * Level billing summary: one row per enrolled student.
   *
   * `unassignedStudentCount` is the safety net for the manual reconcile: a
   * reconcile action nobody remembers to run is a silent revenue hole, and
   * this number is what stops it being silent.
   */
  async levelSummary(query: QueryFeeSummaryDto, schoolId: string) {
    const [level, term] = await Promise.all([
      this.prisma.level.findFirst({ where: { id: query.levelId, schoolId } }),
      this.prisma.term.findFirst({ where: { id: query.termId, schoolId } }),
    ]);
    if (!level) throw new NotFoundException('Level not found');
    if (!term) throw new NotFoundException('Term not found');
    if (term.academicYearId !== query.academicYearId) {
      throw new ConflictException(
        `Term '${term.label}' does not belong to the selected academic year`,
      );
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        schoolId,
        status: EnrollmentStatus.active,
        academicYearId: query.academicYearId,
        classroom: { levelId: query.levelId, academicYearId: query.academicYearId },
      },
      include: { student: true, classroom: true },
    });

    const assignments = await this.prisma.feeAssignment.findMany({
      where: {
        schoolId,
        enrollmentId: { in: enrollments.map((e) => e.id) },
        schoolFee: {
          termId: query.termId,
          ...(query.feeTypeId ? { feeTypeId: query.feeTypeId } : {}),
        },
      },
      include: ASSIGNMENT_INCLUDE,
    });

    const byEnrollment = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const bucket = byEnrollment.get(a.enrollmentId) ?? [];
      bucket.push(a);
      byEnrollment.set(a.enrollmentId, bucket);
    }

    // Prior-term outstanding for everyone in one query, for brought-forward.
    const priorAssignments = await this.prisma.feeAssignment.findMany({
      where: {
        schoolId,
        enrollment: { studentId: { in: enrollments.map((e) => e.studentId) } },
        schoolFee: { term: { startDate: { lt: term.startDate } } },
      },
      include: { payments: { select: { amount: true } }, enrollment: { select: { studentId: true } } },
    });
    const priorByStudent = new Map<string, Prisma.Decimal>();
    for (const a of priorAssignments) {
      const owed = a.amountDue.sub(collectedFrom(a.payments));
      priorByStudent.set(
        a.enrollment.studentId,
        (priorByStudent.get(a.enrollment.studentId) ?? ZERO).add(owed),
      );
    }

    const students = enrollments
      .map((e) => {
        const own = byEnrollment.get(e.id) ?? [];
        const totals = ledgerTotals(
          sum(own.map((a) => a.amountDue)),
          sum(own.map((a) => collectedFrom(a.payments))),
        );
        const bf = priorByStudent.get(e.studentId) ?? ZERO;
        return {
          enrollmentId: e.id,
          studentId: e.student.id,
          studentNumber: e.student.studentNumber,
          fullName: this.fullName(e.student),
          classroom: e.classroom.displayName,
          feeCount: own.length,
          ...serialiseTotals(totals),
          broughtForward: toMoneyString(bf.lessThan(ZERO) ? ZERO : bf),
          totalDue: toMoneyString(totals.outstanding.add(bf.lessThan(ZERO) ? ZERO : bf)),
          paymentState: own.length ? paymentState(totals) : null,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const levelTotals = ledgerTotals(
      sum(assignments.map((a) => a.amountDue)),
      sum(assignments.map((a) => collectedFrom(a.payments))),
    );

    return {
      level: { id: level.id, name: level.name },
      term: { id: term.id, label: term.label },
      students,
      totals: serialiseTotals(levelTotals),
      studentCount: enrollments.length,
      // The number that makes the manual reconcile safe.
      unassignedStudentCount: students.filter((s) => s.feeCount === 0).length,
    };
  }

  /**
   * The fee ledger — the CAPABILITY of FEE-A6 without its table.
   *
   * The "account" is a GROUP BY over (feeType, year, term). A row for it would
   * own no data of its own and would acquire a lifecycle nobody wants to
   * define; a stored running total would be a denormalised counter that
   * drifts, and drift in a money column is the exact failure this module
   * exists to avoid.
   *
   * THREE COLUMNS. There is no fourth and nothing named "Balance".
   */
  async ledger(query: QueryLedgerDto, schoolId: string) {
    const assignments = await this.prisma.feeAssignment.findMany({
      where: {
        schoolId,
        schoolFee: {
          academicYearId: query.academicYearId,
          ...(query.termId ? { termId: query.termId } : {}),
        },
      },
      include: {
        payments: { select: { amount: true } },
        schoolFee: {
          include: { feeType: { include: { label: true } }, term: true },
        },
      },
    });

    const groups = new Map<string, any>();
    for (const a of assignments) {
      const fee = a.schoolFee;
      const key = `${fee.feeTypeId}:${fee.termId}`;
      const entry = groups.get(key) ?? {
        feeTypeId: fee.feeTypeId,
        feeTypeName: fee.feeType.name,
        // Carried for Stage 3's profit and loss, which groups by section.
        label: fee.feeType.label
          ? { id: fee.feeType.label.id, name: fee.feeType.label.name, category: fee.feeType.label.category }
          : null,
        termId: fee.termId,
        termLabel: fee.term.label,
        accountName: `${fee.feeType.name} - ${fee.term.label}`,
        billed: ZERO,
        collected: ZERO,
        assignmentCount: 0,
      };
      entry.billed = entry.billed.add(a.amountDue);
      entry.collected = entry.collected.add(collectedFrom(a.payments));
      entry.assignmentCount += 1;
      groups.set(key, entry);
    }

    // Destructure the raw Decimal accumulators OUT before spreading the
    // serialised strings in — spreading first and blanking them afterwards
    // overwrites the good values with undefined.
    const rows = [...groups.values()]
      .map(({ billed, collected, ...rest }) => ({
        ...rest,
        ...serialiseTotals(ledgerTotals(billed, collected)),
      }))
      .sort((a, b) =>
        a.termLabel.localeCompare(b.termLabel) || a.feeTypeName.localeCompare(b.feeTypeName),
      );

    const totals = ledgerTotals(
      sum(assignments.map((a) => a.amountDue)),
      sum(assignments.map((a) => collectedFrom(a.payments))),
    );

    return { rows, totals: serialiseTotals(totals) };
  }
}
