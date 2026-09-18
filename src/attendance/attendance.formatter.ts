import { AttendanceStatus } from '@prisma/client';
import { ClassroomRegisterGrid, ClassroomTermSummary } from './attendance.types';

/**
 * Output formatters for attendance reports.
 *
 * DELIBERATELY SEPARATE from the service and the controller. Whether Brite's
 * register output has to match a specific NaSIA/GES layout is an open
 * question at the time of writing; keeping every format as a pure function
 * over the view shapes in attendance.types.ts means the answer costs a new
 * function here, not a rewrite of the query layer.
 *
 * Rules for anything added here:
 *   - Pure. No Prisma, no HTTP, no service imports.
 *   - Input is a view shape from attendance.types.ts, nothing else.
 *   - Never recompute sessions-present/sessions-absent/rate/daysPartial.
 *     Those arrive already computed by attendance.reporting.ts, which is the
 *     single definition.
 *
 * Formats are DISPATCHED through the registries at the bottom of this file
 * rather than by a switch in the controller, so adding one is a single entry
 * here and the controller does not change.
 */

/**
 * RFC 4180 field escaping, plus a leading apostrophe on anything a
 * spreadsheet would treat as a formula. Student numbers and names are
 * user-controlled and end up in Excel.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\n\r,]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(',');
}

const CLASSROOM_TERM_HEADERS = [
  'Student Number',
  'Student Name',
  'Present',
  'Late',
  'Absent',
  'Excused',
  'Days Marked',
  'Sessions Marked',
  'Sessions Present',
  'Sessions Absent',
  'Days Fully Present',
  'Days Fully Absent',
  'Days Partial',
  'Attendance Rate (%)',
];

/**
 * Per-classroom, per-term summary as CSV: one row per enrolled student, then
 * a totals row.
 *
 * The preamble lines carry the school-facing context an inspector or a head
 * needs to read the sheet on its own — and, importantly, state the
 * denominator explicitly so nobody reads "Days Marked" as school days. See
 * the denominator note in attendance.reporting.ts.
 */
export function classroomTermSummaryToCsv(summary: ClassroomTermSummary): string {
  const lines: string[] = [];

  lines.push(csvRow(['Classroom', summary.classroom.displayName]));
  lines.push(csvRow(['Level', summary.classroom.levelName]));
  lines.push(csvRow(['Term', summary.term.label]));
  lines.push(csvRow(['Period', `${summary.term.startDate} to ${summary.term.endDate}`]));
  lines.push(csvRow(['Dates marked', summary.datesMarked]));
  lines.push(
    csvRow([
      'Note',
      'Each day has two sessions (morning and afternoon). Rates are over sessions ' +
        'marked in this register, not over school sessions in the term.',
    ]),
  );
  lines.push(
    csvRow([
      'Note',
      'A class that runs mornings only marks both sessions the same. That is ' +
        'expected and does not change the rate.',
    ]),
  );
  lines.push('');
  lines.push(csvRow(CLASSROOM_TERM_HEADERS));

  for (const row of summary.students) {
    lines.push(
      csvRow([
        row.studentNumber,
        row.fullName,
        row.summary.present,
        row.summary.late,
        row.summary.absent,
        row.summary.excused,
        row.summary.daysMarked,
        row.summary.sessionsMarked,
        row.summary.sessionsPresent,
        row.summary.sessionsAbsent,
        row.summary.daysFullyPresent,
        row.summary.daysFullyAbsent,
        row.summary.daysPartial,
        row.summary.attendanceRate ?? '',
      ]),
    );
  }

  const totals = summary.classroomTotals;
  lines.push(
    csvRow([
      '',
      'CLASS TOTAL',
      totals.present,
      totals.late,
      totals.absent,
      totals.excused,
      totals.daysMarked,
      totals.sessionsMarked,
      totals.sessionsPresent,
      totals.sessionsAbsent,
      totals.daysFullyPresent,
      totals.daysFullyAbsent,
      totals.daysPartial,
      totals.attendanceRate ?? '',
    ]),
  );

  // Trailing newline: some spreadsheet importers drop the last row without it.
  return `${lines.join('\n')}\n`;
}

/** Filename for the classroom-term CSV download. */
export function classroomTermSummaryFilename(summary: ClassroomTermSummary): string {
  const slug = (text: string) =>
    text.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `attendance-${slug(summary.classroom.displayName)}-${slug(summary.term.label)}.csv`;
}

// ── the printable register grid ───────────────────────────────────────────

/**
 * NO SERVER-SIDE PDF, deliberately.
 *
 * Brite has no PDF library and `File` is metadata-only; a PDF pipeline is a
 * bigger change than this feature. This renders print-styled HTML that the
 * browser prints to PDF, which is how every other printable in Brite works.
 * The registry's `string | Buffer` return type below is the seam that lets a
 * genuine server-side PDF arrive later as a THIRD format without touching the
 * dispatch mechanism.
 */

const GLYPH: Record<AttendanceStatus, string> = {
  present: 'P',
  absent: 'A',
  late: 'L',
  excused: 'E',
};

/** Ten school days × two sub-columns is about the widest that stays legible on A4 landscape. */
const DATES_PER_PAGE = 10;

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `2026-09-17` → `Thu 17 Sep`, split over two lines to keep the column narrow. */
function dateHeader(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const num = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return `<span class="dow">${escapeHtml(day)}</span><span class="dom">${escapeHtml(num)}</span>`;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (!items.length) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Students down the page, dates across, each cell a two-glyph AM·PM pair.
 *
 * Paginated a fortnight at a time, with the student name and number repeated
 * as frozen left-hand columns on every page — a register whose second page
 * does not say whose row is whose is not a register.
 */
export function classroomRegisterGridToHtml(grid: ClassroomRegisterGrid): string {
  const pages = chunk(grid.dates, DATES_PER_PAGE);

  const heading = `${grid.classroom.displayName} — ${grid.term.label}`;

  const pageHtml = pages
    .map((dates, index) => {
      const head = dates.map((date) => `<th colspan="2">${dateHeader(date)}</th>`).join('');
      const sub = dates.map(() => '<th class="sub">AM</th><th class="sub">PM</th>').join('');

      const body = grid.rows
        .map((row) => {
          const cells = dates
            .map((date) => {
              const cell = row.cells[date];
              if (!cell) {
                // Not marked. An em dash, not a blank, so a reader can tell
                // "nobody marked this" from "the ink ran out".
                return '<td class="unmarked">—</td><td class="unmarked">—</td>';
              }
              const am = cell.am ? GLYPH[cell.am] : '—';
              const pm = cell.pm ? GLYPH[cell.pm] : '—';
              const mixed = cell.am !== cell.pm ? ' mixed' : '';
              return (
                `<td class="s-${escapeHtml(cell.am)}${mixed}">${escapeHtml(am)}</td>` +
                `<td class="s-${escapeHtml(cell.pm)}${mixed}">${escapeHtml(pm)}</td>`
              );
            })
            .join('');

          return (
            '<tr>' +
            `<td class="num">${escapeHtml(row.studentNumber)}</td>` +
            `<td class="name">${escapeHtml(row.fullName)}</td>` +
            cells +
            `<td class="total">${escapeHtml(row.summary.sessionsPresent)}/${escapeHtml(
              row.summary.sessionsMarked,
            )}</td>` +
            `<td class="total">${
              row.summary.attendanceRate === null
                ? '—'
                : `${escapeHtml(row.summary.attendanceRate)}%`
            }</td>` +
            '</tr>'
          );
        })
        .join('');

      const pageLabel =
        pages.length > 1 ? ` <span class="page-of">(page ${index + 1} of ${pages.length})</span>` : '';

      return `
<section class="sheet">
  <header>
    <h1>${escapeHtml(grid.school.name)}</h1>
    <h2>Attendance register — ${escapeHtml(heading)}${pageLabel}</h2>
  </header>
  <table>
    <thead>
      <tr>
        <th rowspan="2" class="num">No.</th>
        <th rowspan="2" class="name">Student</th>
        ${head}
        <th colspan="2" class="total">Total</th>
      </tr>
      <tr>
        ${sub}
        <th class="sub total">Sess.</th>
        <th class="sub total">Rate</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" class="name">CLASS TOTAL</td>
        <td colspan="${dates.length * 2}" class="shape">
          ${escapeHtml(grid.totals.daysFullyPresent)} full days present ·
          ${escapeHtml(grid.totals.daysFullyAbsent)} full days absent ·
          ${escapeHtml(grid.totals.daysPartial)} partial
        </td>
        <td class="total">${escapeHtml(grid.totals.sessionsPresent)}/${escapeHtml(
          grid.totals.sessionsMarked,
        )}</td>
        <td class="total">${
          grid.totals.attendanceRate === null ? '—' : `${escapeHtml(grid.totals.attendanceRate)}%`
        }</td>
      </tr>
    </tfoot>
  </table>
  <footer>
    <p class="legend">
      <strong>P</strong> present · <strong>L</strong> late (counts as present) ·
      <strong>A</strong> absent · <strong>E</strong> excused (counts as absent) ·
      <strong>—</strong> not marked. Each day has two sessions: AM and PM.
    </p>
    <p class="caveat">
      ${escapeHtml(grid.school.name)} · ${escapeHtml(grid.classroom.displayName)}
      (${escapeHtml(grid.classroom.levelName)}) · ${escapeHtml(grid.term.label)} ·
      ${escapeHtml(grid.range.from)} to ${escapeHtml(grid.range.to)} ·
      printed ${escapeHtml(new Date().toISOString().slice(0, 10))}.
      <strong>Rates are over sessions MARKED in this register</strong>, not over
      school sessions in the term: only dates somebody marked appear as columns,
      and this system holds no school calendar that could tell a holiday from an
      unmarked day. A class that runs mornings only marks both sessions the same,
      which is expected and does not change the rate.
    </p>
  </footer>
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Attendance register — ${escapeHtml(heading)}</title>
<style>
  /* Landscape: ten school days × two sub-columns is the widest legible A4. */
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         font-size: 10pt; color: #111; margin: 0; background: #f4f4f5; }
  .sheet { background: #fff; padding: 8mm; margin: 0 auto 8mm; max-width: 297mm; }
  .sheet + .sheet { page-break-before: always; }
  header h1 { font-size: 13pt; margin: 0; }
  header h2 { font-size: 11pt; margin: 2pt 0 6pt; font-weight: 600; color: #333; }
  .page-of { font-weight: 400; color: #666; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 0.5pt solid #999; padding: 2pt 3pt; text-align: center; }
  thead th { background: #eee; font-size: 8.5pt; line-height: 1.15; }
  th.sub { font-size: 7.5pt; font-weight: 500; color: #444; }
  .dow, .dom { display: block; }
  .dow { font-weight: 400; color: #555; }
  /* Name and number frozen left: they repeat on every page and never scroll away. */
  th.num, td.num { width: 18mm; text-align: left; font-variant-numeric: tabular-nums; }
  th.name, td.name { width: 42mm; text-align: left; }
  td.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  td.total, th.total { width: 13mm; font-variant-numeric: tabular-nums; background: #fafafa; }
  td.unmarked { color: #bbb; }
  /* A mixed day is the thing this register exists to show — it gets a rule. */
  td.mixed { border-bottom: 1.5pt solid #444; }
  td.s-absent, td.s-excused { background: #f6f6f6; font-weight: 600; }
  tfoot td { background: #f0f0f0; font-weight: 600; }
  tfoot td.shape { font-weight: 400; }
  footer { margin-top: 4pt; }
  .legend { font-size: 8.5pt; margin: 4pt 0 2pt; }
  .caveat { font-size: 7.5pt; color: #444; margin: 0; line-height: 1.35; }
  @media print { body { background: #fff; } .sheet { margin: 0; padding: 0; } }
</style>
</head>
<body>${pageHtml}
</body>
</html>
`;
}

function slug(text: string): string {
  return text.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

export function classroomRegisterGridFilename(grid: ClassroomRegisterGrid): string {
  return `register-${slug(grid.classroom.displayName)}-${slug(grid.term.label)}-${
    grid.range.from
  }-to-${grid.range.to}.html`;
}

// ── the format registries ─────────────────────────────────────────────────

/**
 * One entry per downloadable format. The controller resolves `?format=`
 * against a registry and 400s on an unknown value LISTING the valid ones,
 * which is also how a client discovers them. Adding a format is one entry
 * here and nothing else.
 *
 * `render` returns `string | Buffer` so a future binary format (a real
 * server-side PDF, an xlsx) needs no signature change.
 */
export interface AttendanceExport<TView> {
  /** The `?format=` value. */
  id: string;
  /** For a UI picker. */
  label: string;
  contentType: string;
  render(view: TView): string | Buffer;
  filename(view: TView): string;
}

/**
 * TWO registries, not one, because they are keyed to different view shapes: a
 * term summary is one row per student with totals, a register grid is
 * students × dates. A single registry would have to erase the view type and
 * the compiler would stop catching a formatter pointed at the wrong read.
 */
export const CLASSROOM_TERM_EXPORTS: Record<string, AttendanceExport<ClassroomTermSummary>> = {
  csv: {
    id: 'csv',
    label: 'Spreadsheet (CSV)',
    contentType: 'text/csv; charset=utf-8',
    render: classroomTermSummaryToCsv,
    filename: classroomTermSummaryFilename,
  },
};

export const CLASSROOM_REGISTER_EXPORTS: Record<string, AttendanceExport<ClassroomRegisterGrid>> = {
  register: {
    id: 'register',
    label: 'Printable register',
    contentType: 'text/html; charset=utf-8',
    render: classroomRegisterGridToHtml,
    filename: classroomRegisterGridFilename,
  },
};

/**
 * Resolves a `?format=` value against a registry, or throws a message naming
 * every valid one. The caller turns it into a 400; this stays pure so the
 * formatter file keeps its no-HTTP rule.
 */
export function resolveExport<TView>(
  registry: Record<string, AttendanceExport<TView>>,
  format: string | undefined,
  fallback: string,
): AttendanceExport<TView> {
  const id = (format ?? fallback).trim().toLowerCase();
  const chosen = registry[id];
  if (!chosen) {
    throw new Error(
      `Unknown export format '${format}'. Valid formats: ${Object.keys(registry)
        .map((key) => `'${key}'`)
        .join(', ')}.`,
    );
  }
  return chosen;
}
