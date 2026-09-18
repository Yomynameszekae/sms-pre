# Permissions Matrix

The seeded roles and the full permission matrix, across every phase.
`prisma/seed.ts` is the source of truth; this table mirrors it.

## Roles

```txt
SUPER_ADMIN
SCHOOL_ADMIN
HEADTEACHER
ACADEMIC_COORDINATOR
CLASS_TEACHER
ADMISSIONS_OFFICER
PARENT_GUARDIAN
COMPLIANCE_OFFICER
BURSAR                ← added in Phase 2 Stage 1b
```

---

## Permission Matrix

| Permission | SUPER_ADMIN | SCHOOL_ADMIN | HEADTEACHER | ACADEMIC_COORDINATOR | CLASS_TEACHER | ADMISSIONS_OFFICER | PARENT_GUARDIAN | COMPLIANCE_OFFICER |
|---|---|---|---|---|---|---|---|---|
| users.create | Yes | Yes | No | No | No | No | No | No |
| users.read | Yes | Yes | No | No | No | No | No | No |
| users.update | Yes | Yes | No | No | No | No | No | No |
| users.deactivate | Yes | Yes | No | No | No | No | No | No |
| users.manage_roles | Yes | Yes | No | No | No | No | No | No |
| roles.create | Yes | Yes | No | No | No | No | No | No |
| roles.read | Yes | Yes | No | No | No | No | No | No |
| roles.update | Yes | Yes | No | No | No | No | No | No |
| roles.assign_permissions | Yes | Yes | No | No | No | No | No | No |
| permissions.read | Yes | Yes | No | No | No | No | No | No |
| school.read | Yes | Yes | Yes | No | No | No | No | No |
| school.update | Yes | Yes | No | No | No | No | No | No |
| school_settings.read | Yes | Yes | No | No | No | No | No | No |
| school_settings.update | Yes | Yes | No | No | No | No | No | No |
| document_sequences.read | Yes | Yes | No | No | No | No | No | No |
| document_sequences.update | Yes | Yes | No | No | No | No | No | No |
| document_sequences.generate | Yes | Yes | No | No | No | Yes | No | No |
| academic_years.create | Yes | Yes | No | No | No | No | No | No |
| academic_years.read | Yes | Yes | Yes | Yes | No | No | No | No |
| academic_years.update | Yes | Yes | No | No | No | No | No | No |
| academic_years.activate | Yes | Yes | No | No | No | No | No | No |
| academic_years.close | Yes | Yes | No | No | No | No | No | No |
| terms.create | Yes | Yes | No | No | No | No | No | No |
| terms.read | Yes | Yes | Yes | Yes | No | No | No | No |
| terms.update | Yes | Yes | No | No | No | No | No | No |
| terms.activate | Yes | Yes | No | No | No | No | No | No |
| terms.close | Yes | Yes | No | No | No | No | No | No |
| levels.create | Yes | Yes | No | Yes | No | No | No | No |
| levels.read | Yes | Yes | Yes | Yes | No | No | No | No |
| levels.update | Yes | Yes | No | Yes | No | No | No | No |
| levels.archive | Yes | Yes | No | Yes | No | No | No | No |
| classrooms.create | Yes | Yes | No | Yes | No | No | No | No |
| classrooms.read | Yes | Yes | Yes | Yes | Yes | No | No | No |
| classrooms.update | Yes | Yes | No | Yes | No | No | No | No |
| classrooms.assign_teacher | Yes | Yes | No | Yes | No | No | No | No |
| classrooms.archive | Yes | Yes | No | Yes | No | No | No | No |
| staff.create | Yes | Yes | No | No | No | No | No | No |
| staff.read | Yes | Yes | Yes | Yes | No | No | No | Yes |
| staff.update | Yes | Yes | No | No | No | No | No | No |
| staff.archive | Yes | Yes | No | No | No | No | No | No |
| students.create | Yes | Yes | No | No | No | Yes | No | No |
| students.read | Yes | Yes | Yes | Yes | Yes | Yes | Linked only | Yes |
| students.update | Yes | Yes | No | No | No | Yes | No | No |
| students.archive | Yes | Yes | No | No | No | No | No | No |
| guardians.create | Yes | Yes | No | No | No | Yes | No | No |
| guardians.read | Yes | Yes | Yes | No | Yes | Yes | Own record only | Yes |
| guardians.update | Yes | Yes | No | No | No | Yes | No | No |
| guardians.archive | Yes | Yes | No | No | No | No | No | No |
| student_guardians.manage | Yes | Yes | No | No | No | Yes | No | No |
| admissions.create | Yes | Yes | No | No | No | Yes | No | No |
| admissions.read | Yes | Yes | Yes | No | No | Yes | No | No |
| admissions.update | Yes | Yes | No | No | No | Yes | No | No |
| admissions.approve | Yes | Yes | Yes | No | No | No | No | No |
| admissions.enroll | Yes | Yes | No | No | No | Yes | No | No |
| enrollments.create | Yes | Yes | No | Yes | No | Yes | No | No |
| enrollments.read | Yes | Yes | Yes | Yes | Yes | Yes | Linked only | No |
| enrollments.update | Yes | Yes | No | Yes | No | No | No | No |
| enrollments.withdraw | Yes | Yes | No | Yes | No | No | No | No |
| files.upload | Yes | Yes | No | No | No | Yes | No | No |
| files.read | Yes | Yes | Yes | Yes | Yes | Yes | Linked only | Yes |
| files.archive | Yes | Yes | No | No | No | No | No | No |
| audit_logs.read | Yes | Yes | Yes | No | No | No | No | Yes |

### Phase 2 Stage 1a additions

| Permission | SUPER_ADMIN | SCHOOL_ADMIN | HEADTEACHER | ACADEMIC_COORDINATOR | CLASS_TEACHER | ADMISSIONS_OFFICER | PARENT_GUARDIAN | COMPLIANCE_OFFICER |
|---|---|---|---|---|---|---|---|---|
| labels.create | Yes | Yes | No | No | No | No | No | No |
| labels.read | Yes | Yes | Yes | Yes | No | No | No | Yes |
| labels.update | Yes | Yes | No | No | No | No | No | No |
| labels.archive | Yes | Yes | No | No | No | No | No | No |
| attendance.read | Yes | Yes | No | No | Own classrooms | No | No | No |
| attendance.read_any | Yes | Yes | Yes | Yes | No | No | No | Yes |
| attendance.mark | Yes | Yes | No | No | Own classrooms | No | No | No |
| attendance.mark_any | Yes | Yes | No | Yes | No | No | No | No |

Notes on these eight:

- **`labels.archive` governs restore as well.** One capability, two directions,
  matching the Phase 1B archive/restore endpoints.
- **The `_any` keys are scope escalators, not duplicates.** Without one, a
  holder may only touch classrooms where they are `Classroom.classTeacherId`.
  The ownership test lives in `AttendanceService`; `PermissionsGuard` stays a
  pure key check and never learns about resources. `CLASS_TEACHER` therefore
  reads "Own classrooms" above, not "Yes".
- **`COMPLIANCE_OFFICER` gets `attendance.read_any`** because the register is
  an inspected artifact and that is what this role exists for. Read-only, in
  keeping with its other grants.
- **`PARENT_GUARDIAN` gets nothing here.** The guardian portal is out of scope
  for this stage, and this role already holds a school-wide
  `enrollments.read`, so any attendance key would expose every child's
  register rather than their own.
- **There is no `attendance.reopen_term` key.** Reopening a closed term is
  restricted to the SUPER_ADMIN **role**, checked in the service, precisely
  because `SCHOOL_ADMIN` is seeded with `PERMISSIONS.map(p => p.key)` and
  would inherit any new key automatically — "Super Admin only" would quietly
  become "both admins". A role cannot be widened by adding a permission row.

### Phase 2 Stage 1b additions

Columns are abbreviated: SA = SUPER_ADMIN, ADM = SCHOOL_ADMIN,
HT = HEADTEACHER, BUR = BURSAR. Every other role has **no** finance
permission at all.

| Permission | SA | ADM | HT | BUR |
|---|---|---|---|---|
| fee_types.create | Yes | Yes | No | Yes |
| fee_types.read | Yes | Yes | Yes | Yes |
| fee_types.update | Yes | Yes | No | Yes |
| fee_types.archive | Yes | Yes | No | Yes |
| school_fees.create | Yes | Yes | No | Yes |
| school_fees.read | Yes | Yes | Yes | Yes |
| school_fees.update | Yes | Yes | No | Yes |
| school_fees.archive | Yes | Yes | No | Yes |
| fee_assignments.read | Yes | Yes | Yes | Yes |
| fee_assignments.reconcile | Yes | Yes | No | Yes |
| fee_payments.create | Yes | Yes | No | Yes |
| fee_payments.read | Yes | Yes | Yes | Yes |
| fee_payments.reverse | Yes | Yes | No | Yes |
| fees.report | Yes | Yes | Yes | Yes |
| invoices.create | Yes | Yes | No | Yes |
| invoices.read | Yes | Yes | Yes | Yes |
| invoices.cancel | Yes | Yes | No | Yes |

Notes on these seventeen:

- **`archive` governs restore**, as everywhere else in Brite.
- **`fee_assignments.reconcile` also governs `PATCH /fees/assignments/:id`.**
  Both are the authority to change what one specific student owes; splitting
  them would imply a distinction that does not exist.
- **`fee_payments.reverse` is separate from `create`.** Reversing a receipt a
  parent is physically holding is a materially different act from recording a
  payment, and it is the one a school will want to restrict.
- **`fees.report` is separate from `fee_assignments.read`.** The level billing
  summary and the ledger expose the whole school's money; looking up one
  child's bill does not.
- **`invoices.cancel` is separate from `create`** for the same reason as
  payment reversal — withdrawing a numbered document is not issuing one.
- **There is no `invoices.correct` key.** Correcting an invoice *is* cancelling
  and reissuing, so the endpoint requires both `invoices.cancel` **and**
  `invoices.create`. `RequirePermissions` is all-of, which is the entire
  enforcement.
- **HEADTEACHER gets read-only across the whole finance surface**, in keeping
  with the rest of that role: sight of the school's money, no authority over
  it.
- **No other role gets anything.** In particular `ADMISSIONS_OFFICER` and
  `CLASS_TEACHER` cannot see fees, and `PARENT_GUARDIAN` cannot either — the
  guardian portal is out of scope and that role holds a school-wide
  `students.read`, so a fee permission would expose every child's bill.

### The BURSAR role

The first role added since the Phase 1 seed. `isSystemRole = true`,
`schoolId = null`, seeded idempotently alongside the existing eight.

Grants: all seventeen finance permissions and `labels.read`, plus **read-only**
`students.read`, `guardians.read`, `enrollments.read`, `classrooms.read`,
`levels.read`, `academic_years.read`, `terms.read`.

The shape of the role is the point: **a bursar can take money but cannot edit a
child's record.**

### Phase 2 — SMS notifications

| Permission | SUPER_ADMIN | SCHOOL_ADMIN | HEADTEACHER | BURSAR | ADMISSIONS_OFFICER |
|---|---|---|---|---|---|
| notifications.read | Yes | Yes | Yes | Yes | No |
| notifications.trigger | Yes | Yes | No | Yes | No |
| guardians.consent_manage | Yes | Yes | No | No | Yes |

- **`notifications.trigger` is separate from `read`** because triggering is
  cost-bearing: every fire is a paid message. Seeing the log and spending the
  school's money are not the same authority. `HEADTEACHER` gets sight of
  delivery without the ability to spend.
- **`guardians.consent_manage` goes to the front desk, not to finance.**
  `ADMISSIONS_OFFICER` enrols the family, so they are who actually asks the
  consent question and records the answer. `BURSAR` sends the reminders but
  does not decide who may be messaged.
- No other role gets any of these.

**Total: 94 permissions across 28 modules** — 66 across 19 at end of Phase 1,
plus 8 in Stage 1a and 17 in Stage 1b.

> Correcting a figure that has been repeated in several documents: the Phase 1
> permission count is **66, not 76**. `prisma/seed.ts` is the source of truth
> (`grep -c "^  { key: '" prisma/seed.ts`), and the live database agrees. The
> "76 across 19 modules" quoted in the Phase 2 gap analysis and elsewhere does
> not match either. The module count of 19 was right.

## Important Notes

- `SUPER_ADMIN` may receive all permissions.
- `PARENT_GUARDIAN` permissions must always be constrained to linked students only.
- `CLASS_TEACHER` access must later be constrained to assigned classroom students.
  **Partially delivered in Phase 2 Stage 1a**: attendance is the first module
  that actually enforces this, via the `_any` split above. The Phase 1
  permissions (`students.read`, `classrooms.read`, `enrollments.read`) remain
  school-wide and unscoped.

### Filename

**Renamed 17 September 2026** from `PERMISSIONS_MATRIX_PHASE_1.md`, together
with `API_ENDPOINTS.md` (was `API_ENDPOINTS_PHASE_1.md`). Both document every
phase, so the `PHASE_1` names had become actively misleading.

Updated to the new names: `prisma/seed.ts` (the comment above
`ROLE_PERMISSIONS`) and the two files' own cross-references.

Deliberately NOT updated: `PHASE_1_HANDOFF_CHECKLIST.md`,
`build-docs/BUILD_PLAN.md`, `_phase_1_schema_review.md` and
`CLAUDE_CODE_BUILD_BRIEF.md` still cite the old names. Those are frozen
records of what was specified and delivered in Phase 1, not live references;
editing them would falsify the history they exist to preserve. Anyone
following a stale name from one of them lands here via this note.
- Permission keys are the source of access control, not role names.
