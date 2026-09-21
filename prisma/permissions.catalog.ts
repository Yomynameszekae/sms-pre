/**
 * THE PERMISSION CATALOGUE — the single definition of what permissions exist
 * and which roles hold them by default.
 *
 * Extracted from seed.ts so that the seed and `scripts/sync-permissions.ts`
 * read the SAME list. Two copies of this would drift, and the failure mode is
 * silent: a permission that exists in one list and not the other produces a
 * 403 on a deployed server with no obvious cause.
 *
 * Adding a permission here is all that is required — the seed creates it on a
 * fresh database, and the sync script backfills it into an existing one.
 */
export const PERMISSIONS = [
  { key: 'auth.login', module: 'auth' },
  { key: 'auth.refresh', module: 'auth' },
  { key: 'auth.logout', module: 'auth' },
  { key: 'auth.change_password', module: 'auth' },
  { key: 'users.create', module: 'users' },
  { key: 'users.read', module: 'users' },
  { key: 'users.update', module: 'users' },
  { key: 'users.deactivate', module: 'users' },
  { key: 'users.manage_roles', module: 'users' },
  { key: 'roles.create', module: 'roles' },
  { key: 'roles.read', module: 'roles' },
  { key: 'roles.update', module: 'roles' },
  { key: 'roles.assign_permissions', module: 'roles' },
  { key: 'permissions.read', module: 'permissions' },
  { key: 'school.read', module: 'school' },
  { key: 'school.update', module: 'school' },
  { key: 'school_settings.read', module: 'school_settings' },
  { key: 'school_settings.update', module: 'school_settings' },
  { key: 'document_sequences.read', module: 'document_sequences' },
  { key: 'document_sequences.update', module: 'document_sequences' },
  { key: 'document_sequences.generate', module: 'document_sequences' },
  { key: 'academic_years.create', module: 'academic_years' },
  { key: 'academic_years.read', module: 'academic_years' },
  { key: 'academic_years.update', module: 'academic_years' },
  { key: 'academic_years.activate', module: 'academic_years' },
  { key: 'academic_years.close', module: 'academic_years' },
  { key: 'terms.create', module: 'terms' },
  { key: 'terms.read', module: 'terms' },
  { key: 'terms.update', module: 'terms' },
  { key: 'terms.activate', module: 'terms' },
  { key: 'terms.close', module: 'terms' },
  { key: 'levels.create', module: 'levels' },
  { key: 'levels.read', module: 'levels' },
  { key: 'levels.update', module: 'levels' },
  { key: 'levels.archive', module: 'levels' },
  { key: 'classrooms.create', module: 'classrooms' },
  { key: 'classrooms.read', module: 'classrooms' },
  { key: 'classrooms.update', module: 'classrooms' },
  { key: 'classrooms.assign_teacher', module: 'classrooms' },
  { key: 'classrooms.archive', module: 'classrooms' },
  { key: 'staff.create', module: 'staff' },
  { key: 'staff.read', module: 'staff' },
  { key: 'staff.update', module: 'staff' },
  { key: 'staff.archive', module: 'staff' },
  { key: 'students.create', module: 'students' },
  { key: 'students.read', module: 'students' },
  { key: 'students.update', module: 'students' },
  { key: 'students.archive', module: 'students' },
  { key: 'guardians.create', module: 'guardians' },
  { key: 'guardians.read', module: 'guardians' },
  { key: 'guardians.update', module: 'guardians' },
  { key: 'guardians.archive', module: 'guardians' },
  { key: 'student_guardians.manage', module: 'student_guardians' },
  { key: 'admissions.create', module: 'admissions' },
  { key: 'admissions.read', module: 'admissions' },
  { key: 'admissions.update', module: 'admissions' },
  { key: 'admissions.approve', module: 'admissions' },
  { key: 'admissions.enroll', module: 'admissions' },
  { key: 'enrollments.create', module: 'enrollments' },
  { key: 'enrollments.read', module: 'enrollments' },
  { key: 'enrollments.update', module: 'enrollments' },
  { key: 'enrollments.withdraw', module: 'enrollments' },
  { key: 'files.upload', module: 'files' },
  { key: 'files.read', module: 'files' },
  { key: 'files.archive', module: 'files' },
  { key: 'audit_logs.read', module: 'audit_logs' },
  // Phase 2 Stage 1a — Label (shared classification, fees consume it later).
  { key: 'labels.create', module: 'labels' },
  { key: 'labels.read', module: 'labels' },
  { key: 'labels.update', module: 'labels' },
  { key: 'labels.archive', module: 'labels' },
  // Phase 2 Stage 1a — attendance register.
  //
  // The `_any` keys are SCOPE ESCALATORS, not duplicates: without one, a
  // holder may only touch classrooms they are the class teacher of
  // (Classroom.classTeacherId → their linked Staff row). The ownership test
  // itself lives in AttendanceService, not in PermissionsGuard.
  //
  // There is deliberately NO `attendance.reopen_term` key. Reopening a closed
  // term is restricted to the SUPER_ADMIN *role*, because SCHOOL_ADMIN below
  // is granted every permission in this list and would inherit a new key
  // automatically.
  { key: 'attendance.read', module: 'attendance' },
  { key: 'attendance.read_any', module: 'attendance' },
  { key: 'attendance.mark', module: 'attendance' },
  { key: 'attendance.mark_any', module: 'attendance' },
  // Phase 2 Stage 1b — fees, billing and invoices.
  { key: 'fee_types.create', module: 'fee_types' },
  { key: 'fee_types.read', module: 'fee_types' },
  { key: 'fee_types.update', module: 'fee_types' },
  { key: 'fee_types.archive', module: 'fee_types' },
  { key: 'school_fees.create', module: 'school_fees' },
  { key: 'school_fees.read', module: 'school_fees' },
  { key: 'school_fees.update', module: 'school_fees' },
  { key: 'school_fees.archive', module: 'school_fees' },
  { key: 'fee_assignments.read', module: 'fee_assignments' },
  // `reconcile` also governs editing one child's amountDue: both are the
  // authority to change what a specific student owes.
  { key: 'fee_assignments.reconcile', module: 'fee_assignments' },
  { key: 'fee_payments.create', module: 'fee_payments' },
  { key: 'fee_payments.read', module: 'fee_payments' },
  // Separate from `create`: reversing a receipt a parent is holding is a
  // materially different act from recording a payment, and it is the one a
  // school will want to restrict.
  { key: 'fee_payments.reverse', module: 'fee_payments' },
  // Separate from `fee_assignments.read`: the level billing summary and the
  // ledger expose the whole school's money, which is not the same authority
  // as looking up one child's bill.
  { key: 'fees.report', module: 'fees' },
  { key: 'invoices.create', module: 'invoices' },
  { key: 'invoices.read', module: 'invoices' },
  // Withdrawing a numbered document a parent is holding. Correcting an
  // invoice needs BOTH this and `invoices.create` — there is deliberately no
  // third key for it.
  { key: 'invoices.cancel', module: 'invoices' },
  // Phase 2 — SMS notification layer.
  { key: 'notifications.read', module: 'notifications' },
  // Separate from `read` because triggering is COST-BEARING: every fire is a
  // paid message. Seeing the log and spending the school's money are not the
  // same authority.
  { key: 'notifications.trigger', module: 'notifications' },
  // Recording or withdrawing a guardian's SMS consent. Separate from
  // `guardians.update` because consent is a legal record attributable to the
  // member of staff who obtained it, not an ordinary field edit.
  { key: 'guardians.consent_manage', module: 'guardians' },
];

export const ROLES = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full system access' },
  { code: 'SCHOOL_ADMIN', name: 'School Admin', description: 'Full school operational access' },
  { code: 'HEADTEACHER', name: 'Headteacher', description: 'School leadership read access' },
  { code: 'ACADEMIC_COORDINATOR', name: 'Academic Coordinator', description: 'Academic management access' },
  { code: 'CLASS_TEACHER', name: 'Class Teacher', description: 'Classroom-level access' },
  { code: 'ADMISSIONS_OFFICER', name: 'Admissions Officer', description: 'Admissions and enrollment access' },
  { code: 'PARENT_GUARDIAN', name: 'Parent/Guardian', description: 'Limited read access to linked students' },
  { code: 'COMPLIANCE_OFFICER', name: 'Compliance Officer', description: 'Audit and compliance read access' },
  // Phase 2 Stage 1b. The first role added since the Phase 1 seed. The point
  // is a finance user who can take money but cannot edit a child's record.
  { code: 'BURSAR', name: 'Bursar', description: 'Fees, payments and invoicing' },
];

// Permissions per role. This file is the source of truth; the table in
// starter-docs/PERMISSIONS_MATRIX.md mirrors it and must be kept in step.
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key),
  SCHOOL_ADMIN: PERMISSIONS.map((p) => p.key),
  HEADTEACHER: [
    'school.read', 'academic_years.read', 'terms.read', 'levels.read', 'classrooms.read',
    'staff.read', 'students.read', 'guardians.read', 'admissions.read', 'admissions.approve',
    'enrollments.read', 'files.read', 'audit_logs.read',
    // Read-only across every classroom, in keeping with the rest of this role.
    'labels.read', 'attendance.read_any',
    // Read-only oversight of the school's money. No create, no payment,
    // no cancel.
    'fee_types.read', 'school_fees.read', 'fee_assignments.read',
    'fee_payments.read', 'fees.report', 'invoices.read',
    'notifications.read',
  ],
  ACADEMIC_COORDINATOR: [
    'academic_years.read', 'terms.read', 'levels.create', 'levels.read', 'levels.update', 'levels.archive',
    'classrooms.create', 'classrooms.read', 'classrooms.update', 'classrooms.assign_teacher', 'classrooms.archive',
    'staff.read', 'students.read', 'guardians.read',
    'enrollments.create', 'enrollments.read', 'enrollments.update', 'enrollments.withdraw',
    // Oversees every classroom's register, and covers a teacher's absence.
    'labels.read', 'attendance.read_any', 'attendance.mark_any',
  ],
  CLASS_TEACHER: [
    'classrooms.read', 'students.read', 'guardians.read', 'enrollments.read', 'files.read',
    // Scoped, NOT `_any`: the service restricts these to classrooms where
    // this teacher is Classroom.classTeacherId.
    'attendance.read', 'attendance.mark',
  ],
  ADMISSIONS_OFFICER: [
    'students.create', 'students.read', 'students.update',
    'guardians.create', 'guardians.read', 'guardians.update',
    'student_guardians.manage',
    // Front desk: they enrol the family, so they are who actually asks the
    // consent question and records the answer.
    'guardians.consent_manage',
    'admissions.create', 'admissions.read', 'admissions.update', 'admissions.enroll',
    'document_sequences.generate',
    'enrollments.create', 'enrollments.read',
    'files.upload', 'files.read',
  ],
  // No attendance grants in this stage. The guardian portal is out of scope,
  // and this role holds a school-wide `enrollments.read`, so any attendance
  // key here would expose every child's register, not just their own.
  PARENT_GUARDIAN: ['students.read', 'guardians.read', 'files.read', 'enrollments.read'],
  BURSAR: [
    // The whole finance surface…
    'fee_types.create', 'fee_types.read', 'fee_types.update', 'fee_types.archive',
    'school_fees.create', 'school_fees.read', 'school_fees.update', 'school_fees.archive',
    'fee_assignments.read', 'fee_assignments.reconcile',
    'fee_payments.create', 'fee_payments.read', 'fee_payments.reverse',
    'fees.report',
    'invoices.create', 'invoices.read', 'invoices.cancel',
    'labels.read',
    // Sends the fee reminders and sees whether they arrived.
    'notifications.read', 'notifications.trigger',
    // …plus READ-ONLY on the records a bill has to name. A bursar can take
    // money; a bursar cannot edit a child's record.
    'students.read', 'guardians.read', 'enrollments.read', 'classrooms.read',
    'levels.read', 'academic_years.read', 'terms.read',
  ],
  COMPLIANCE_OFFICER: [
    'audit_logs.read', 'students.read', 'guardians.read', 'staff.read', 'files.read',
    // The register is an inspection artifact and this role exists for exactly
    // that. Read-only, every classroom.
    'labels.read', 'attendance.read_any',
  ],
};
