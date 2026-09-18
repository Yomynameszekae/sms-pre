import * as fs from 'fs';
import * as path from 'path';
import { AttendanceStatus } from '@prisma/client';
import { summariseRecords } from './attendance.reporting';

/**
 * THE PROPERTY THAT MAKES THE PART B MIGRATION SAFE TO RUN.
 *
 * Part B replaced a day-level `status` with a morning/afternoon pair and
 * backfilled `afternoon := morning`. Stakeholders have already been shown
 * attendance figures produced by the day-level rule. If the session-level
 * rule returns a different percentage for the same historical data, the
 * migration silently rewrites numbers people have seen — which is not a thing
 * that can be fixed afterwards by apologising.
 *
 * This asserts rate-neutrality DIRECTLY, against real data, not as a claim:
 *
 *   __fixtures__/pre-migration-attendance.json was captured from the seeded
 *   demo database BEFORE the migration ran, by calling the then-current
 *   day-level `summariseRecords()`. Its `oldSummary` values are literally what
 *   a term summary printed at that moment. This spec replays the same rows
 *   through the migration's backfill (afternoon := morning) and the NEW
 *   session-level rule, and requires every rate to come out identical.
 *
 * The fixture is frozen input. Do not regenerate it — the day-level code that
 * produced it no longer exists, so a regenerated file would be this rule
 * checking itself.
 */

interface FixtureStudent {
  enrollmentId: string;
  classroom: string;
  studentNumber: string;
  days: { date: string; status: string }[];
  oldSummary: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    daysMarked: number;
    daysPresent: number;
    daysAbsent: number;
    attendanceRate: number | null;
  };
}

// Read rather than `import`: the fixture is test-only data and has no business
// being copied into dist/ by the build.
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '__fixtures__', 'pre-migration-attendance.json'),
    'utf-8',
  ),
) as {
  totalRows: number;
  students: FixtureStudent[];
  overallOldSummary: FixtureStudent['oldSummary'];
};

const students = fixture.students;

/** Exactly what migration statement 3 did: afternoon := morning. */
function backfill(days: { status: string }[]) {
  return days.map((d) => ({
    morningStatus: d.status as AttendanceStatus,
    afternoonStatus: d.status as AttendanceStatus,
  }));
}

describe('Part B migration is rate-neutral over real pre-migration data', () => {
  it('the fixture is the real captured baseline, not an empty file', () => {
    expect(fixture.totalRows).toBeGreaterThan(100);
    expect(students.length).toBeGreaterThan(0);
    expect(students.reduce((n, s) => n + s.days.length, 0)).toBe(fixture.totalRows);
    // All four statuses must be present, or the property is only tested on the
    // easy half of the status table.
    const seen = new Set(students.flatMap((s) => s.days.map((d) => d.status)));
    expect([...seen].sort()).toEqual(['absent', 'excused', 'late', 'present']);
  });

  it.each(students.map((s) => [`${s.classroom} / ${s.studentNumber}`, s] as const))(
    'every student keeps their exact rate: %s',
    (_label, student) => {
      const now = summariseRecords(backfill(student.days));

      // THE assertion. Same percentage, to the digit.
      expect(now.attendanceRate).toBe(student.oldSummary.attendanceRate);

      // And the proportion is neutral for the same reason the rate is: the
      // session counts are exactly double the day counts.
      expect(now.sessionsPresent).toBe(student.oldSummary.daysPresent * 2);
      expect(now.sessionsAbsent).toBe(student.oldSummary.daysAbsent * 2);
      expect(now.sessionsMarked).toBe(student.oldSummary.daysMarked * 2);
      expect(now.daysMarked).toBe(student.oldSummary.daysMarked);
    },
  );

  it('the whole-school figure is unchanged to the digit', () => {
    const allDays = students.flatMap((s) => s.days);
    const now = summariseRecords(backfill(allDays));

    expect(now.attendanceRate).toBe(fixture.overallOldSummary.attendanceRate);
    expect(now.sessionsMarked).toBe(fixture.overallOldSummary.daysMarked * 2);
    expect(now.daysMarked).toBe(fixture.overallOldSummary.daysMarked);
  });

  it('per-classroom figures are unchanged to the digit', () => {
    const byClassroom = new Map<string, { status: string }[]>();
    const oldByClassroom = new Map<string, { present: number; marked: number }>();

    for (const s of students) {
      const rows = byClassroom.get(s.classroom) ?? [];
      rows.push(...s.days);
      byClassroom.set(s.classroom, rows);

      const agg = oldByClassroom.get(s.classroom) ?? { present: 0, marked: 0 };
      agg.present += s.oldSummary.daysPresent;
      agg.marked += s.oldSummary.daysMarked;
      oldByClassroom.set(s.classroom, agg);
    }

    expect(byClassroom.size).toBeGreaterThan(1);

    for (const [classroom, rows] of byClassroom) {
      const agg = oldByClassroom.get(classroom)!;
      const oldRate = Math.round((agg.present / agg.marked) * 1000) / 10;
      expect({ classroom, rate: summariseRecords(backfill(rows)).attendanceRate })
        .toEqual({ classroom, rate: oldRate });
    }
  });

  it('a backfilled row is fully present or fully absent, never partial', () => {
    // The corollary that makes the above hold: the backfill cannot manufacture
    // a mixed day, so daysPartial over historical data is exactly zero and
    // daysFullyPresent/daysFullyAbsent reproduce the old present/absent split.
    for (const student of students) {
      const now = summariseRecords(backfill(student.days));
      expect(now.daysPartial).toBe(0);
      expect(now.daysFullyPresent).toBe(student.oldSummary.daysPresent);
      expect(now.daysFullyAbsent).toBe(student.oldSummary.daysAbsent);
    }
  });

  it('the property is a real constraint — a NON-mirrored afternoon does move the rate', () => {
    // Guards against the test passing because the arithmetic is trivially
    // equal for any input. Flip one afternoon on a student who was fully
    // present and the rate must fall.
    const student = students.find((s) => s.oldSummary.attendanceRate === 100)
      ?? students.find((s) => s.oldSummary.daysPresent > 0)!;
    const rows = backfill(student.days);
    const flip = rows.findIndex((r) => r.morningStatus === AttendanceStatus.present);
    expect(flip).toBeGreaterThanOrEqual(0);
    rows[flip] = { ...rows[flip], afternoonStatus: AttendanceStatus.absent };

    const moved = summariseRecords(rows);
    expect(moved.attendanceRate).not.toBe(student.oldSummary.attendanceRate);
    expect(moved.daysPartial).toBe(1);
  });
});
