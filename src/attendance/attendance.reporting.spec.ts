import { AttendanceStatus } from '@prisma/client';
import {
  ABSENT_STATUSES,
  addTallies,
  emptyCounts,
  emptyDayShape,
  PRESENT_STATUSES,
  summarise,
  summariseRecords,
  tally,
} from './attendance.reporting';

/**
 * The reporting rule is deliberately defined in exactly one place, because
 * two independent definitions of "attendance" is how a product ends up
 * answering the same question two different ways on two different screens.
 * These tests pin the rule so a later change to it has to be deliberate.
 *
 * A row covers a DAY and carries a status for each of its two SESSIONS.
 */
const P = AttendanceStatus.present;
const A = AttendanceStatus.absent;
const L = AttendanceStatus.late;
const E = AttendanceStatus.excused;

/** One register row, `d(am, pm)`. `d(x)` is the mirrored case. */
const d = (morningStatus: AttendanceStatus, afternoonStatus = morningStatus) => ({
  morningStatus,
  afternoonStatus,
});

describe('attendance reporting rule', () => {
  it('counts late as PRESENT and excused as ABSENT', () => {
    expect(PRESENT_STATUSES).toEqual([AttendanceStatus.present, AttendanceStatus.late]);
    expect(ABSENT_STATUSES).toEqual([AttendanceStatus.absent, AttendanceStatus.excused]);
  });

  it('folds four statuses into sessions present and sessions absent', () => {
    const summary = summariseRecords([d(P), d(P), d(L), d(A), d(E)]);

    // Per-status counts are over SESSIONS: each row contributes two.
    expect(summary.present).toBe(4);
    expect(summary.late).toBe(2);
    expect(summary.absent).toBe(2);
    expect(summary.excused).toBe(2);
    // late is present, excused is absent
    expect(summary.sessionsPresent).toBe(6);
    expect(summary.sessionsAbsent).toBe(4);
    expect(summary.sessionsMarked).toBe(10);
    expect(summary.daysMarked).toBe(5);
    expect(summary.attendanceRate).toBe(60);
  });

  it('counts sessions rather than resolving a mixed day either way', () => {
    // The rule this module chose: NOT "present if either" (which would make a
    // child who goes home every lunchtime look perfect) and NOT "present only
    // if both" (which would let one late afternoon erase a whole morning).
    const summary = summariseRecords([d(P, A)]);

    expect(summary.sessionsPresent).toBe(1);
    expect(summary.sessionsAbsent).toBe(1);
    expect(summary.attendanceRate).toBe(50);
    expect(summary.daysFullyPresent).toBe(0);
    expect(summary.daysFullyAbsent).toBe(0);
    expect(summary.daysPartial).toBe(1);
  });

  it('classifies each day as fully present, fully absent or partial — exhaustively', () => {
    const summary = summariseRecords([
      d(P), // fully present
      d(L), // fully present — late counts as present
      d(A), // fully absent
      d(E), // fully absent — excused counts as absent
      d(P, A), // partial: went home at lunch
      d(A, P), // partial: arrived after lunch
      d(L, E), // partial across the two "soft" statuses
    ]);

    expect(summary.daysMarked).toBe(7);
    expect(summary.daysFullyPresent).toBe(2);
    expect(summary.daysFullyAbsent).toBe(2);
    expect(summary.daysPartial).toBe(3);
    // Every day lands in exactly one bucket.
    expect(
      summary.daysFullyPresent + summary.daysFullyAbsent + summary.daysPartial,
    ).toBe(summary.daysMarked);
  });

  it('still reports late and excused separately, not only folded', () => {
    const summary = summariseRecords([d(L, E)]);
    expect(summary.late).toBe(1);
    expect(summary.excused).toBe(1);
  });

  it('has a null rate when nothing is marked, never a divide-by-zero', () => {
    const summary = summariseRecords([]);
    expect(summary.daysMarked).toBe(0);
    expect(summary.sessionsMarked).toBe(0);
    expect(summary.daysPartial).toBe(0);
    expect(summary.attendanceRate).toBeNull();
  });

  it('rounds the rate to one decimal place', () => {
    // 4 of 6 sessions → 66.666… → 66.7
    const summary = summariseRecords([d(P), d(L), d(A)]);
    expect(summary.attendanceRate).toBe(66.7);
  });

  it('sessionsMarked is always 2 x daysMarked', () => {
    const summary = summariseRecords([d(P), d(P, A), d(E), d(L, P)]);
    expect(summary.sessionsMarked).toBe(summary.daysMarked * 2);
  });

  it('sessionsMarked counts marked sessions only — NOT school sessions in the term', () => {
    // The denominator is sessions somebody actually marked. A term with 60
    // school days but 5 marked registers reports out of 10 sessions. Report
    // cards will need a school-day count; that concept does not exist yet and
    // must not be faked by redefining this.
    const summary = summariseRecords([d(P), d(P), d(P), d(P), d(A)]);
    expect(summary.daysMarked).toBe(5);
    expect(summary.sessionsMarked).toBe(10);
    expect(summary.attendanceRate).toBe(80);
  });

  it('a mornings-only class marking both sessions the same gets the honest rate', () => {
    // OQ-27: no half-day flag, deliberately. A Creche class that genuinely
    // runs mornings only marks both sessions identically, which is EXPECTED
    // and not a bug — and because 2p/2n = p/n it produces exactly the rate a
    // morning-only count would.
    const mirrored = summariseRecords([d(P), d(P), d(A), d(P)]);
    expect(mirrored.attendanceRate).toBe(75);
    expect(mirrored.daysPartial).toBe(0);
  });

  it('tally and summarise compose to the same result as summariseRecords', () => {
    const rows = [d(P), d(E), d(P, A)];
    expect(summarise(tally(rows))).toEqual(summariseRecords(rows));
  });

  it('addTallies sums raw tallies so a total is never re-derived from summaries', () => {
    const a = tally([d(P), d(P, A)]);
    const b = tally([d(E), d(L)]);
    const acc = { ...emptyCounts(), ...emptyDayShape() };
    addTallies(acc, a);
    addTallies(acc, b);

    expect(summarise(acc)).toEqual(summariseRecords([d(P), d(P, A), d(E), d(L)]));
  });
});
