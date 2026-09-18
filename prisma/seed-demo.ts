/**
 * DEMO SEED — stakeholder-ready dataset for Phase 1 review.
 *
 * Run with:  npm run seed:demo
 *
 * This is deliberately SEPARATE from `prisma/seed.ts` (the bootstrap seed,
 * which owns permissions, roles, school settings, document sequences and the
 * Super Admin, and stays safe to re-run). This script:
 *
 *   1. WIPES all domain data — enrollments, student-guardian links,
 *      admissions, files, classrooms, terms, academic years, levels,
 *      students, guardians, and all staff EXCEPT the Super Admin (STF-0001).
 *   2. Renames the school to its demo identity and rebuilds a realistic
 *      Ghanaian school dataset in its place.
 *   3. Resets the student/staff/admission document sequences so the next
 *      manually generated number continues from the seeded records.
 *
 * It is idempotent: re-run it any time to restore the demo to this known
 * state (e.g. after stakeholders have clicked around, or after a QA run).
 *
 * ⚠️  AUDIT LOGS ARE LEFT ALONE — DO NOT "FIX" THIS.
 * The audit_logs table carries an immutability trigger
 * (prevent_audit_log_changes) that rejects UPDATE and DELETE. Entries from
 * earlier testing therefore remain, including some that reference rows this
 * script deletes. That is the intended cost of an immutable trail and is
 * evidence the compliance story works — do not drop the trigger or truncate
 * the table to make the log "clean".
 */
import {
  PrismaClient,
  DocumentSequenceType,
  AttendanceStatus,
  LabelCategory,
  FeePaymentMethod,
  InvoiceStatus,
  NotificationStatus,
  NotificationTrigger,
  Prisma,
} from '@prisma/client';

const prisma = new PrismaClient();

const D = (iso: string) => new Date(iso);

async function main() {
  console.log('Demo seed starting…');

  // ── anchors from the bootstrap seed ────────────────────────────────────────
  const school = await prisma.school.findFirst({
    where: { slug: { in: ['adom-international-school', 'demo-ghana-private-school'] } },
  });
  if (!school) throw new Error('No school found — run `npm run prisma:seed` first.');
  const schoolId = school.id;

  const superAdminUser = await prisma.user.findFirst({
    where: { schoolId, email: process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@example.com' },
  });
  const actor = superAdminUser?.id ?? null;

  // ── 1. wipe domain data (FK order; audit_logs untouched by design) ─────────
  console.log('Wiping domain data…');
  // Notifications reference guardians and students, so they go before both.
  await prisma.notificationMessage.deleteMany({ where: { schoolId } });
  // Finance first, innermost outward: invoice_lines → invoices →
  // fee_payments → fee_assignments → school_fees → fee_types. Invoices and
  // assignments both FK enrollments, so all of it precedes the enrollment
  // wipe below.
  await prisma.invoiceLine.deleteMany({ where: { schoolId } });
  await prisma.invoice.deleteMany({ where: { schoolId } });
  await prisma.feePayment.deleteMany({ where: { schoolId } });
  await prisma.feeAssignment.deleteMany({ where: { schoolId } });
  await prisma.schoolFee.deleteMany({ where: { schoolId } });
  await prisma.feeType.deleteMany({ where: { schoolId } });
  // Attendance: attendance_records.enrollment_id FKs enrollments.
  await prisma.attendanceRecord.deleteMany({ where: { schoolId } });
  // Labels last of the Phase 2 wipe — fee_types.label_id FKs labels.
  await prisma.label.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.studentGuardian.deleteMany({ where: { schoolId } });
  await prisma.admissionApplication.deleteMany({ where: { schoolId } });
  await prisma.file.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
  await prisma.term.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.level.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.guardian.deleteMany({ where: { schoolId } });
  await prisma.staff.deleteMany({ where: { schoolId, staffNumber: { not: 'STF-0001' } } });

  // ── 2. school identity ─────────────────────────────────────────────────────
  console.log('Setting school identity…');
  await prisma.school.update({
    where: { id: schoolId },
    data: {
      name: 'Adom International School',
      slug: 'adom-international-school',
      address: '12 Aburi Road, Adenta, Accra',
      ghanaPostGps: 'GD-185-4290',
      phone: '0302912345',
      email: 'info@adominternational.edu.gh',
      motto: 'Knowledge · Diligence · Integrity',
      registrationNumber: 'GES/GA/ADE/0173',
      isActive: true,
      updatedBy: actor,
    },
  });

  // ── 3. academic calendar — ANCHORED TO THE SEED RUN, NOT HARDCODED ────────
  //
  // Every academic date below is derived from TODAY. This is not tidiness: a
  // hardcoded calendar goes stale, and when the active term's end date slips
  // into the past the attendance register opens to "No term … covers
  // <today>" and the whole module demos as broken. Re-running this seed must
  // always produce a usable demo, whenever it is run.
  //
  // The anchor is: **today always falls inside the ACTIVE term**, with ~10
  // weeks of markable history behind it and ~6 weeks ahead. Terms are ~13
  // weeks with ~4-week holidays between, which is the Ghanaian basic/JHS
  // shape. Term 3 of the current year is the active one, so the active
  // academic year always also contains two CLOSED terms — several checks
  // (and the QA pass) rely on a closed term existing inside the active year.
  //
  // What this deliberately does NOT do is align terms to the real
  // September–August calendar. Doing that would make the active term depend
  // on the month the seed happens to run in — and in September the active
  // term would be Term 1, leaving the active year with no closed term at all.
  // Plausible dates are worth less than a demo that always works.
  const TODAY = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const days = (from: Date, n: number) => new Date(from.getTime() + n * 86_400_000);
  const yearLabel = (start: Date) =>
    `${start.getUTCFullYear()}/${start.getUTCFullYear() + 1}`;

  // The active term straddles today.
  const t3Start = days(TODAY, -70);
  const t3End = days(TODAY, 42);
  // The two closed terms before it.
  const t2End = days(t3Start, -28);
  const t2Start = days(t2End, -91);
  const t1End = days(t2Start, -28);
  const t1Start = days(t1End, -91);
  // The tail of the previous academic year.
  const prevT3End = days(t1Start, -28);
  const prevT3Start = days(prevT3End, -91);
  // Next year's first two terms, still being planned.
  const nextT1Start = days(t3End, 28);
  const nextT1End = days(nextT1Start, 91);
  const nextT2Start = days(nextT1End, 28);
  const nextT2End = days(nextT2Start, 91);

  // Year ranges are ~372 days apart, which is what guarantees the three
  // derived labels always land in three different calendar years and so stay
  // unique (academic_years has @@unique([schoolId, label])).
  const prevYearStart = days(t1Start, -372);
  const currentYearStart = days(t1Start, -7);
  const nextYearStart = days(t3End, 15);

  console.log('Seeding academic years and terms…');
  const yPrev = await prisma.academicYear.create({
    data: {
      schoolId, label: yearLabel(prevYearStart), isActive: false,
      startDate: prevYearStart, endDate: days(t1Start, -8), createdBy: actor,
    },
  });
  const yCurrent = await prisma.academicYear.create({
    data: {
      schoolId, label: yearLabel(currentYearStart), isActive: true,
      startDate: currentYearStart, endDate: days(t3End, 14), createdBy: actor,
    },
  });
  const yNext = await prisma.academicYear.create({
    data: {
      schoolId, label: yearLabel(nextYearStart), isActive: false,
      startDate: nextYearStart, endDate: days(nextT2End, 30), createdBy: actor,
    },
  });

  // ── terms (constraint: only ONE active term per school) ────────────────────
  // Exams sit in the last fortnight of each term.
  const examWindow = (end: Date) => ({ xs: days(end, -18), xe: days(end, -7) });
  const termRows = [
    { y: yPrev.id, n: 3, label: 'Term 3', s: prevT3Start, e: prevT3End, status: 'closed' },
    { y: yCurrent.id, n: 1, label: 'Term 1', s: t1Start, e: t1End, status: 'closed', ...examWindow(t1End) },
    { y: yCurrent.id, n: 2, label: 'Term 2', s: t2Start, e: t2End, status: 'closed', ...examWindow(t2End) },
    { y: yCurrent.id, n: 3, label: 'Term 3', s: t3Start, e: t3End, status: 'active', ...examWindow(t3End) },
    // NOTE: the backend TermStatus enum is draft|active|closed only — the
    // frontend's 'pending' badge has no backend counterpart, so 'draft' is
    // the only pre-active state that can exist in data.
    { y: yNext.id, n: 1, label: 'Term 1', s: nextT1Start, e: nextT1End, status: 'draft' },
    { y: yNext.id, n: 2, label: 'Term 2', s: nextT2Start, e: nextT2End, status: 'draft' },
  ] as const;
  for (const t of termRows) {
    await prisma.term.create({
      data: {
        schoolId, academicYearId: t.y, termNumber: t.n, label: t.label,
        startDate: t.s, endDate: t.e, status: t.status as any,
        examStartDate: 'xs' in t ? t.xs : null,
        examEndDate: 'xe' in t ? t.xe : null,
        curriculumScope: 'BOTH', createdBy: actor,
      },
    });
  }

  // ── 4. levels: full Crèche → JHS 3 range ───────────────────────────────────
  console.log('Seeding levels…');
  const LEVELS = [
    { name: 'Crèche', group: 'CRECHE', ges: 'Crèche', abeka: 'Nursery' },
    { name: 'Nursery 1', group: 'NURSERY', ges: 'Nursery 1', abeka: 'K3' },
    { name: 'Nursery 2', group: 'NURSERY', ges: 'Nursery 2', abeka: 'K4' },
    { name: 'KG 1', group: 'KG', ges: 'KG 1', abeka: 'K5' },
    { name: 'KG 2', group: 'KG', ges: 'KG 2', abeka: 'K5 Advanced' },
    { name: 'Basic 1', group: 'LOWER_PRIMARY', ges: 'Basic 1', abeka: 'Grade 1' },
    { name: 'Basic 2', group: 'LOWER_PRIMARY', ges: 'Basic 2', abeka: 'Grade 2' },
    { name: 'Basic 3', group: 'LOWER_PRIMARY', ges: 'Basic 3', abeka: 'Grade 3' },
    { name: 'Basic 4', group: 'UPPER_PRIMARY', ges: 'Basic 4', abeka: 'Grade 4' },
    { name: 'Basic 5', group: 'UPPER_PRIMARY', ges: 'Basic 5', abeka: 'Grade 5' },
    { name: 'Basic 6', group: 'UPPER_PRIMARY', ges: 'Basic 6', abeka: 'Grade 6' },
    { name: 'JHS 1', group: 'JHS', ges: 'JHS 1', abeka: 'Grade 7' },
    { name: 'JHS 2', group: 'JHS', ges: 'JHS 2', abeka: 'Grade 8' },
    { name: 'JHS 3', group: 'JHS', ges: 'JHS 3', abeka: 'Grade 9' },
  ];
  const levelByName: Record<string, string> = {};
  for (let i = 0; i < LEVELS.length; i++) {
    const l = LEVELS[i];
    const row = await prisma.level.create({
      data: {
        schoolId, name: l.name, levelGroup: l.group as any, orderIndex: i + 1,
        gesDesignation: l.ges, abekaDesignation: l.abeka, createdBy: actor,
      },
    });
    levelByName[l.name] = row.id;
  }

  // ── 5. staff (Super Admin STF-0001 already exists and is preserved) ────────
  console.log('Seeding staff…');
  const STAFF = [
    { no: 'STF-0002', fn: 'Grace', ln: 'Owusu-Ansah', role: 'admin', ntc: 'licensed', ntcNo: 'NTC/GA/2015/04412', phone: '0244631207', email: 'g.owusuansah@adominternational.edu.gh', joined: '2019-09-02', emp: 'full_time' }, // head teacher
    { no: 'STF-0003', fn: 'Yaw', ln: 'Darko', role: 'admin', ntc: 'not_applicable', phone: '0209917553', email: 'y.darko@adominternational.edu.gh', joined: '2021-01-11', emp: 'full_time' }, // bursar
    { no: 'STF-0004', fn: 'Efua', ln: 'Asantewaa', role: 'admin', ntc: 'not_applicable', phone: '0554208916', email: 'e.asantewaa@adominternational.edu.gh', joined: '2022-05-03', emp: 'full_time' }, // admissions
    { no: 'STF-0005', fn: 'Kwabena', ln: 'Mensah', role: 'teacher', ntc: 'licensed', ntcNo: 'NTC/GA/2018/11207', phone: '0245118834', email: 'k.mensah@adominternational.edu.gh', joined: '2020-09-07', emp: 'full_time' },
    { no: 'STF-0006', fn: 'Adjoa', ln: 'Frimpong', role: 'teacher', ntc: 'licensed', ntcNo: 'NTC/GA/2016/07731', phone: '0261440592', email: 'a.frimpong@adominternational.edu.gh', joined: '2018-09-03', emp: 'full_time' },
    { no: 'STF-0007', fn: 'Samuel', ln: 'Tetteh', role: 'teacher', ntc: 'induction', phone: '0277903318', email: 's.tetteh@adominternational.edu.gh', joined: '2024-09-09', emp: 'full_time' },
    { no: 'STF-0008', fn: 'Abena', ln: 'Sarpong', role: 'teacher', ntc: 'licensed', ntcNo: 'NTC/GA/2014/02218', phone: '0243556671', email: 'a.sarpong@adominternational.edu.gh', joined: '2017-01-09', emp: 'full_time' },
    { no: 'STF-0009', fn: 'Daniel', ln: 'Quaye', role: 'teacher', ntc: 'unlicensed', phone: '0508112474', email: 'd.quaye@adominternational.edu.gh', joined: '2025-01-06', emp: 'part_time' },
    { no: 'STF-0010', fn: 'Comfort', ln: 'Boadu', role: 'teacher', ntc: 'licensed', ntcNo: 'NTC/GA/2019/14403', phone: '0244772180', email: 'c.boadu@adominternational.edu.gh', joined: '2021-09-06', emp: 'full_time' },
    { no: 'STF-0011', fn: 'Isaac', ln: 'Antwi', role: 'support', ntc: 'not_applicable', phone: '0246005839', joined: '2020-02-03', emp: 'contract' }, // facilities
  ];
  const staffByNo: Record<string, string> = {};
  for (const s of STAFF) {
    const row = await prisma.staff.create({
      data: {
        schoolId, staffNumber: s.no, firstName: s.fn, lastName: s.ln,
        phone: s.phone, email: (s as any).email ?? null,
        roleCategory: s.role as any, employmentType: s.emp as any,
        ntcStatus: s.ntc as any, ntcRegistrationNumber: (s as any).ntcNo ?? null,
        joinedAt: D(s.joined), status: 'active', createdBy: actor,
      },
    });
    staffByNo[s.no] = row.id;
  }

  // ── 6. classrooms for the active year, each with a class teacher ──────────
  console.log('Seeding classrooms…');
  const CLASSROOMS = [
    { level: 'KG 2', section: 'A', name: 'KG 2A', cap: 22, teacher: 'STF-0006' },
    { level: 'Basic 1', section: 'A', name: 'Basic 1A', cap: 28, teacher: 'STF-0007' },
    { level: 'Basic 3', section: 'A', name: 'Basic 3A', cap: 30, teacher: 'STF-0005' },
    { level: 'Basic 3', section: 'B', name: 'Basic 3B', cap: 30, teacher: 'STF-0010' },
    { level: 'Basic 6', section: 'A', name: 'Basic 6A', cap: 32, teacher: 'STF-0008' },
    { level: 'JHS 1', section: 'A', name: 'JHS 1A', cap: 35, teacher: 'STF-0009' },
  ];
  const classByName: Record<string, string> = {};
  for (const c of CLASSROOMS) {
    const row = await prisma.classroom.create({
      data: {
        schoolId, levelId: levelByName[c.level], academicYearId: yCurrent.id,
        sectionLabel: c.section, displayName: c.name, capacity: c.cap,
        classTeacherId: staffByNo[c.teacher], createdBy: actor,
      },
    });
    classByName[c.name] = row.id;
  }

  // ── 7. students ────────────────────────────────────────────────────────────
  // 19 total: 16 active+enrolled, 1 active+unenrolled (fresh admit, linked to
  // the Offered admission so the Enroll demo actually works against the
  // one-active-enrollment-per-year rule), 1 withdrawn, 1 archived.
  console.log('Seeding students…');
  type Stu = {
    no: string; fn: string; mn?: string; ln: string; dob: string;
    g: 'male' | 'female'; cls?: string; track?: 'GES_NACCA' | 'ABEKA';
    status?: 'withdrawn'; archived?: boolean; religion?: string;
  };
  const STUDENTS: Stu[] = [
    // KG 2A (born ~2020/21) — GES track
    { no: 'STU-0001', fn: 'Ama', mn: 'Serwaa', ln: 'Boakye', dob: '2020-11-03', g: 'female', cls: 'KG 2A', track: 'GES_NACCA' },
    { no: 'STU-0002', fn: 'Kojo', mn: 'Nkrumah', ln: 'Appiah', dob: '2021-02-17', g: 'male', cls: 'KG 2A', track: 'GES_NACCA' },
    { no: 'STU-0003', fn: 'Akosua', mn: 'Dufie', ln: 'Nartey', dob: '2020-08-25', g: 'female', cls: 'KG 2A', track: 'ABEKA' },
    // Basic 1A (born ~2019)
    { no: 'STU-0004', fn: 'Kwame', mn: 'Ofori', ln: 'Atta', dob: '2019-04-12', g: 'male', cls: 'Basic 1A', track: 'GES_NACCA' },
    { no: 'STU-0005', fn: 'Adwoa', mn: 'Konadu', ln: 'Bediako', dob: '2019-07-30', g: 'female', cls: 'Basic 1A', track: 'GES_NACCA' },
    { no: 'STU-0006', fn: 'Yaw', ln: 'Agyeman', dob: '2019-01-22', g: 'male', cls: 'Basic 1A', track: 'ABEKA' },
    // Basic 3A (born ~2017)
    { no: 'STU-0007', fn: 'Abena', mn: 'Nyarko', ln: 'Osei', dob: '2017-05-19', g: 'female', cls: 'Basic 3A', track: 'GES_NACCA', religion: 'Christian' },
    { no: 'STU-0008', fn: 'Kofi', mn: 'Asamoah', ln: 'Boateng', dob: '2017-09-02', g: 'male', cls: 'Basic 3A', track: 'GES_NACCA' },
    { no: 'STU-0009', fn: 'Kwabena', ln: 'Boakye', dob: '2017-03-14', g: 'male', cls: 'Basic 3A', track: 'GES_NACCA' }, // Ama's brother
    // Basic 3B (born ~2017)
    { no: 'STU-0010', fn: 'Nana', mn: 'Yaa', ln: 'Asare', dob: '2017-06-08', g: 'female', cls: 'Basic 3B', track: 'ABEKA' },
    { no: 'STU-0011', fn: 'Kwesi', mn: 'Danquah', ln: 'Mills', dob: '2017-12-01', g: 'male', cls: 'Basic 3B', track: 'ABEKA' },
    { no: 'STU-0012', fn: 'Esi', ln: 'Ankrah', dob: '2017-10-27', g: 'female', cls: 'Basic 3B', track: 'ABEKA', religion: 'Muslim' },
    // Basic 6A (born ~2014)
    { no: 'STU-0013', fn: 'Kwaku', mn: 'Addo', ln: 'Gyasi', dob: '2014-02-09', g: 'male', cls: 'Basic 6A', track: 'GES_NACCA' },
    { no: 'STU-0014', fn: 'Ohemaa', mn: 'Adoma', ln: 'Agyapong', dob: '2014-08-15', g: 'female', cls: 'Basic 6A', track: 'ABEKA' },
    // JHS 1A (born ~2013)
    { no: 'STU-0015', fn: 'Maame', mn: 'Efua', ln: 'Ankrah', dob: '2013-04-03', g: 'female', cls: 'JHS 1A', track: 'GES_NACCA' }, // Esi's sister
    { no: 'STU-0016', fn: 'Kobby', mn: 'Otchere', ln: 'Lamptey', dob: '2013-09-21', g: 'male', cls: 'JHS 1A', track: 'GES_NACCA' },
    // Withdrawn mid-year (family relocated)
    { no: 'STU-0017', fn: 'Fiifi', mn: 'Arthur', ln: 'Quainoo', dob: '2014-05-11', g: 'male', cls: 'Basic 6A', track: 'GES_NACCA', status: 'withdrawn' },
    // Archived (left the school; record archived)
    { no: 'STU-0018', fn: 'Adjoa', mn: 'Nsiah', ln: 'Oduro', dob: '2013-11-30', g: 'female', cls: 'JHS 1A', track: 'ABEKA', archived: true },
    // Fresh admit — active, NOT enrolled; linked to the Offered admission
    { no: 'STU-0019', fn: 'Araba', ln: 'Fynn', dob: '2017-08-06', g: 'female' },
  ];
  const stuByNo: Record<string, string> = {};
  for (const s of STUDENTS) {
    const row = await prisma.student.create({
      data: {
        schoolId, studentNumber: s.no, firstName: s.fn, middleName: s.mn ?? null,
        lastName: s.ln, dateOfBirth: D(s.dob), gender: s.g,
        nationality: 'Ghanaian', religion: s.religion ?? null,
        admissionDate: s.no === 'STU-0019' ? null : t1Start,
        status: s.archived || s.status === 'withdrawn' ? 'withdrawn' : 'active',
        archivedAt: s.archived ? new Date() : null,
        createdBy: actor,
      },
    });
    stuByNo[s.no] = row.id;
  }

  // ── 8. enrollments: 16 active + 2 withdrawn, across both tracks ───────────
  console.log('Seeding enrollments…');
  for (const s of STUDENTS) {
    if (!s.cls) continue;
    const withdrawn = s.status === 'withdrawn' || s.archived;
    await prisma.enrollment.create({
      data: {
        schoolId, studentId: stuByNo[s.no], classroomId: classByName[s.cls],
        academicYearId: yCurrent.id, curriculumTrack: s.track as any,
        enrollmentDate: t1Start,
        status: withdrawn ? 'withdrawn' : 'active',
        // Mid-year exit, inside the (now closed) Term 2.
        exitDate: withdrawn ? days(t2End, -7) : null,
        exitReason: s.status === 'withdrawn'
          ? 'Family relocated to Kumasi'
          : s.archived ? 'Transferred to another school' : null,
        createdBy: actor,
      },
    });
  }

  // ── 9. guardians and links ────────────────────────────────────────────────
  // 14 guardians, 18 links. Two sibling pairs (Boakye, Ankrah) share both
  // parents; every linked student has exactly one primary guardian.
  console.log('Seeding guardians…');
  type G = { fn: string; ln: string; phone: string; phone2?: string; email?: string; occ?: string; addr?: string };
  const GUARDIANS: G[] = [
    { fn: 'Samuel', ln: 'Boakye', phone: '0244810335', email: 'sk.boakye@gmail.com', occ: 'Civil engineer', addr: 'Adenta Housing Down, Accra' },      // 0 — Ama + Kwabena
    { fn: 'Georgina', ln: 'Boakye', phone: '0208133467', occ: 'Trader, Madina Market', addr: 'Adenta Housing Down, Accra' },                            // 1 — Ama + Kwabena
    { fn: 'Ibrahim', ln: 'Ankrah', phone: '0277015944', occ: 'Driver', addr: 'Ashaley Botwe, Accra' },                                                   // 2 — Esi + Maame
    { fn: 'Fatima', ln: 'Ankrah', phone: '0554761208', occ: 'Seamstress', addr: 'Ashaley Botwe, Accra' },                                                // 3 — Esi + Maame
    { fn: 'Peter', ln: 'Appiah', phone: '0243397520', email: 'peter.appiah@outlook.com', occ: 'Bank officer', addr: 'East Legon Hills, Accra' },        // 4 — Kojo
    { fn: 'Mercy', ln: 'Nartey', phone: '0269984012', occ: 'Nurse, Legon Hospital', addr: 'Haatso, Accra' },                                            // 5 — Akosua
    { fn: 'Daniel', ln: 'Atta', phone: '0501277396', occ: 'IT consultant', addr: 'Oyibi, Accra' },                                                       // 6 — Kwame
    { fn: 'Vida', ln: 'Bediako', phone: '0246650118', occ: 'Caterer', addr: 'Adenta Commandos, Accra' },                                                 // 7 — Adwoa
    { fn: 'Joseph', ln: 'Agyeman', phone: '0209448723', occ: 'Pharmacist', addr: 'Frafraha, Accra' },                                                    // 8 — Yaw
    { fn: 'Comfort', ln: 'Osei', phone: '0244066391', occ: 'Teacher', addr: 'Adenta SSNIT Flats, Accra' },                                               // 9 — Abena
    { fn: 'Eric', ln: 'Boateng', phone: '0277684250', occ: 'Mechanic', addr: 'Amrahia, Accra' },                                                         // 10 — Kofi
    { fn: 'Gifty', ln: 'Asare', phone: '0554109637', occ: 'Hairdresser', addr: 'Ogbojo, Accra' },                                                        // 11 — Nana Yaa
    { fn: 'Kingsley', ln: 'Gyasi', phone: '0243881164', email: 'kgyasi@yahoo.com', occ: 'Surveyor', addr: 'Adenta Barrier, Accra' },                     // 12 — Kwaku
    { fn: 'Josephine', ln: 'Fynn', phone: '0208546772', occ: 'Banker', addr: 'Ashiyie, Accra' },                                                         // 13 — Araba
  ];
  const gIds: string[] = [];
  for (const g of GUARDIANS) {
    const row = await prisma.guardian.create({
      data: {
        schoolId, firstName: g.fn, lastName: g.ln, phonePrimary: g.phone,
        phoneSecondary: g.phone2 ?? null, email: g.email ?? null,
        occupation: g.occ ?? null, address: g.addr ?? null, createdBy: actor,
      },
    });
    gIds.push(row.id);
  }

  const LINKS: Array<{ stu: string; g: number; rel: string; primary?: boolean; emergency?: boolean; sms?: boolean }> = [
    { stu: 'STU-0001', g: 0, rel: 'father', primary: true, emergency: true },
    { stu: 'STU-0001', g: 1, rel: 'mother', sms: true },
    { stu: 'STU-0009', g: 0, rel: 'father', primary: true, emergency: true },
    { stu: 'STU-0009', g: 1, rel: 'mother', sms: true },
    { stu: 'STU-0012', g: 2, rel: 'father', primary: true },
    { stu: 'STU-0012', g: 3, rel: 'mother', emergency: true, sms: true },
    { stu: 'STU-0015', g: 2, rel: 'father', primary: true },
    { stu: 'STU-0015', g: 3, rel: 'mother', emergency: true, sms: true },
    { stu: 'STU-0002', g: 4, rel: 'father', primary: true },
    { stu: 'STU-0003', g: 5, rel: 'mother', primary: true, emergency: true },
    { stu: 'STU-0004', g: 6, rel: 'father', primary: true },
    { stu: 'STU-0005', g: 7, rel: 'mother', primary: true, sms: true },
    { stu: 'STU-0006', g: 8, rel: 'father', primary: true },
    { stu: 'STU-0007', g: 9, rel: 'mother', primary: true, emergency: true },
    { stu: 'STU-0008', g: 10, rel: 'father', primary: true },
    { stu: 'STU-0010', g: 11, rel: 'mother', primary: true, sms: true },
    { stu: 'STU-0013', g: 12, rel: 'father', primary: true },
    { stu: 'STU-0019', g: 13, rel: 'mother', primary: true, emergency: true },
  ];
  for (const l of LINKS) {
    await prisma.studentGuardian.create({
      data: {
        schoolId, studentId: stuByNo[l.stu], guardianId: gIds[l.g],
        relationship: l.rel, isPrimary: l.primary ?? false,
        isEmergencyContact: l.emergency ?? false,
        canReceiveSms: l.sms ?? true, canAccessPortal: true, createdBy: actor,
      },
    });
  }

  // ── 10. admissions — every status in the pipeline ─────────────────────────
  console.log('Seeding admissions…');
  const headId = staffByNo['STF-0002'];
  const admissions: Array<Parameters<typeof prisma.admissionApplication.create>[0]['data']> = [
    { schoolId, status: 'enquiry', admissionNumber: 'ADM-0006', intendedLevelId: levelByName['KG 1'], curriculumInterest: 'BOTH', enquirySource: 'walk_in', applicationDate: days(TODAY, -42), notes: 'Mother visited during open day; will decide after Term 3 results.', createdBy: actor },
    { schoolId, status: 'enquiry', admissionNumber: 'ADM-0007', intendedLevelId: levelByName['Nursery 2'], curriculumInterest: 'GES_NACCA', enquirySource: 'advertisement', applicationDate: days(TODAY, -33), notes: 'Responded to the Citi FM back-to-school spot. Requested a fee schedule.', createdBy: actor },
    { schoolId, status: 'application', admissionNumber: 'ADM-0005', intendedLevelId: levelByName['Basic 2'], curriculumInterest: 'ABEKA', enquirySource: 'referral', applicationDate: days(TODAY, -55), notes: 'Referred by the Boakye family. Forms submitted; awaiting previous school report.', createdBy: actor },
    { schoolId, status: 'offered', admissionNumber: 'ADM-0004', studentId: stuByNo['STU-0019'], intendedLevelId: levelByName['Basic 3'], curriculumInterest: 'GES_NACCA', enquirySource: 'website', applicationDate: days(TODAY, -70), offeredAt: days(TODAY, -49), approvedBy: headId, approvedAt: days(TODAY, -49), notes: 'Assessment completed 18 July — strong numeracy. Offer letter sent to mother.', createdBy: actor },
    { schoolId, status: 'enrolled', admissionNumber: 'ADM-0001', studentId: stuByNo['STU-0004'], intendedLevelId: levelByName['Basic 1'], curriculumInterest: 'GES_NACCA', enquirySource: 'walk_in', applicationDate: days(t1Start, -35), offeredAt: days(t1Start, -21), approvedBy: headId, approvedAt: days(t1Start, -21), enrolledAt: t1Start, notes: `Enrolled at the start of ${yearLabel(currentYearStart)}.`, createdBy: actor },
    { schoolId, status: 'withdrawn', admissionNumber: 'ADM-0003', intendedLevelId: levelByName['KG 1'], curriculumInterest: 'ABEKA', enquirySource: 'referral', applicationDate: days(TODAY, -90), notes: 'Family accepted a place at another school after the assessment.', createdBy: actor },
    { schoolId, status: 'rejected', admissionNumber: 'ADM-0002', intendedLevelId: levelByName['JHS 2'], curriculumInterest: 'BOTH', enquirySource: 'social_media', applicationDate: days(TODAY, -120), notes: `JHS 2 stream full for ${yearLabel(nextYearStart)}; family advised to reapply for JHS 1 sibling intake.`, createdBy: actor },
  ];
  for (const a of admissions) await prisma.admissionApplication.create({ data: a });

  // ── 11. file metadata records ─────────────────────────────────────────────
  console.log('Seeding file records…');
  const bucket = process.env.S3_BUCKET || 'ghana-sms-dev';
  const files = [
    { ownerType: 'student', ownerId: stuByNo['STU-0001'], category: 'birth_certificate', name: 'ama_boakye_birth_certificate.pdf', mime: 'application/pdf', size: 182_044 },
    { ownerType: 'student', ownerId: stuByNo['STU-0008'], category: 'photo', name: 'kofi_boateng_passport_photo.jpg', mime: 'image/jpeg', size: 96_310 },
    { ownerType: 'student', ownerId: stuByNo['STU-0013'], category: 'report_card', name: 'kwaku_gyasi_term2_2026_report.pdf', mime: 'application/pdf', size: 240_598 },
    { ownerType: 'admission', ownerId: null as string | null, category: 'offer_letter', name: 'araba_fynn_offer_letter.pdf', mime: 'application/pdf', size: 121_776 },
  ];
  // attach the offer letter to the Offered admission
  const offered = await prisma.admissionApplication.findFirst({ where: { schoolId, status: 'offered' } });
  files[3].ownerId = offered?.id ?? null;
  for (const f of files) {
    await prisma.file.create({
      data: {
        schoolId, ownerType: f.ownerType as any, ownerId: f.ownerId,
        category: f.category, originalFileName: f.name, mimeType: f.mime,
        sizeBytes: BigInt(f.size), storageBucket: bucket,
        storageKey: `${f.ownerType}s/${f.ownerId ?? 'unassigned'}/${f.name}`,
        isPublic: false, uploadedBy: actor, createdBy: actor,
      },
    });
  }

  // ── 12. labels (Phase 2 Stage 1a) ─────────────────────────────────────────
  // Only `fee` labels have a consumer today (fee types, when fees land). The
  // income and expenditure rows exist to demonstrate the thing the benchmarked
  // product got wrong: uniqueness is scoped PER CATEGORY, so "Transport" is
  // legitimately both an income heading and an expenditure heading. Seeding
  // that collision on purpose means the screen shows it working.
  console.log('Seeding labels…');
  const LABELS: Array<{ category: LabelCategory; name: string; description: string }> = [
    { category: LabelCategory.fee, name: 'Tuition', description: 'Termly tuition charges' },
    { category: LabelCategory.fee, name: 'Boarding', description: 'Boarding and feeding charges' },
    { category: LabelCategory.fee, name: 'Transport', description: 'School bus charges' },
    { category: LabelCategory.income, name: 'Transport', description: 'Bus hire to third parties' },
    { category: LabelCategory.income, name: 'Donations', description: 'Gifts and PTA contributions' },
    { category: LabelCategory.expenditure, name: 'Transport', description: 'Fuel, servicing and driver pay' },
    { category: LabelCategory.expenditure, name: 'Salaries', description: 'Staff salaries and allowances' },
    { category: LabelCategory.expenditure, name: 'Utilities', description: 'Electricity, water and internet' },
  ];
  for (const label of LABELS) {
    await prisma.label.create({
      data: {
        schoolId,
        category: label.category,
        name: label.name,
        description: label.description,
        createdBy: actor,
        updatedBy: actor,
      },
    });
  }
  // One archived label, so "Show archived" and Restore have something to act on.
  await prisma.label.create({
    data: {
      schoolId,
      category: LabelCategory.fee,
      name: 'Excursion',
      description: `Retired after the ${yearLabel(prevYearStart)} year`,
      isActive: false,
      createdBy: actor,
      updatedBy: actor,
    },
  });

  // ── 13. attendance registers (Phase 2 Stage 1a) ───────────────────────────
  // A fortnight of weekday registers across every classroom, hitting all four
  // statuses, so the register and the term summary do not demo empty.
  //
  // Dates run backwards from TODAY, which the calendar above guarantees sits
  // inside the ACTIVE term with ~10 weeks of history behind it. That is what
  // the marking rules require: the service refuses future dates and refuses
  // any term that is not active (or closed-and-reopened).
  console.log('Seeding attendance…');
  // Ends today — inside the active term, and the latest date the service
  // will accept (it refuses future dates).
  const REGISTER_END = TODAY;
  const attendanceDates: Date[] = [];
  for (let back = 0; attendanceDates.length < 10; back++) {
    const day = new Date(REGISTER_END);
    day.setUTCDate(day.getUTCDate() - back);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) attendanceDates.push(day);
  }
  attendanceDates.reverse();

  const activeEnrollments = await prisma.enrollment.findMany({
    where: { schoolId, status: 'active' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  // Deterministic spread rather than Math.random, so re-running the demo seed
  // produces the same figures and a screenshot stays valid.
  const STATUS_CYCLE: AttendanceStatus[] = [
    AttendanceStatus.present, AttendanceStatus.present, AttendanceStatus.present,
    AttendanceStatus.present, AttendanceStatus.late,    AttendanceStatus.present,
    AttendanceStatus.absent,  AttendanceStatus.present, AttendanceStatus.excused,
    AttendanceStatus.present, AttendanceStatus.present, AttendanceStatus.late,
    AttendanceStatus.present,
  ];
  const REASONS: Partial<Record<AttendanceStatus, string>> = {
    [AttendanceStatus.excused]: 'Parent sent a note — medical appointment',
    [AttendanceStatus.absent]: 'No word from home',
    [AttendanceStatus.late]: 'Arrived after assembly',
  };

  // A demo where every afternoon mirrored its morning would show `daysPartial`
  // as zero everywhere and hide the one number Part B exists to surface. These
  // are the deliberate divergences: a different prime stride from the morning
  // cycle, applied to roughly one day in seven, so the mix is varied but
  // reproducible — re-running the seed gives the same figures and a screenshot
  // stays valid.
  const PM_DIVERGENCE: { every: number; status: AttendanceStatus; reason: string }[] = [
    {
      every: 7,
      status: AttendanceStatus.absent,
      reason: 'Went home after lunch — collected by an aunt',
    },
    {
      every: 11,
      status: AttendanceStatus.excused,
      reason: 'Left at midday for a clinic appointment',
    },
    {
      every: 13,
      status: AttendanceStatus.present,
      reason: null as unknown as string,
    },
  ];

  let attendanceRows = 0;
  let partialDays = 0;
  for (const [dayIndex, day] of attendanceDates.entries()) {
    for (const [studentIndex, enrollment] of activeEnrollments.entries()) {
      // One student on one day is left unmarked, so the register shows a
      // genuine "not marked" row — the absence of a record, not a status.
      if (dayIndex === attendanceDates.length - 1 && studentIndex === 0) continue;

      const seed = dayIndex * 5 + studentIndex * 3;
      const morningStatus = STATUS_CYCLE[seed % STATUS_CYCLE.length];

      // Default: the afternoon mirrors the morning, which is what the API does
      // when a caller omits it and what a mornings-only class would record.
      let afternoonStatus = morningStatus;
      let afternoonReason: string | null = REASONS[morningStatus] ?? null;

      for (const rule of PM_DIVERGENCE) {
        if (seed % rule.every === 0 && rule.status !== morningStatus) {
          afternoonStatus = rule.status;
          afternoonReason = rule.reason ?? null;
          break;
        }
      }

      const present = (status: AttendanceStatus) =>
        status === AttendanceStatus.present || status === AttendanceStatus.late;
      const isPartial = present(morningStatus) !== present(afternoonStatus);
      if (isPartial) partialDays++;

      await prisma.attendanceRecord.create({
        data: {
          schoolId,
          enrollmentId: enrollment.id,
          attendanceDate: day,
          morningStatus,
          morningReason: REASONS[morningStatus] ?? null,
          afternoonStatus,
          afternoonReason,
          createdBy: actor,
          updatedBy: actor,
        },
      });
      attendanceRows++;
    }
  }

  // ── 14. fees, payments and invoices (Phase 2 Stage 1b) ────────────────────
  //
  // Everything here hangs off the ACTIVE term, and every amount is a string
  // parsed into a Decimal — money never passes through a JavaScript float,
  // not even in a seed.
  console.log('Seeding fees…');
  const D2 = (v: string) => new Prisma.Decimal(v);

  const labelByName = new Map(
    (await prisma.label.findMany({ where: { schoolId, category: LabelCategory.fee } }))
      .map((l) => [l.name, l.id]),
  );

  const FEE_TYPES = [
    { name: 'Tuition', label: 'Tuition', description: 'Termly tuition' },
    { name: 'Feeding', label: 'Boarding', description: 'Lunch and snack' },
    { name: 'Transport', label: 'Transport', description: 'School bus' },
  ];
  const feeTypeByName: Record<string, string> = {};
  for (const t of FEE_TYPES) {
    const row = await prisma.feeType.create({
      data: {
        schoolId, name: t.name, description: t.description,
        labelId: labelByName.get(t.label) ?? null,
        createdBy: actor, updatedBy: actor,
      },
    });
    feeTypeByName[t.name] = row.id;
  }

  // Tuition rises with the level; feeding is flat; transport is optional and
  // only priced for the two levels that actually use the bus.
  const FEES: Array<{ type: string; level: string; amount: string; name: string }> = [
    { type: 'Tuition', level: 'KG 2', amount: '450.00', name: 'KG 2 Tuition' },
    { type: 'Tuition', level: 'Basic 1', amount: '520.00', name: 'Basic 1 Tuition' },
    { type: 'Tuition', level: 'Basic 3', amount: '580.00', name: 'Basic 3 Tuition' },
    { type: 'Tuition', level: 'Basic 6', amount: '640.00', name: 'Basic 6 Tuition' },
    { type: 'Tuition', level: 'JHS 1', amount: '780.00', name: 'JHS 1 Tuition' },
    { type: 'Feeding', level: 'KG 2', amount: '180.00', name: 'KG 2 Feeding' },
    { type: 'Feeding', level: 'Basic 3', amount: '180.00', name: 'Basic 3 Feeding' },
    { type: 'Transport', level: 'Basic 3', amount: '220.00', name: 'Basic 3 Transport' },
    { type: 'Transport', level: 'JHS 1', amount: '260.00', name: 'JHS 1 Transport' },
  ];

  const activeTerm = await prisma.term.findFirstOrThrow({
    where: { schoolId, status: 'active' },
  });

  let assignmentCount = 0;
  for (const f of FEES) {
    const fee = await prisma.schoolFee.create({
      data: {
        schoolId,
        feeTypeId: feeTypeByName[f.type],
        levelId: levelByName[f.level],
        academicYearId: yCurrent.id,
        termId: activeTerm.id,
        name: f.name,
        amount: D2(f.amount),
        createdBy: actor, updatedBy: actor,
      },
    });

    // The Level → Classroom → Enrollment walk, exactly as the service does it.
    const targets = await prisma.enrollment.findMany({
      where: {
        schoolId, status: 'active', academicYearId: yCurrent.id,
        classroom: { levelId: levelByName[f.level], academicYearId: yCurrent.id },
      },
      select: { id: true },
    });
    if (targets.length) {
      await prisma.feeAssignment.createMany({
        data: targets.map((t) => ({
          schoolId, schoolFeeId: fee.id, enrollmentId: t.id,
          amountDue: D2(f.amount), createdBy: actor, updatedBy: actor,
        })),
        skipDuplicates: true,
      });
      assignmentCount += targets.length;
    }
  }

  // ── payments: a spread of fully paid, part paid and unpaid ────────────────
  console.log('Seeding payments…');
  const allAssignments = await prisma.feeAssignment.findMany({
    where: { schoolId },
    include: { enrollment: { include: { student: true } } },
    orderBy: { id: 'asc' },
  });

  let receiptSeq = 0;
  let paymentCount = 0;
  const receipt = () => `RCT-${String(++receiptSeq).padStart(5, '0')}`;
  // Deterministic, so re-running the seed produces the same figures and a
  // screenshot stays valid.
  const MOMO = ['MTN', 'TELECEL', 'AIRTELTIGO'];

  const paidInFull: string[] = [];
  const partPaid: string[] = [];

  for (const [i, a] of allAssignments.entries()) {
    const bucket = i % 4;
    if (bucket === 3) continue;                       // unpaid
    const full = bucket === 0 || bucket === 1;        // paid in full
    const amount = full ? a.amountDue : a.amountDue.dividedBy(2).toDecimalPlaces(2);
    const method = i % 3 === 0 ? FeePaymentMethod.cash : FeePaymentMethod.mobile_money;
    await prisma.feePayment.create({
      data: {
        schoolId,
        feeAssignmentId: a.id,
        receiptNumber: receipt(),
        amount,
        method,
        providerCode: method === FeePaymentMethod.mobile_money ? MOMO[i % MOMO.length] : null,
        reference: method === FeePaymentMethod.mobile_money ? `MM${240000000 + i}` : null,
        paidOn: days(activeTerm.startDate, 7 + (i % 21)),
        createdBy: actor, updatedBy: actor,
      },
    });
    paymentCount++;
    (full ? paidInFull : partPaid).push(a.id);
  }

  // One reversal, so the "signed sum" behaviour has something real to show and
  // the reversal UI is not empty. The original receipt survives; the reversal
  // consumes no number.
  const toReverse = await prisma.feePayment.findFirstOrThrow({
    where: { schoolId, reversesPaymentId: null },
    orderBy: { createdAt: 'asc' },
  });
  await prisma.feePayment.create({
    data: {
      schoolId,
      feeAssignmentId: toReverse.feeAssignmentId,
      receiptNumber: null,
      amount: toReverse.amount.negated(),
      method: toReverse.method,
      providerCode: toReverse.providerCode,
      reference: toReverse.reference,
      paidOn: toReverse.paidOn,
      reversesPaymentId: toReverse.id,
      reversalReason: 'Recorded against the wrong child — corrected the same day',
      createdBy: actor, updatedBy: actor,
    },
  });
  paymentCount++;

  // ── invoices, including one full correction chain ─────────────────────────
  console.log('Seeding invoices…');
  let invoiceSeq = 0;
  const invoiceNumber = () => `INV-${String(++invoiceSeq).padStart(5, '0')}`;

  // Group this term's assignments by enrollment — an invoice covers one
  // student, one term, many fees.
  const byEnrollment = new Map<string, typeof allAssignments>();
  for (const a of allAssignments) {
    const bucket = byEnrollment.get(a.enrollmentId) ?? [];
    bucket.push(a);
    byEnrollment.set(a.enrollmentId, bucket);
  }
  const enrollmentsWithFees = [...byEnrollment.entries()].filter(([, v]) => v.length > 0);

  async function issue(
    enrollmentId: string,
    assignments: typeof allAssignments,
    opts: { supersedes?: string; cancelled?: { reason: string } } = {},
  ) {
    const inv = await prisma.invoice.create({
      data: {
        schoolId,
        invoiceNumber: invoiceNumber(),
        enrollmentId,
        termId: activeTerm.id,
        status: opts.cancelled ? InvoiceStatus.cancelled : InvoiceStatus.issued,
        issuedOn: days(activeTerm.startDate, 3),
        dueOn: days(activeTerm.startDate, 24),
        supersedesInvoiceId: opts.supersedes ?? null,
        ...(opts.cancelled
          ? {
              cancelledAt: new Date(),
              cancelledBy: actor,
              cancellationReason: opts.cancelled.reason,
            }
          : {}),
        createdBy: actor, updatedBy: actor,
      },
    });
    await prisma.invoiceLine.createMany({
      data: assignments.map((a) => ({
        schoolId, invoiceId: inv.id, feeAssignmentId: a.id,
        // A cancelled invoice's lines are voided, which is what releases the
        // assignments — and what the partial unique index relies on.
        voidedAt: opts.cancelled ? new Date() : null,
        createdBy: actor,
      })),
    });
    return inv;
  }

  // Three straightforward issued invoices.
  let invoiceCount = 0;
  for (const [enrollmentId, assignments] of enrollmentsWithFees.slice(0, 3)) {
    await issue(enrollmentId, assignments);
    invoiceCount++;
  }

  // One CORRECTION CHAIN, so the chain-display code has something real to
  // render: an invoice issued over three fees, found to be wrong, cancelled
  // and reissued over two.
  const [chainEnrollmentId, chainAssignments] = enrollmentsWithFees[3];
  const original = await issue(chainEnrollmentId, chainAssignments, {
    cancelled: { reason: 'Transport billed in error — this child does not use the bus' },
  });
  await issue(chainEnrollmentId, chainAssignments.slice(0, Math.max(1, chainAssignments.length - 1)), {
    supersedes: original.id,
  });
  invoiceCount += 2;

  // ── 15. SMS consent, and the notification log ─────────────────────────────
  //
  // Consent is seeded DELIBERATELY UNEVENLY. Roughly two thirds of guardians
  // have it recorded and the rest do not, so the "no consent, no send" guard
  // has something real to demonstrate: the billing screen's reminder action
  // will genuinely suppress messages for the others, and the log will say why.
  // A demo where every guardian is consented proves nothing about the gate.
  console.log('Seeding SMS consent…');
  const allGuardians = await prisma.guardian.findMany({
    where: { schoolId },
    orderBy: { id: 'asc' },
  });

  const CONSENT_METHODS = ['verbal_at_enrollment', 'written_form', 'verbal_by_phone'];
  const consented: string[] = [];
  for (const [i, g] of allGuardians.entries()) {
    if (i % 3 === 2) continue;                       // every third: no consent
    await prisma.guardian.update({
      where: { id: g.id },
      data: {
        smsConsentGiven: true,
        smsConsentGivenAt: days(TODAY, -(30 + (i % 20))),
        smsConsentGivenBy: actor,
        smsConsentMethod: CONSENT_METHODS[i % CONSENT_METHODS.length],
      },
    });
    consented.push(g.id);
  }

  // A link can only be messageable where the guardian consented — the same
  // rule the service enforces, applied to the seed so the demo data cannot be
  // in a state the application would refuse to create.
  await prisma.studentGuardian.updateMany({
    where: { schoolId, guardianId: { notIn: consented } },
    data: { canReceiveSms: false },
  });
  await prisma.studentGuardian.updateMany({
    where: { schoolId, guardianId: { in: consented } },
    data: { canReceiveSms: true },
  });

  console.log('Seeding notification log…');
  const notifyLinks = await prisma.studentGuardian.findMany({
    where: { schoolId, canReceiveSms: true },
    include: { guardian: true, student: true },
    orderBy: { id: 'asc' },
    take: 12,
  });

  const notifySchool = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });

  /** Mirrors what the service does: normalise, never rewrite the stored column. */
  const e164 = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const national = digits.startsWith('233') ? digits.slice(3)
      : digits.startsWith('0') ? digits.slice(1) : digits;
    return `+233${national}`;
  };

  let notificationCount = 0;
  for (const [i, link] of notifyLinks.entries()) {
    // Every terminal state is represented, plus one still in flight.
    const shape = i % 4;
    const body =
      shape === 1
        ? `${notifySchool.name}: Fees for ${link.student.firstName} ${link.student.lastName} are outstanding. Please settle at the school office. Thank you.`
        : `${notifySchool.name}: Payment received for ${link.student.firstName} ${link.student.lastName}. Thank you.`;

    const status =
      shape === 0 ? NotificationStatus.sent
      : shape === 1 ? NotificationStatus.delivered
      : shape === 2 ? NotificationStatus.failed
      : NotificationStatus.queued;

    const queuedAt = days(TODAY, -(1 + (i % 5)));
    await prisma.notificationMessage.create({
      data: {
        schoolId,
        trigger: shape === 1 ? NotificationTrigger.fee_reminder : NotificationTrigger.fee_receipt,
        status,
        guardianId: link.guardianId,
        studentId: link.studentId,
        toPhone: e164(link.guardian.phonePrimary),
        body,
        // A one-segment GSM-7 message is ~160 characters; these run over.
        segmentCount: body.length <= 160 ? 1 : 2,
        attemptCount: status === NotificationStatus.queued ? 0 : status === NotificationStatus.failed ? 3 : 1,
        providerCode: status === NotificationStatus.queued ? null : 'sandbox',
        providerMessageId:
          status === NotificationStatus.sent || status === NotificationStatus.delivered
            ? `sandbox-${link.id}` : null,
        lastError:
          status === NotificationStatus.failed
            ? 'Gateway timeout (sandbox simulation) (gave up after 3 attempts)' : null,
        queuedAt,
        sentAt: status === NotificationStatus.queued || status === NotificationStatus.failed ? null : queuedAt,
        deliveredAt: status === NotificationStatus.delivered ? days(queuedAt, 1) : null,
        failedAt: status === NotificationStatus.failed ? days(queuedAt, 1) : null,
        nextAttemptAt: status === NotificationStatus.queued ? TODAY : null,
        createdBy: actor,
        updatedBy: actor,
      },
    });
    notificationCount++;
  }

  // One SUPPRESSED row for a guardian who never consented — the state that
  // proves the gate did its job rather than the gateway failing.
  const unconsented = allGuardians.find((g) => !consented.includes(g.id));
  if (unconsented) {
    const link = await prisma.studentGuardian.findFirst({
      where: { schoolId, guardianId: unconsented.id },
      include: { student: true },
    });
    await prisma.notificationMessage.create({
      data: {
        schoolId,
        trigger: NotificationTrigger.fee_reminder,
        status: NotificationStatus.suppressed,
        guardianId: unconsented.id,
        studentId: link?.studentId ?? null,
        toPhone: '',
        body: `${notifySchool.name}: Fees are outstanding. Please settle at the school office.`,
        segmentCount: 1,
        lastError: 'Guardian has not given SMS consent',
        queuedAt: days(TODAY, -2),
        failedAt: days(TODAY, -2),
        createdBy: actor,
        updatedBy: actor,
      },
    });
    notificationCount++;
  }

  // ── 16. document sequences → consistent with seeded records ───────────────
  // Generator emits `${prefix}-${padded(currentNumber+1)}`, so the next
  // student is STU-0020, next staff STF-0012, next admission ADM-0003.
  console.log('Aligning document sequences…');
  const seqTargets: Array<[DocumentSequenceType, number]> = [
    [DocumentSequenceType.student_number, 19],
    [DocumentSequenceType.staff_number, 11],
    [DocumentSequenceType.admission_number, 7],
    [DocumentSequenceType.receipt_number, receiptSeq],
    [DocumentSequenceType.invoice_number, invoiceSeq],
  ];
  for (const [type, n] of seqTargets) {
    await prisma.documentSequence.updateMany({
      where: { schoolId, type },
      data: { currentNumber: n },
    });
  }

  console.log('Demo seed complete.');
  console.log('  School: Adom International School (Adenta, Accra)');
  console.log(`  Years: ${yearLabel(prevYearStart)} closed · ${yearLabel(currentYearStart)} ACTIVE · ${yearLabel(nextYearStart)} upcoming`);
  console.log(`  6 terms (closed×3, active×1, draft×2) · 14 levels · 10 staff + Super Admin`);
  console.log(`  ACTIVE term: ${t3Start.toISOString().slice(0, 10)} → ${t3End.toISOString().slice(0, 10)} (contains today, ${TODAY.toISOString().slice(0, 10)})`);
  console.log('  6 classrooms (all with teachers) · 19 students · 14 guardians / 18 links');
  console.log('  18 enrollments (16 active, 2 withdrawn) · 7 admissions (all six statuses, numbered chronologically) · 4 files');
  console.log('  Next numbers: STU-0020 · STF-0012 · ADM-0008');
  console.log(`  9 labels (3 fee + 2 income + 3 expenditure + 1 archived; "Transport" in all three categories)`);
  console.log(`  ${FEE_TYPES.length} fee types · ${FEES.length} fees · ${assignmentCount} assignments · ${paymentCount} payments (1 reversed)`);
  console.log(`  ${invoiceCount} invoices, including one correction chain (INV-00004 → INV-00005)`);
  console.log(`  Next numbers: RCT-${String(receiptSeq + 1).padStart(5, '0')} · INV-${String(invoiceSeq + 1).padStart(5, '0')}`);
  console.log(`  ${consented.length} of ${allGuardians.length} guardians have SMS consent recorded (the rest deliberately do not)`);
  console.log(`  ${notificationCount} notifications (sent · delivered · failed · queued · suppressed)`);
  console.log(`  ${attendanceRows} attendance records (x2 sessions) over ${attendanceDates.length} weekdays to ${REGISTER_END.toISOString().slice(0, 10)} (all four statuses, ${partialDays} partial days, one row left unmarked)`);
}

main()
  .catch((e) => {
    console.error('Demo seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
