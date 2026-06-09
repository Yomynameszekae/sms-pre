CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE UNIQUE INDEX uq_users_school_email_lower
ON users (school_id, lower(email))
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX uq_users_school_phone
ON users (school_id, phone)
WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX uq_users_school_linked_entity
ON users (school_id, linked_entity_type, linked_entity_id);

CREATE UNIQUE INDEX uq_staff_school_email_lower
ON staff (school_id, lower(email))
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX uq_system_role_code
ON roles (code)
WHERE school_id IS NULL;

CREATE UNIQUE INDEX uq_school_role_code
ON roles (school_id, code)
WHERE school_id IS NOT NULL;

CREATE UNIQUE INDEX uq_admission_school_number
ON admission_applications (school_id, admission_number)
WHERE admission_number IS NOT NULL;

CREATE UNIQUE INDEX uq_one_active_academic_year_per_school
ON academic_years (school_id)
WHERE is_active = TRUE;

CREATE UNIQUE INDEX uq_one_active_term_per_school
ON terms (school_id)
WHERE status = 'active';

CREATE UNIQUE INDEX uq_one_primary_guardian_per_student
ON student_guardians (student_id)
WHERE is_primary = TRUE;

CREATE UNIQUE INDEX uq_one_active_enrollment_per_student_year
ON enrollments (student_id, academic_year_id)
WHERE status = 'active';

ALTER TABLE academic_years
ADD CONSTRAINT chk_academic_year_dates
CHECK (end_date > start_date);

ALTER TABLE terms
ADD CONSTRAINT chk_term_number
CHECK (term_number BETWEEN 1 AND 4);

ALTER TABLE terms
ADD CONSTRAINT chk_term_dates
CHECK (end_date > start_date);

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

ALTER TABLE classrooms
ADD CONSTRAINT chk_classroom_capacity
CHECK (capacity IS NULL OR capacity > 0);

ALTER TABLE document_sequences
ADD CONSTRAINT chk_document_sequence_current_number
CHECK (current_number >= 0);

ALTER TABLE document_sequences
ADD CONSTRAINT chk_document_sequence_padding_length
CHECK (padding_length >= 0);

ALTER TABLE files
ADD CONSTRAINT chk_file_size
CHECK (size_bytes > 0);

ALTER TABLE users
ADD CONSTRAINT chk_user_email_or_phone
CHECK (email IS NOT NULL OR phone IS NOT NULL);

ALTER TABLE auth_tokens
ADD CONSTRAINT chk_auth_token_contact_or_user
CHECK (user_id IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL);

CREATE OR REPLACE FUNCTION prevent_audit_log_changes()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_audit_log_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_changes();

CREATE TRIGGER trg_prevent_audit_log_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_changes();
