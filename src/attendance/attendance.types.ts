import { AttendanceStatus, TermStatus } from '@prisma/client';
import { AttendanceCounts, AttendanceDayShape, AttendanceSummary } from './attendance.reporting';

/**
 * View shapes returned by AttendanceService.
 *
 * They live here rather than in the service so the formatters can consume
 * them without importing the service (which would be a cycle). This is the
 * seam the OQ-5 amendment asks for: the query layer produces these
 * structures, and every output format is a pure function OVER them. If a
 * mandated NaSIA/GES register layout arrives, it is a new formatter reading
 * these same shapes — not a change to the queries.
 */

export interface RegisterStudentRow {
  enrollmentId: string;
  studentId: string;
  studentNumber: string;
  fullName: string;
  /**
   * null means NOT MARKED — there is no `not_marked` status, only a missing
   * row. Both sessions are null together or neither is: `afternoon_status` is
   * NOT NULL in the database, so a half-marked row cannot exist.
   */
  morningStatus: AttendanceStatus | null;
  morningReason: string | null;
  afternoonStatus: AttendanceStatus | null;
  afternoonReason: string | null;
  recordId: string | null;
  /** True when the row has been amended since it was first marked. */
  amended: boolean;
}

export interface RegisterTermInfo {
  id: string;
  label: string;
  status: TermStatus;
  /** True when this term's registers currently accept writes. */
  amendable: boolean;
}

export interface RegisterView {
  classroom: {
    id: string;
    displayName: string;
    levelName: string;
    academicYearId: string;
    academicYearLabel: string;
  };
  date: string;
  /** null when no term of that classroom's year covers the date. */
  term: RegisterTermInfo | null;
  /** Whether PUT /attendance/register would be accepted for this date. */
  editable: boolean;
  /** Why not, when `editable` is false. Null when it is. */
  lockReason: string | null;
  /** Per-status counts over SESSIONS, plus the day-shape counts. */
  counts: AttendanceCounts & AttendanceDayShape;
  /** Students with no record at all for this date. */
  unmarkedCount: number;
  rows: RegisterStudentRow[];
}

export interface SummaryTermInfo {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: TermStatus;
}

export interface StudentTermSummary {
  student: { id: string; studentNumber: string; fullName: string };
  classroom: { id: string; displayName: string } | null;
  term: SummaryTermInfo;
  summary: AttendanceSummary;
}

export interface ClassroomTermSummaryRow {
  enrollmentId: string;
  studentId: string;
  studentNumber: string;
  fullName: string;
  summary: AttendanceSummary;
}

export interface ClassroomTermSummary {
  classroom: { id: string; displayName: string; levelName: string };
  term: SummaryTermInfo;
  students: ClassroomTermSummaryRow[];
  /** Every student's records folded together. */
  classroomTotals: AttendanceSummary;
  /** How many distinct dates anybody in this classroom was marked on. */
  datesMarked: number;
}

// ── the printable register grid ───────────────────────────────────────────

/**
 * A DIFFERENT SHAPE from ClassroomTermSummary, deliberately.
 *
 * A term summary is one row per student with totals; a printable register is
 * students down the page and dates across, each cell showing AM and PM. No
 * formatter over ClassroomTermSummary can produce that, because the per-date
 * detail is not in that view. Hence a second read and a second view type
 * rather than a second formatter over the first.
 */
export interface RegisterGridCell {
  /** null on both when nobody marked this student on this date. */
  am: AttendanceStatus | null;
  pm: AttendanceStatus | null;
}

export interface ClassroomRegisterGridRow {
  enrollmentId: string;
  studentId: string;
  studentNumber: string;
  fullName: string;
  /** Keyed by `YYYY-MM-DD`. Dates absent from this map were not marked. */
  cells: Record<string, RegisterGridCell>;
  summary: AttendanceSummary;
}

export interface ClassroomRegisterGrid {
  school: { name: string };
  classroom: { id: string; displayName: string; levelName: string };
  term: SummaryTermInfo;
  /** The range actually rendered, which may be narrower than the term. */
  range: { from: string; to: string };
  /** Marked dates in range, ascending. Unmarked dates are not columns. */
  dates: string[];
  rows: ClassroomRegisterGridRow[];
  totals: AttendanceSummary;
}
