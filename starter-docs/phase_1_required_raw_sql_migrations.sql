-- Brite SMS — Phase 1 raw-SQL objects.
--
-- Everything Prisma cannot express: partial unique indexes, expression
-- uniques, CHECK constraints, and the audit-log immutability trigger. Applied
-- by `npm run db:raw-sql` (scripts/apply-raw-migration.js), which applies this
-- file and then every later phase's file, in order.
--
-- SCOPE: this file holds the PHASE 1 set only, and it stays that way. Phase 2
-- and later objects live in their own per-phase files so this one's name never
-- becomes a lie and the Phase 1 handoff documents that name it stay accurate.
-- The COMPLETE inventory across all phases is the table in ../README.md.
--
-- IDEMPOTENT: every statement below is safe to re-run. `db:setup` and the
-- post-migration belt-and-braces re-run both depend on that. Keep it true —
-- indexes use IF NOT EXISTS, constraints are wrapped in a duplicate_object
-- guard, and triggers use CREATE OR REPLACE (PostgreSQL 14+, the documented
-- minimum).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Partial / expression unique indexes ─────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_email_lower
ON users (school_id, lower(email))
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_phone
ON users (school_id, phone)
WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_linked_entity
ON users (school_id, linked_entity_type, linked_entity_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_school_email_lower
ON staff (school_id, lower(email))
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_role_code
ON roles (code)
WHERE school_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_role_code
ON roles (school_id, code)
WHERE school_id IS NOT NULL;

-- (uq_admission_school_number was removed 2026-08-14: admission-number
-- uniqueness is now owned by the Prisma schema —
-- @@unique([schoolId, admissionNumber]) → index
-- admission_applications_school_id_admission_number_key, functionally
-- identical for NULL and non-NULL values.)

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_academic_year_per_school
ON academic_years (school_id)
WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_term_per_school
ON terms (school_id)
WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_primary_guardian_per_student
ON student_guardians (student_id)
WHERE is_primary = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_enrollment_per_student_year
ON enrollments (student_id, academic_year_id)
WHERE status = 'active';

-- ── CHECK constraints ───────────────────────────────────────────────────────
-- ALTER TABLE … ADD CONSTRAINT has no IF NOT EXISTS, so each one is wrapped in
-- the standard duplicate_object guard.

DO $$ BEGIN
  ALTER TABLE academic_years
  ADD CONSTRAINT chk_academic_year_dates
  CHECK (end_date > start_date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE terms
  ADD CONSTRAINT chk_term_number
  CHECK (term_number BETWEEN 1 AND 4);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE terms
  ADD CONSTRAINT chk_term_dates
  CHECK (end_date > start_date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE terms
  ADD CONSTRAINT chk_exam_dates
  CHECK (
    (exam_start_date IS NULL AND exam_end_date IS NULL)
    OR
    (
      exam_start_date IS NOT NULL
      AND exam_end_date IS NOT NULL
      AND exam_end_date >= exam_start_date
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE classrooms
  ADD CONSTRAINT chk_classroom_capacity
  CHECK (capacity IS NULL OR capacity > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE document_sequences
  ADD CONSTRAINT chk_document_sequence_current_number
  CHECK (current_number >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE document_sequences
  ADD CONSTRAINT chk_document_sequence_padding_length
  CHECK (padding_length >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE files
  ADD CONSTRAINT chk_file_size
  CHECK (size_bytes > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users
  ADD CONSTRAINT chk_user_email_or_phone
  CHECK (email IS NOT NULL OR phone IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE auth_tokens
  ADD CONSTRAINT chk_auth_token_contact_or_user
  CHECK (user_id IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Audit-log immutability ──────────────────────────────────────────────────
-- The audit trail is immutable by design. Do not "fix" this.

CREATE OR REPLACE FUNCTION prevent_audit_log_changes()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_prevent_audit_log_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_changes();

CREATE OR REPLACE TRIGGER trg_prevent_audit_log_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_changes();
