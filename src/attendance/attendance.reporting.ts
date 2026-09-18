import { AttendanceStatus } from '@prisma/client';

/**
 * THE attendance reporting rule. One definition, used everywhere.
 *
 * A register row covers a DAY and states a status for each of its two
 * SESSIONS — morning and afternoon. Everything below counts sessions.
 *
 * Four statuses collapse to two for rate purposes, and a status now
 * classifies a session rather than a day:
 *
 *   late    counts as PRESENT — the child was in school.
 *   excused counts as ABSENT  — the child was not in school.
 *
 * Both are also always reported as their own counts, so a head can see the
 * composition and not just the rate.
 *
 * WHY SESSIONS AND NOT FRACTIONAL DAYS. When the two sessions disagree there
 * are three possible rules: present if EITHER session is present (a child who
 * goes home at lunch every day looks perfect), present only if BOTH are
 * (one late afternoon erases a whole morning), or count the sessions. Only
 * the third describes what actually happened. Expressing it in sessions
 * rather than half-days keeps every intermediate an integer and leaves the
 * rate a single division at the end, instead of admitting 0.5 into a reported
 * figure and then into a rounding argument.
 *
 * Every caller that needs sessions-present, sessions-absent or a rate MUST
 * come through `summarise` below. If a second query ever computes this
 * independently, the two will drift and the product will have two different
 * answers to "what is this child's attendance" — which is exactly the defect
 * this module was designed to avoid inheriting.
 *
 * DENOMINATOR — read this before building report cards.
 * `attendanceRate` is over sessions MARKED, not over school sessions in the
 * term. Brite has no school-calendar or holiday concept, so it cannot tell
 * "nobody marked the register on 14 March" from "14 March was a holiday".
 * Every figure here therefore means "76 present of 84 sessions marked", never
 * "of 120 school sessions".
 *
 * The GES pupil's report card wants "attendance ___ out of a total of ___",
 * where the total IS a school-day count. Whoever builds report cards has to
 * introduce a school-calendar/term-working-days concept first and decide
 * whether these figures are restated against it. That decision was
 * deliberately deferred, not overlooked — do not silently redefine
 * `daysMarked` or `sessionsMarked` to mean scheduled school time.
 *
 * NO HALF-DAY / SESSIONS-APPLICABLE FLAG. A Crèche or nursery class that
 * genuinely runs mornings only marks BOTH sessions identically. That is
 * expected behaviour, not a bug and not a data-entry error: the rate comes
 * out the same as a morning-only count would, because 2p/2n = p/n. Making the
 * afternoon optional per classroom would add a configuration surface nobody
 * asked for; it is recorded as an open question, not designed in.
 *
 * RATE-NEUTRALITY ACROSS THE PART B MIGRATION. The backfill set both sessions
 * of every pre-Part-B row equal, so such a row contributes 2/2 or 0/2 and a
 * set of them yields 2p/2n = p/n — identical to the day-level rate they were
 * printed with. `attendance.rate-neutrality.spec.ts` asserts this directly
 * against real captured pre-migration data rather than leaving it as a claim.
 */

/** Statuses that count toward "present" in the rate. */
export const PRESENT_STATUSES: readonly AttendanceStatus[] = [
  AttendanceStatus.present,
  AttendanceStatus.late,
];

/** Statuses that count toward "absent" in the rate. */
export const ABSENT_STATUSES: readonly AttendanceStatus[] = [
  AttendanceStatus.absent,
  AttendanceStatus.excused,
];

/** Raw per-status tallies, over SESSIONS. */
export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  excused: number;
}

/** The two sessions of one register row. */
export interface AttendanceSessions {
  morningStatus: AttendanceStatus;
  afternoonStatus: AttendanceStatus;
}

/** Whole-day shape counts, which only a row (not a loose session) can produce. */
export interface AttendanceDayShape {
  /** Rows of any status in the period. NOT school days — see the note above. */
  daysMarked: number;
  /** Both sessions present. */
  daysFullyPresent: number;
  /** Both sessions absent. */
  daysFullyAbsent: number;
  /** The sessions disagree — the number this feature exists to surface. */
  daysPartial: number;
}

export interface AttendanceSummary extends AttendanceCounts, AttendanceDayShape {
  /** 2 × daysMarked. */
  sessionsMarked: number;
  /** present + late, over sessions. */
  sessionsPresent: number;
  /** absent + excused, over sessions. */
  sessionsAbsent: number;
  /**
   * sessionsPresent / sessionsMarked, rounded to 1dp. Null when nothing is
   * marked.
   */
  attendanceRate: number | null;
}

/** How many sessions of one row count as present: 2, 1 or 0. */
export const SESSIONS_PER_DAY = 2;

export function emptyCounts(): AttendanceCounts {
  return { present: 0, absent: 0, late: 0, excused: 0 };
}

export function emptyDayShape(): AttendanceDayShape {
  return { daysMarked: 0, daysFullyPresent: 0, daysFullyAbsent: 0, daysPartial: 0 };
}

function countsAsPresent(status: AttendanceStatus): boolean {
  return PRESENT_STATUSES.includes(status);
}

/**
 * Tallies a set of register rows into per-status SESSION counts and whole-day
 * shape counts. Each row contributes two sessions and exactly one day.
 */
export function tally(rows: AttendanceSessions[]): AttendanceCounts & AttendanceDayShape {
  const counts = emptyCounts();
  const shape = emptyDayShape();

  for (const row of rows) {
    counts[row.morningStatus] += 1;
    counts[row.afternoonStatus] += 1;

    shape.daysMarked += 1;
    const am = countsAsPresent(row.morningStatus);
    const pm = countsAsPresent(row.afternoonStatus);
    if (am && pm) shape.daysFullyPresent += 1;
    else if (!am && !pm) shape.daysFullyAbsent += 1;
    else shape.daysPartial += 1;
  }

  return { ...counts, ...shape };
}

/**
 * The single place where late/excused are folded into present/absent.
 * Nothing else in the codebase may do this arithmetic.
 */
export function summarise(
  tallied: AttendanceCounts & AttendanceDayShape,
): AttendanceSummary {
  const sessionsPresent = tallied.present + tallied.late;
  const sessionsAbsent = tallied.absent + tallied.excused;
  const sessionsMarked = sessionsPresent + sessionsAbsent;

  return {
    ...tallied,
    sessionsMarked,
    sessionsPresent,
    sessionsAbsent,
    attendanceRate:
      sessionsMarked === 0
        ? null
        : Math.round((sessionsPresent / sessionsMarked) * 1000) / 10,
  };
}

/** Convenience: tally then summarise. */
export function summariseRecords(rows: AttendanceSessions[]): AttendanceSummary {
  return summarise(tally(rows));
}

/**
 * Adds one row's tallies into an accumulator, so a classroom total is the sum
 * of its students' tallies passed through the SAME `summarise()` rather than
 * a second, independently derived figure.
 */
export function addTallies<T extends AttendanceCounts & AttendanceDayShape>(
  into: T,
  from: AttendanceCounts & AttendanceDayShape,
): T {
  into.present += from.present;
  into.absent += from.absent;
  into.late += from.late;
  into.excused += from.excused;
  into.daysMarked += from.daysMarked;
  into.daysFullyPresent += from.daysFullyPresent;
  into.daysFullyAbsent += from.daysFullyAbsent;
  into.daysPartial += from.daysPartial;
  return into;
}
