-- Brite SMS — Phase 2 raw-SQL objects.
--
-- Applied by `npm run db:raw-sql` AFTER
-- phase_1_required_raw_sql_migrations.sql. See that file's header for why the
-- set is split per phase rather than accumulating in one file, and ../README.md
-- for the complete cross-phase inventory.
--
-- IDEMPOTENT, on the same terms as the Phase 1 file. Keep it that way.
--
-- Stage 1a (Label + attendance register) adds one object. The attendance
-- register itself needs no raw SQL: one-record-per-student-per-date is
-- @@unique([enrollmentId, attendanceDate]) in the Prisma schema, which Prisma
-- can express. Its "no future dates" rule is deliberately NOT here — a CHECK
-- constraint cannot call CURRENT_DATE (Postgres rejects non-immutable
-- functions in check constraints), so that rule lives in AttendanceService.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Label: case-insensitive uniqueness, scoped PER CATEGORY ─────────────────
--
-- The reference product this was benchmarked against makes label names unique
-- across ALL categories, so the same word cannot be both an income and an
-- expenditure heading (their defect D06). A school needs "Transport" as both.
-- Scoping the index by category is the fix.
--
-- Prisma cannot express this: it is an EXPRESSION index (lower(name)), and
-- @@unique has no syntax for a function call. The Prisma schema therefore
-- declares NO unique on Label at all — this index is the only rule, so there
-- is one constraint rather than two overlapping ones. See the note on
-- `model Label` in schema.prisma.

CREATE UNIQUE INDEX IF NOT EXISTS uq_label_school_category_name_lower
ON labels (school_id, category, lower(name));

-- ── Stage 1b: fees, billing and invoices ────────────────────────────────────

-- Payment method and network must agree. Mobile money is the only method that
-- carries a network, and it must carry one. Same style as the Phase 1
-- chk_auth_token_contact_or_user.
--
-- The NETWORK deliberately lives in a VARCHAR and not in the method enum:
-- Vodafone Cash became Telecel Cash and AirtelTigo Money became AT Money
-- inside this project's lifetime, and an enum value cannot be renamed without
-- a migration. `provider_code` is validated in the DTO against a constant
-- list instead.
DO $$ BEGIN
  ALTER TABLE fee_payments
  ADD CONSTRAINT chk_fee_payment_provider
  CHECK (
    (method = 'mobile_money' AND provider_code IS NOT NULL)
    OR
    (method <> 'mobile_money' AND provider_code IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A payment is positive; a REVERSAL is negative and names what it reverses.
-- This is what lets the ledger be one clean SUM with no exclusion subquery:
-- reversals net themselves out.
DO $$ BEGIN
  ALTER TABLE fee_payments
  ADD CONSTRAINT chk_fee_payment_amount_sign
  CHECK (
    (reverses_payment_id IS NULL AND amount > 0)
    OR
    (reverses_payment_id IS NOT NULL AND amount < 0)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A payment may be reversed at most ONCE. Partial, because the column is null
-- for ordinary payments and they must not collide with each other — the same
-- shape and the same reason as uq_one_active_enrollment_per_student_year.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_reversal_per_payment
ON fee_payments (reverses_payment_id)
WHERE reverses_payment_id IS NOT NULL;

-- ── The invoice rule that makes an issued document meaningful ───────────────
--
-- A fee assignment sits on at most ONE LIVE (non-cancelled) invoice. Without
-- it the same debt can be formally billed twice and two invoices would each
-- derive a payment state from the same payments.
--
-- `voided_at` on invoice_lines exists SOLELY to make this expressible: the
-- cancelled state lives on `invoices`, and a partial index predicate cannot
-- reach into another table. The flag is written in the same transaction as
-- the parent cancel, has exactly one writer, and is never money.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_live_invoice_line_per_assignment
ON invoice_lines (fee_assignment_id)
WHERE voided_at IS NULL;

-- Fee type names unique per school, CASE-INSENSITIVELY. Same shape and same
-- reason as uq_label_school_category_name_lower: Prisma cannot express an
-- expression index, so `model FeeType` declares no unique at all and this is
-- the single rule.
--
-- Not merely cosmetic: the fee ledger groups by fee type, so "Tuition" and
-- "tuition" existing side by side would split one account into two and give
-- the school two answers to "what has Tuition collected this term".
CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_type_school_name_lower
ON fee_types (school_id, lower(name));

-- ── Notification idempotency ────────────────────────────────────────────────
--
-- A double-clicked "Send reminders" costs ONE duplicate-key error, not 300
-- duplicate messages at full price. This has to hold at the DATABASE and not
-- in a service check, because the whole point is defending against a
-- concurrent retry — two requests both passing an application-level "does one
-- exist?" test is exactly the race it exists to lose.
--
-- Partial, because `dedupe_key` is null for messages that are legitimately
-- unconstrained (an ad-hoc announcement), and those must not collide with
-- each other. Same shape and same reason as
-- uq_one_active_enrollment_per_student_year.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_dedupe
ON notification_messages (school_id, dedupe_key)
WHERE dedupe_key IS NOT NULL;
