# Brite SMS — Backend (Phase 1)

NestJS + Prisma + PostgreSQL API for the Ghana school management system.

## Setup

```bash
npm install
npm run db:setup      # migrate + raw SQL + generate + seed (bootstrap)
npm run start:dev     # API on :3001, prefix /api/v1
```

Seeds: `npm run prisma:seed` (bootstrap: permissions, roles, school, Super
Admin — idempotent) and `npm run seed:demo` (stakeholder demo dataset — wipes
and rebuilds domain data; see the script header before running).

## ⚠️ Migrations: read this before running ANY migration

### Rule 1 — `prisma migrate deploy`, never `migrate dev`

This project's database contains ~30 objects that live outside the Prisma
schema (full inventory below). `prisma migrate dev` runs drift detection,
sees those objects, and **offers to reset the database** — accepting destroys
every raw-SQL constraint and all data. The standing procedure, used for every
migration since `20260814120000_admission_number_unique`:

1. Edit `schema.prisma`.
2. **Hand-write** the migration folder + `migration.sql` under
   `prisma/migrations/` (name indexes in Prisma's own convention,
   `<table>_<cols>_key`, so schema diffs recognise them).
3. `npx prisma migrate deploy` — applies pending migrations with **no** drift
   detection.
4. `npx prisma generate`.
5. Re-verify the raw-SQL inventory below still exists
   (`select indexname from pg_indexes where indexname like 'uq_%'` etc.).

If you find yourself typing `prisma migrate dev`: stop.

### Rule 2 — the raw SQL is part of the schema

`npm run db:raw-sql` (`scripts/apply-raw-migration.js`) applies every
constraint Prisma cannot express. A migration that drops/recreates one of
these tables silently loses them, and nothing fails until bad data appears.

The set is **one file per phase**, applied in order:

| File | Holds |
|---|---|
| `starter-docs/phase_1_required_raw_sql_migrations.sql` | the Phase 1 set — and only ever that |
| `starter-docs/phase_2_required_raw_sql_migrations.sql` | Phase 2 additions |

It is split rather than accumulated because the Phase 1 filename is named in
the frozen Phase 1 handoff and deployment documents; a later phase appending
to it would make that name a lie. Add a phase by adding a file and one entry
to `SQL_FILES` in the runner. **Every file is idempotent** — `IF NOT EXISTS`
on indexes, a `duplicate_object` guard around each `ADD CONSTRAINT`,
`CREATE OR REPLACE` for the function and triggers — which is what makes the
post-`migrate` re-run safe. Keep it that way, and note the runner passes
`ON_ERROR_STOP=1`, so a failed statement fails the command instead of being
reported as success.

The **complete** inventory across both files, verified against the live
database 2026-09-08 (file ↔ DB match exactly, no drift):

**Partial unique indexes — single-active business rules** (invisible to Prisma)

| Index | Table | Rule |
|---|---|---|
| `uq_one_active_enrollment_per_student_year` | enrollments | one **active** enrollment per student per year, regardless of curriculum track — the rule that actually fires on duplicate enrollment |
| `uq_one_active_academic_year_per_school` | academic_years | one active year per school |
| `uq_one_active_term_per_school` | terms | one active term per school |
| `uq_one_primary_guardian_per_student` | student_guardians | one primary guardian per student |

**Partial / expression uniques — identity rules** (invisible to Prisma)

| Index | Table | Rule |
|---|---|---|
| `uq_users_school_email_lower` | users | case-insensitive email unique per school (non-null) |
| `uq_users_school_phone` | users | phone unique per school (non-null) |
| `uq_staff_school_email_lower` | staff | case-insensitive email unique per school (non-null) |
| `uq_system_role_code` | roles | system role codes (school_id IS NULL) unique |
| `uq_school_role_code` | roles | per-school role codes unique |
| `uq_users_school_linked_entity` | users | one user account per linked staff/guardian entity — **plain composite unique, Prisma COULD express it but the schema does not declare it**; flagged as promotion candidate |
| `uq_label_school_category_name_lower` | labels | label names unique per school **per category**, case-insensitively — `(school_id, category, lower(name))`. Prisma cannot express it: `@@unique` has no syntax for an expression like `lower(name)`. `model Label` therefore declares **no** unique at all, so this index is the single rule rather than one of two overlapping ones. The per-category scoping is deliberate — "Transport" must be able to be both an income and an expenditure heading (Phase 2) |
| `uq_fee_type_school_name_lower` | fee_types | fee type names unique per school, case-insensitively — `(school_id, lower(name))`. Same shape and same reason as the label index, and `model FeeType` likewise declares no unique. Not cosmetic: the fee ledger groups by fee type, so "Tuition" and "tuition" side by side would split one account into two and give the school two answers to "what has Tuition collected this term" |
| `uq_one_reversal_per_payment` | fee_payments | a payment may be reversed at most **once** — partial, `WHERE reverses_payment_id IS NOT NULL`, because the column is null for ordinary payments and those must not collide with each other |
| `uq_notification_dedupe` | notification_messages | at most one message per `(school_id, dedupe_key)` — partial, `WHERE dedupe_key IS NOT NULL`, because a message that is legitimately unconstrained (an ad-hoc announcement) carries no key and those must not collide. It has to hold at the DATABASE: the whole point is defending against a concurrent retry, and two requests both passing an application-level "does one exist?" check is exactly the race it exists to lose. A double-clicked "Send reminders" then costs one duplicate-key error, not 300 duplicate messages at full price |
| `uq_one_live_invoice_line_per_assignment` | invoice_lines | a fee assignment sits on at most **one live (non-cancelled) invoice** — partial, `WHERE voided_at IS NULL`. Without it the same debt can be formally billed twice and two invoices would each derive a payment state from the same payments. `invoice_lines.voided_at` exists **solely** to make this expressible: the cancelled state lives on `invoices`, and a partial index predicate cannot reach into another table |

Removed 2026-08-14: `uq_admission_school_number` — superseded by the
Prisma-owned `@@unique([schoolId, admissionNumber])`
(`admission_applications_school_id_admission_number_key`), verified
functionally identical for NULL and non-NULL values before dropping.

**CHECK constraints** (invisible to Prisma): `chk_academic_year_dates`,
`chk_term_number` (1–4), `chk_term_dates`, `chk_exam_dates`,
`chk_classroom_capacity`, `chk_document_sequence_current_number`,
`chk_document_sequence_padding_length`, `chk_file_size`,
`chk_user_email_or_phone`, `chk_auth_token_contact_or_user`,
`chk_fee_payment_provider` (mobile money carries a network; nothing else does),
`chk_fee_payment_amount_sign` (a payment is positive; a reversal is negative
and names what it reverses — this is what lets every balance be one plain
signed `SUM` with no exclusion subquery).

**Trigger + function**: `trg_prevent_audit_log_update` /
`trg_prevent_audit_log_delete` → `prevent_audit_log_changes()` — the audit
trail is immutable by design; do not "fix" this.

**Extension**: `pgcrypto` (`gen_random_uuid()` defaults depend on it).

The `@@unique([studentId, academicYearId, curriculumTrack])` on `Enrollment`
is real but *weaker* than the partial index — do not mistake it for the whole
rule. See the comment block on `model Enrollment` in `schema.prisma`.

**Two rules that look like they belong here and deliberately do not:**

- *One attendance record per student per date* is
  `@@unique([enrollmentId, attendanceDate])` on `AttendanceRecord`. Prisma can
  express it, so it lives in the schema — the rule for this file is "what
  Prisma cannot express", not "every constraint".
- *An attendance date must not be in the future* is enforced in
  `AttendanceService`, not as a `CHECK`. Postgres rejects non-immutable
  functions such as `CURRENT_DATE` inside a check constraint, so the migration
  would fail at apply time.
- *A payment must not exceed the outstanding balance* is enforced in
  `FeePaymentsService` under a `SELECT … FOR UPDATE` row lock on the
  assignment. It spans two tables and depends on a running sum, so no CHECK
  can express it; the lock is what stops two concurrent payments both seeing
  the same remaining balance.
- *No SMS without recorded consent* is enforced in
  `NotificationsService.resolveRecipient`, the single door into the outbox. It
  spans `guardians.sms_consent_given` and `student_guardians.can_receive_sms`
  and produces a `suppressed` row rather than refusing the write, so no
  constraint can express it. What the database does guarantee is narrower and
  still useful: the poller only ever claims rows whose status is `queued`, and
  a suppressed row is never `queued`.

## Tests

```bash
npm test              # unit suites
```
