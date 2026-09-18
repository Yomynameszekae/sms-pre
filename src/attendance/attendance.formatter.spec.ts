import { AttendanceStatus } from '@prisma/client';
import {
  CLASSROOM_REGISTER_EXPORTS,
  CLASSROOM_TERM_EXPORTS,
  classroomRegisterGridFilename,
  classroomRegisterGridToHtml,
  classroomTermSummaryToCsv,
  classroomTermSummaryFilename,
  resolveExport,
} from './attendance.formatter';
import { ClassroomRegisterGrid, ClassroomTermSummary } from './attendance.types';
import { summariseRecords } from './attendance.reporting';

const P = AttendanceStatus.present;
const A = AttendanceStatus.absent;
const L = AttendanceStatus.late;
const E = AttendanceStatus.excused;

/** `n` register rows of `am`/`pm`. `sum(3, P)` is three fully-present days. */
const sum = (n: number, am: AttendanceStatus, pm: AttendanceStatus = am) =>
  summariseRecords(Array.from({ length: n }, () => ({ morningStatus: am, afternoonStatus: pm })));

/** Concatenates day-groups into one summary, the way a real term does. */
const sumOf = (groups: [number, AttendanceStatus, AttendanceStatus?][]) =>
  summariseRecords(
    groups.flatMap(([n, am, pm]) =>
      Array.from({ length: n }, () => ({ morningStatus: am, afternoonStatus: pm ?? am })),
    ),
  );

/**
 * The formatter is kept separate from the query layer so that a mandated
 * NaSIA/GES layout, if one turns out to be required, is a new function here
 * rather than a rewrite of the service. These tests pin that separation: the
 * input is a plain view shape, and nothing here recomputes the rule.
 */
function fixture(overrides: Partial<ClassroomTermSummary> = {}): ClassroomTermSummary {
  return {
    classroom: { id: 'c1', displayName: 'Basic 3A', levelName: 'Basic 3' },
    term: {
      id: 't1', label: 'Term 3', startDate: '2026-05-05',
      endDate: '2026-08-21', status: 'active',
    },
    students: [
      {
        enrollmentId: 'e1', studentId: 's1', studentNumber: 'STU-0001',
        fullName: 'Ama Boakye',
        // 8 fully present, 1 fully late (= present), 1 fully absent → 18/20 = 90%
        summary: sumOf([[8, P], [1, L], [1, A]]),
      },
      {
        enrollmentId: 'e2', studentId: 's2', studentNumber: 'STU-0002',
        fullName: 'Kofi Mensah',
        summary: sumOf([[9, P], [1, E]]),
      },
    ],
    classroomTotals: sumOf([[17, P], [1, A], [1, L], [1, E]]),
    datesMarked: 10,
    ...overrides,
  };
}

describe('classroomTermSummaryToCsv', () => {
  it('emits a header row, one row per student, and a class total', () => {
    const lines = classroomTermSummaryToCsv(fixture()).trim().split('\n');
    expect(lines.some((l) => l.startsWith('Student Number,Student Name'))).toBe(true);
    expect(lines.some((l) => l.includes('Ama Boakye'))).toBe(true);
    expect(lines.some((l) => l.includes('Kofi Mensah'))).toBe(true);
    expect(lines[lines.length - 1]).toContain('CLASS TOTAL');
  });

  it('carries the denominator caveat so the sheet cannot be misread', () => {
    // "Days Marked" is not school days. Anyone reading the CSV away from the
    // app has to be told that in the file itself.
    expect(classroomTermSummaryToCsv(fixture())).toMatch(
      /not over school sessions in the term/,
    );
  });

  it('writes the already-computed rate rather than recomputing it', () => {
    const csv = classroomTermSummaryToCsv(fixture());
    // Ama: 8 fully-present days + 1 fully-late + 1 fully-absent = 10 days,
    // 20 sessions, 18 present → 90%. Session counts are double the day counts.
    // present,late,absent,excused,daysMarked,sessMarked,sessPresent,sessAbsent,
    // fullPresent,fullAbsent,partial,rate
    expect(csv).toMatch(/Ama Boakye,16,2,2,0,10,20,18,2,9,1,0,90/);
  });

  it('renders a null rate as an empty cell, never as 0', () => {
    const csv = classroomTermSummaryToCsv(
      fixture({
        students: [{
          enrollmentId: 'e3', studentId: 's3', studentNumber: 'STU-0003',
          fullName: 'Unmarked Child',
          summary: sum(0, P),
        }],
      }),
    );
    // A child nobody marked has no attendance rate; 0% would be a lie.
    expect(csv).toMatch(/Unmarked Child,0,0,0,0,0,0,0,0,0,0,0,\s*$/m);
  });

  it('escapes commas and quotes in names', () => {
    const csv = classroomTermSummaryToCsv(
      fixture({
        students: [{
          enrollmentId: 'e4', studentId: 's4', studentNumber: 'STU-0004',
          fullName: 'Mensah, Kofi "KJ"',
          summary: sum(1, P),
        }],
      }),
    );
    expect(csv).toContain('"Mensah, Kofi ""KJ"""');
  });

  it('neutralises spreadsheet formula injection in user-controlled fields', () => {
    const csv = classroomTermSummaryToCsv(
      fixture({
        students: [{
          enrollmentId: 'e5', studentId: 's5', studentNumber: '=HYPERLINK("http://evil")',
          fullName: '+Attack',
          summary: sum(1, P),
        }],
      }),
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`'+Attack`);
  });
});

describe('classroomTermSummaryFilename', () => {
  it('slugs the classroom and term into a safe filename', () => {
    expect(classroomTermSummaryFilename(fixture())).toBe('attendance-basic-3a-term-3.csv');
  });
});

// ── the printable register grid ───────────────────────────────────────────

function gridFixture(overrides: Partial<ClassroomRegisterGrid> = {}): ClassroomRegisterGrid {
  return {
    school: { name: 'Brite Academy' },
    classroom: { id: 'c1', displayName: 'Basic 3A', levelName: 'Basic 3' },
    term: {
      id: 't1', label: 'Term 3', startDate: '2026-05-05',
      endDate: '2026-08-21', status: 'active',
    },
    range: { from: '2026-05-05', to: '2026-05-07' },
    dates: ['2026-05-05', '2026-05-06', '2026-05-07'],
    rows: [
      {
        enrollmentId: 'e1', studentId: 's1', studentNumber: 'STU-0001',
        fullName: 'Ama Boakye',
        cells: {
          '2026-05-05': { am: P, pm: P },
          '2026-05-06': { am: P, pm: A },   // went home at lunch
          '2026-05-07': { am: L, pm: P },
        },
        summary: summariseRecords([
          { morningStatus: P, afternoonStatus: P },
          { morningStatus: P, afternoonStatus: A },
          { morningStatus: L, afternoonStatus: P },
        ]),
      },
      {
        enrollmentId: 'e2', studentId: 's2', studentNumber: 'STU-0002',
        fullName: 'Kofi Mensah',
        // Deliberately missing 2026-05-07: nobody marked him that day.
        cells: {
          '2026-05-05': { am: E, pm: E },
          '2026-05-06': { am: P, pm: P },
        },
        summary: summariseRecords([
          { morningStatus: E, afternoonStatus: E },
          { morningStatus: P, afternoonStatus: P },
        ]),
      },
    ],
    totals: summariseRecords([
      { morningStatus: P, afternoonStatus: P },
      { morningStatus: P, afternoonStatus: A },
      { morningStatus: L, afternoonStatus: P },
      { morningStatus: E, afternoonStatus: E },
      { morningStatus: P, afternoonStatus: P },
    ]),
    ...overrides,
  };
}

describe('classroomRegisterGridToHtml', () => {
  it('renders every student as a row and every marked date as an AM/PM pair', () => {
    const html = classroomRegisterGridToHtml(gridFixture());
    expect(html).toContain('Ama Boakye');
    expect(html).toContain('Kofi Mensah');
    // Three dates x two sub-columns.
    expect(html.match(/<th class="sub">AM<\/th>/g)).toHaveLength(3);
    expect(html.match(/<th class="sub">PM<\/th>/g)).toHaveLength(3);
  });

  it('shows an unmarked date as a dash, not as an absence', () => {
    // Kofi has no cell for 2026-05-07. Rendering that as 'A' would invent an
    // absence nobody recorded — the whole point of having no `not_marked`
    // status.
    const html = classroomRegisterGridToHtml(gridFixture());
    expect(html).toContain('<td class="unmarked">—</td>');
  });

  it('marks a partial day visibly — that is what the grid exists to show', () => {
    const html = classroomRegisterGridToHtml(gridFixture());
    expect(html).toContain('mixed');
  });

  it('carries the legend and the denominator caveat, because the sheet leaves the app', () => {
    const html = classroomRegisterGridToHtml(gridFixture());
    expect(html).toMatch(/present/);
    expect(html).toMatch(/late \(counts as present\)/);
    expect(html).toMatch(/excused \(counts as absent\)/);
    expect(html).toMatch(/over sessions MARKED in this register/);
    // OQ-27, stated where a stakeholder will actually read it.
    expect(html).toMatch(/mornings only marks both sessions the same/);
  });

  it('prints the school, classroom, term and range in the footer', () => {
    const html = classroomRegisterGridToHtml(gridFixture());
    expect(html).toContain('Brite Academy');
    expect(html).toContain('Basic 3A');
    expect(html).toContain('Term 3');
    expect(html).toContain('2026-05-05');
    expect(html).toContain('2026-05-07');
  });

  it('writes the already-computed totals rather than recomputing them', () => {
    const grid = gridFixture();
    const html = classroomRegisterGridToHtml(grid);
    expect(html).toContain(`${grid.totals.sessionsPresent}/${grid.totals.sessionsMarked}`);
    expect(html).toContain(`${grid.totals.daysPartial} partial`);
  });

  it('paginates at a fortnight per page, repeating the name columns', () => {
    const dates = Array.from({ length: 23 }, (_, i) =>
      `2026-05-${String(i + 1).padStart(2, '0')}`,
    );
    const html = classroomRegisterGridToHtml(gridFixture({ dates }));
    // 23 dates over 10 per page = 3 sheets.
    expect(html.match(/<section class="sheet">/g)).toHaveLength(3);
    expect(html.match(/page 1 of 3/g)).toHaveLength(1);
    // The student name column repeats on every sheet.
    expect(html.match(/Ama Boakye/g)).toHaveLength(3);
  });

  it('renders a grid with no marked dates at all without throwing', () => {
    const html = classroomRegisterGridToHtml(
      gridFixture({ dates: [], rows: [], totals: summariseRecords([]) }),
    );
    expect(html).toContain('<section class="sheet">');
    expect(html).toContain('Brite Academy');
  });

  it('escapes HTML in user-controlled names', () => {
    const grid = gridFixture();
    grid.rows[0].fullName = '<script>alert(1)</script>';
    const html = classroomRegisterGridToHtml(grid);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('classroomRegisterGridFilename', () => {
  it('slugs the classroom, term and range into a safe filename', () => {
    expect(classroomRegisterGridFilename(gridFixture())).toBe(
      'register-basic-3a-term-3-2026-05-05-to-2026-05-07.html',
    );
  });
});

describe('the export registries', () => {
  it('each entry is self-describing, so a UI can list formats without a hardcoded map', () => {
    for (const registry of [CLASSROOM_TERM_EXPORTS, CLASSROOM_REGISTER_EXPORTS]) {
      for (const [key, entry] of Object.entries(registry)) {
        expect(entry.id).toBe(key);
        expect(entry.label).toBeTruthy();
        expect(entry.contentType).toMatch(/charset=utf-8/);
        expect(typeof entry.render).toBe('function');
        expect(typeof entry.filename).toBe('function');
      }
    }
  });

  it('resolves a known format, case-insensitively', () => {
    expect(resolveExport(CLASSROOM_TERM_EXPORTS, 'CSV', 'csv').id).toBe('csv');
    expect(resolveExport(CLASSROOM_REGISTER_EXPORTS, 'register', 'register').id).toBe('register');
  });

  it('falls back when no format is given, so the shipped URL keeps working', () => {
    expect(resolveExport(CLASSROOM_TERM_EXPORTS, undefined, 'csv').id).toBe('csv');
  });

  it('rejects an unknown format by NAMING the valid ones — that is how a client discovers them', () => {
    expect(() => resolveExport(CLASSROOM_TERM_EXPORTS, 'pdf', 'csv')).toThrow(
      /Unknown export format 'pdf'. Valid formats: 'csv'./,
    );
  });

  it('the two registries are separate, so a formatter cannot be pointed at the wrong read', () => {
    expect(CLASSROOM_TERM_EXPORTS.register).toBeUndefined();
    expect(CLASSROOM_REGISTER_EXPORTS.csv).toBeUndefined();
  });
});
