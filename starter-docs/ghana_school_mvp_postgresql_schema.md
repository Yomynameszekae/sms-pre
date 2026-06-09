# Ghanaian Private School Management System — MVP PostgreSQL Schema

This document converts the MVP data model for the Ghanaian private school management system into a normalized PostgreSQL schema.

The system is a web-based School Management System for a private basic school in Ghana from Creche/Nursery through JHS, supporting both GES/NaCCA and ABEKA curricula. The MVP is single-school, but the schema is designed with future multi-tenant readiness.

## Architecture Context

```txt
Frontend: Next.js + TypeScript
Backend: NestJS + TypeScript
Database: PostgreSQL
ORM: Prisma
Auth: JWT/session-based auth
Queue: Redis + BullMQ
Storage: S3-compatible object storage
Payments: one gateway first, Paystack or Hubtel
SMS: one provider first, with provider abstraction
```

---

# 1. Schema Design Overview

The schema is designed as a **single-school MVP** but with **future multi-tenant readiness**. That means most business tables include `school_id`, even though the first version will only contain one school.

The design uses:

```txt
Primary keys: UUID
Database: PostgreSQL
Money: integer pesewas
Tenant key: school_id
Soft delete: archived_at / deleted_at depending on record type
Audit fields: created_at, updated_at, created_by, updated_by
Sensitive fields: encrypted at application layer
Report card results: stored as JSONB snapshots
Payment webhooks: logged and idempotent
```

The PRD warns that grading formulas, SBA weights, ABEKA GPA scales, and report card formats must be configurable and verified with the school before implementation. So this schema avoids hardcoded grading logic.

---

# 2. Entity Relationship Summary

```txt
School
 ├── AcademicYears
 │    └── Terms
 ├── Levels
 │    └── Classrooms
 ├── CurriculumTracks
 │    └── Subjects
 ├── Staff
 │    ├── Users
 │    ├── Class teacher assignments
 │    └── Subject teacher assignments
 ├── Students
 │    ├── Guardians through StudentGuardian
 │    ├── Admissions
 │    ├── Enrollments
 │    ├── Attendance records
 │    ├── Assessment scores
 │    ├── Report cards
 │    ├── Invoices
 │    └── Payments
 ├── Guardians
 │    ├── Users
 │    └── Linked students through StudentGuardian
 ├── Fees
 │    ├── FeeItems
 │    ├── FeeSchedules
 │    ├── Invoices
 │    ├── InvoiceLineItems
 │    └── Payments
 ├── Notifications
 │    └── NotificationRecipients
 ├── Files
 ├── ConsentRecords
 ├── AuditLogs
 ├── DataSubjectRequests
 └── SecurityIncidentLogs
```

Important access-control relationships:

```txt
Parent access:
guardian -> student_guardians -> students

Class teacher access:
staff -> classrooms.class_teacher_id -> enrollments -> students

Subject teacher access:
staff -> subject_assignments -> class_subjects -> subjects/classes

Bursar access:
role_permissions -> finance permissions

Admin access:
role_permissions -> module permissions
```

---

# 3. PostgreSQL ENUM Types

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE gender_type AS ENUM ('male', 'female', 'other');
CREATE TYPE record_status AS ENUM ('active', 'inactive', 'archived');

CREATE TYPE term_status AS ENUM ('draft', 'active', 'closed');
CREATE TYPE curriculum_code AS ENUM ('GES_NACCA', 'ABEKA');
CREATE TYPE curriculum_scope AS ENUM ('GES_NACCA', 'ABEKA', 'BOTH');

CREATE TYPE level_group AS ENUM (
  'CRECHE',
  'NURSERY',
  'KG',
  'LOWER_PRIMARY',
  'UPPER_PRIMARY',
  'JHS'
);

CREATE TYPE staff_status AS ENUM ('active', 'on_leave', 'resigned', 'terminated');
CREATE TYPE staff_role_category AS ENUM ('teacher', 'admin', 'support');
CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'contract');
CREATE TYPE ntc_status AS ENUM ('licensed', 'induction', 'unlicensed', 'not_applicable');

CREATE TYPE linked_entity_type AS ENUM ('staff', 'guardian');
CREATE TYPE admission_status AS ENUM ('enquiry', 'application', 'offered', 'rejected', 'enrolled');

CREATE TYPE enrollment_status AS ENUM (
  'active',
  'transferred',
  'withdrawn',
  'completed',
  'graduated'
);

CREATE TYPE promotion_decision AS ENUM (
  'promoted',
  'retained',
  'graduated',
  'withdrawn'
);

CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
CREATE TYPE attendance_session_status AS ENUM ('draft', 'submitted', 'locked');

CREATE TYPE assessment_category AS ENUM ('formative', 'summative', 'exam', 'milestone');

CREATE TYPE report_card_status AS ENUM ('draft', 'review', 'approved', 'published');
CREATE TYPE report_template_type AS ENUM (
  'GES_PRIMARY',
  'GES_JHS',
  'ABEKA',
  'ECE_DEVELOPMENTAL'
);

CREATE TYPE invoice_status AS ENUM ('unpaid', 'partial', 'paid', 'waived', 'void');
CREATE TYPE payment_method AS ENUM (
  'cash',
  'bank_deposit',
  'cheque',
  'mobile_money',
  'manual_momo'
);
CREATE TYPE payment_gateway AS ENUM ('paystack', 'hubtel');
CREATE TYPE payment_intent_status AS ENUM ('pending', 'successful', 'failed', 'expired', 'cancelled');

CREATE TYPE notification_type AS ENUM (
  'announcement',
  'fee_reminder',
  'report_ready',
  'absence_alert',
  'payment_receipt',
  'account_setup',
  'password_reset'
);
CREATE TYPE notification_channel AS ENUM ('sms', 'portal', 'email');
CREATE TYPE notification_recipient_status AS ENUM ('pending', 'sent', 'failed', 'cancelled');

CREATE TYPE file_owner_type AS ENUM (
  'school',
  'student',
  'guardian',
  'staff',
  'report_card',
  'invoice',
  'payment',
  'consent',
  'security_incident'
);

CREATE TYPE consent_type AS ENUM ('educational_processing', 'marketing', 'third_party_sharing');
CREATE TYPE consent_method AS ENUM ('checkbox', 'otp', 'signature', 'paper_form');

CREATE TYPE data_request_type AS ENUM ('access', 'correction', 'erasure', 'export');
CREATE TYPE request_status AS ENUM ('open', 'in_review', 'resolved', 'rejected');

CREATE TYPE security_incident_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE security_incident_status AS ENUM ('open', 'investigating', 'contained', 'resolved');

CREATE TYPE backup_status AS ENUM ('pending', 'running', 'successful', 'failed');
```

---

# 4. Full Table Definitions Grouped by Module

## 4.1 School Setup

### Table: `schools`

**Purpose:** Stores the school profile. MVP is single-school, but this table becomes the tenant table later.

```sql
CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  logo_url TEXT,
  address TEXT,
  ghana_post_gps VARCHAR(50),
  phone VARCHAR(30),
  email VARCHAR(150),
  motto VARCHAR(255),
  registration_number VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX idx_schools_is_active ON schools(is_active);
```

---

## 4.2 Academic Years and Terms

### Table: `academic_years`

**Purpose:** Stores academic years, for example `2026/2027`.

```sql
CREATE TABLE academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  label VARCHAR(20) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_academic_year_school_label UNIQUE (school_id, label),
  CONSTRAINT chk_academic_year_dates CHECK (end_date > start_date)
);

CREATE UNIQUE INDEX uq_one_active_academic_year_per_school
ON academic_years(school_id)
WHERE is_active = TRUE;

CREATE INDEX idx_academic_years_school_id ON academic_years(school_id);
```

### Table: `terms`

**Purpose:** Supports GES 3-term calendar in MVP, while allowing ABEKA-related term/quarter metadata later.

```sql
CREATE TABLE terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),

  term_number SMALLINT NOT NULL,
  label VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  exam_start_date DATE,
  exam_end_date DATE,
  status term_status NOT NULL DEFAULT 'draft',
  curriculum_scope curriculum_scope NOT NULL DEFAULT 'BOTH',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_term_academic_year_number UNIQUE (academic_year_id, term_number),
  CONSTRAINT chk_term_number CHECK (term_number BETWEEN 1 AND 4),
  CONSTRAINT chk_term_dates CHECK (end_date > start_date),
  CONSTRAINT chk_exam_dates CHECK (
    exam_start_date IS NULL
    OR exam_end_date IS NULL
    OR exam_end_date >= exam_start_date
  )
);

CREATE INDEX idx_terms_school_id ON terms(school_id);
CREATE INDEX idx_terms_academic_year_id ON terms(academic_year_id);
CREATE INDEX idx_terms_status ON terms(status);
```

---

## 4.3 Levels, Classes, and Streams

### Table: `levels`

**Purpose:** Models Creche/Nursery through JHS, including mappings to GES and ABEKA designations.

```sql
CREATE TABLE levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  name VARCHAR(100) NOT NULL,
  ges_designation VARCHAR(100),
  abeka_designation VARCHAR(100),
  order_index SMALLINT NOT NULL,
  level_group level_group NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_level_school_name UNIQUE (school_id, name),
  CONSTRAINT uq_level_school_order UNIQUE (school_id, order_index)
);

CREATE INDEX idx_levels_school_id ON levels(school_id);
CREATE INDEX idx_levels_group ON levels(level_group);
```

### Table: `classrooms`

**Purpose:** Models specific class sections or streams, such as Basic 4A and Basic 4B.

```sql
CREATE TABLE classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  level_id UUID NOT NULL REFERENCES levels(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),

  section_label VARCHAR(20) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  capacity SMALLINT,
  class_teacher_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_classroom_level_year_section UNIQUE (
    level_id,
    academic_year_id,
    section_label
  ),
  CONSTRAINT chk_classroom_capacity CHECK (capacity IS NULL OR capacity > 0)
);

CREATE INDEX idx_classrooms_school_id ON classrooms(school_id);
CREATE INDEX idx_classrooms_level_id ON classrooms(level_id);
CREATE INDEX idx_classrooms_academic_year_id ON classrooms(academic_year_id);
CREATE INDEX idx_classrooms_class_teacher_id ON classrooms(class_teacher_id);
```

The foreign key from `classrooms.class_teacher_id` to `staff.id` should be added after the `staff` table is created.

---

## 4.4 Users, Roles, and Permissions

### Table: `users`

**Purpose:** Supports staff and parent login.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  email VARCHAR(150),
  phone VARCHAR(30),
  password_hash TEXT NOT NULL,
  linked_entity_type linked_entity_type NOT NULL,
  linked_entity_id UUID NOT NULL,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  refresh_token_hash TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT chk_user_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX uq_users_school_email
ON users(school_id, lower(email))
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX uq_users_school_phone
ON users(school_id, phone)
WHERE phone IS NOT NULL;

CREATE INDEX idx_users_school_id ON users(school_id);
CREATE INDEX idx_users_linked_entity ON users(linked_entity_type, linked_entity_id);
```

### Table: `roles`

**Purpose:** Stores school-scoped and system-level roles.

```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),

  name VARCHAR(100) NOT NULL,
  code VARCHAR(100) NOT NULL,
  description TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_roles_school_code UNIQUE (school_id, code)
);

CREATE INDEX idx_roles_school_id ON roles(school_id);
```

### Table: `permissions`

**Purpose:** Stores permission keys used by backend guards.

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(150) NOT NULL UNIQUE,
  module VARCHAR(100) NOT NULL,
  description TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Table: `role_permissions`

**Purpose:** Junction table between roles and permissions.

```sql
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);
```

### Table: `user_roles`

**Purpose:** Assigns one or more roles to a user.

```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),

  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_user_role UNIQUE (user_id, role_id)
);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);
```

---

## 4.5 Staff Records

### Table: `staff`

**Purpose:** Stores staff and compliance-related records such as NTC status, police clearance, and medical certificate expiry.

```sql
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  staff_number VARCHAR(50) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(150),
  photo_url TEXT,

  role_category staff_role_category NOT NULL,
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  status staff_status NOT NULL DEFAULT 'active',

  ntc_registration_number VARCHAR(100),
  ntc_status ntc_status NOT NULL DEFAULT 'not_applicable',
  police_clearance_date DATE,
  police_clearance_expiry DATE,
  medical_cert_date DATE,
  medical_cert_expiry DATE,

  joined_at DATE,
  archived_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_staff_school_number UNIQUE (school_id, staff_number)
);

CREATE UNIQUE INDEX uq_staff_school_email
ON staff(school_id, lower(email))
WHERE email IS NOT NULL;

CREATE INDEX idx_staff_school_id ON staff(school_id);
CREATE INDEX idx_staff_status ON staff(status);
CREATE INDEX idx_staff_ntc_status ON staff(ntc_status);

ALTER TABLE classrooms
ADD CONSTRAINT fk_classrooms_class_teacher
FOREIGN KEY (class_teacher_id) REFERENCES staff(id);
```

---

## 4.6 Students and Guardians

### Table: `students`

**Purpose:** Stores core student identity records. Ghana Card is optional in MVP.

```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  student_number VARCHAR(50) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  preferred_name VARCHAR(100),
  date_of_birth DATE NOT NULL,
  gender gender_type NOT NULL,
  nationality VARCHAR(100),
  religion VARCHAR(100),

  ghana_card_id VARCHAR(50),
  profile_photo_url TEXT,
  previous_school VARCHAR(200),

  -- Encrypt/decrypt in application layer.
  medical_alerts_encrypted TEXT,

  admission_date DATE,
  status enrollment_status NOT NULL DEFAULT 'active',
  archived_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_students_school_student_number UNIQUE (school_id, student_number)
);

CREATE INDEX idx_students_school_id ON students(school_id);
CREATE INDEX idx_students_status ON students(status);
CREATE INDEX idx_students_name ON students(last_name, first_name);
CREATE INDEX idx_students_ghana_card_id ON students(ghana_card_id)
WHERE ghana_card_id IS NOT NULL;
```

### Table: `guardians`

**Purpose:** Stores parent/guardian information.

```sql
CREATE TABLE guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  relationship VARCHAR(50),
  phone_primary VARCHAR(30) NOT NULL,
  phone_secondary VARCHAR(30),
  email VARCHAR(150),
  occupation VARCHAR(150),
  address TEXT,

  archived_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX idx_guardians_school_id ON guardians(school_id);
CREATE INDEX idx_guardians_phone_primary ON guardians(phone_primary);

CREATE UNIQUE INDEX uq_guardians_school_phone_primary
ON guardians(school_id, phone_primary);
```

### Table: `student_guardians`

**Purpose:** Junction table supporting many-to-many student and guardian relationships.

```sql
CREATE TABLE student_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  relationship VARCHAR(50),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_emergency_contact BOOLEAN NOT NULL DEFAULT FALSE,
  can_receive_sms BOOLEAN NOT NULL DEFAULT TRUE,
  can_access_portal BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,

  CONSTRAINT uq_student_guardian UNIQUE (student_id, guardian_id)
);

CREATE INDEX idx_student_guardians_school_id ON student_guardians(school_id);
CREATE INDEX idx_student_guardians_student_id ON student_guardians(student_id);
CREATE INDEX idx_student_guardians_guardian_id ON student_guardians(guardian_id);

CREATE UNIQUE INDEX uq_one_primary_guardian_per_student
ON student_guardians(student_id)
WHERE is_primary = TRUE;
```

---

## 4.7 Admissions

### Table: `admission_applications`

**Purpose:** Tracks enquiries and application status before enrollment.

```sql
CREATE TABLE admission_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  student_id UUID REFERENCES students(id),
  intended_level_id UUID REFERENCES levels(id),
  curriculum_interest curriculum_scope NOT NULL DEFAULT 'BOTH',

  enquiry_source VARCHAR(100),
  status admission_status NOT NULL DEFAULT 'enquiry',
  notes TEXT,

  application_date DATE NOT NULL DEFAULT CURRENT_DATE,
  offered_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX idx_admission_applications_school_id ON admission_applications(school_id);
CREATE INDEX idx_admission_applications_status ON admission_applications(status);
CREATE INDEX idx_admission_applications_student_id ON admission_applications(student_id);
```

---

## 4.8 Enrollments and Promotions

### Table: `enrollments`

**Purpose:** Links a student to a class, academic year, and primary curriculum track.

```sql
CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  student_id UUID NOT NULL REFERENCES students(id),
  classroom_id UUID NOT NULL REFERENCES classrooms(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  curriculum_track curriculum_code NOT NULL,

  enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status enrollment_status NOT NULL DEFAULT 'active',
  exit_date DATE,
  exit_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_student_academic_year_primary_track UNIQUE (
    student_id,
    academic_year_id,
    curriculum_track
  )
);

CREATE INDEX idx_enrollments_school_id ON enrollments(school_id);
CREATE INDEX idx_enrollments_student_id ON enrollments(student_id);
CREATE INDEX idx_enrollments_classroom_id ON enrollments(classroom_id);
CREATE INDEX idx_enrollments_academic_year_id ON enrollments(academic_year_id);
CREATE INDEX idx_enrollments_status ON enrollments(status);
```

This allows future dual-track support because a student could later have one enrollment for `GES_NACCA` and another for `ABEKA`, but the MVP should only create one active primary enrollment per student unless the school confirms true parallel gradebooks.

### Table: `promotion_records`

**Purpose:** Stores end-of-year promotion, retention, graduation, and withdrawal decisions.

```sql
CREATE TABLE promotion_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  student_id UUID NOT NULL REFERENCES students(id),
  from_classroom_id UUID NOT NULL REFERENCES classrooms(id),
  to_classroom_id UUID REFERENCES classrooms(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),

  decision promotion_decision NOT NULL,
  reason TEXT,
  approved_by UUID REFERENCES staff(id),
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

CREATE INDEX idx_promotion_records_school_id ON promotion_records(school_id);
CREATE INDEX idx_promotion_records_student_id ON promotion_records(student_id);
CREATE INDEX idx_promotion_records_academic_year_id ON promotion_records(academic_year_id);
```

---

## 4.9 Curriculum Tracks and Subjects

### Table: `curriculum_tracks`

**Purpose:** Stores curriculum tracks supported by the school.

```sql
CREATE TABLE curriculum_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  code curriculum_code NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_curriculum_track_school_code UNIQUE (school_id, code)
);

CREATE INDEX idx_curriculum_tracks_school_id ON curriculum_tracks(school_id);
```

### Table: `subjects`

**Purpose:** Stores school subjects for GES/NaCCA and ABEKA without hardcoding subject behavior.

```sql
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  curriculum_track_id UUID NOT NULL REFERENCES curriculum_tracks(id),

  name VARCHAR(150) NOT NULL,
  code VARCHAR(50) NOT NULL,
  level_group_applicability JSONB NOT NULL DEFAULT '[]'::jsonb,
  credit_hours NUMERIC(5,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_subject_school_track_code UNIQUE (school_id, curriculum_track_id, code),
  CONSTRAINT chk_subject_credit_hours CHECK (credit_hours IS NULL OR credit_hours >= 0)
);

CREATE INDEX idx_subjects_school_id ON subjects(school_id);
CREATE INDEX idx_subjects_curriculum_track_id ON subjects(curriculum_track_id);
CREATE INDEX idx_subjects_level_group_applicability
ON subjects USING GIN(level_group_applicability);
```

### Table: `class_subjects`

**Purpose:** Links subjects to a classroom for a specific term.

```sql
CREATE TABLE class_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  classroom_id UUID NOT NULL REFERENCES classrooms(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_class_subject_term UNIQUE (classroom_id, subject_id, term_id)
);

CREATE INDEX idx_class_subjects_school_id ON class_subjects(school_id);
CREATE INDEX idx_class_subjects_classroom_id ON class_subjects(classroom_id);
CREATE INDEX idx_class_subjects_subject_id ON class_subjects(subject_id);
CREATE INDEX idx_class_subjects_term_id ON class_subjects(term_id);
```

---

## 4.10 Teacher Assignments

### Table: `subject_assignments`

**Purpose:** Controls teacher access to classes and subjects.

```sql
CREATE TABLE subject_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  staff_id UUID NOT NULL REFERENCES staff(id),
  class_subject_id UUID NOT NULL REFERENCES class_subjects(id),
  term_id UUID NOT NULL REFERENCES terms(id),

  is_primary_teacher BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_subject_assignment UNIQUE (staff_id, class_subject_id, term_id)
);

CREATE INDEX idx_subject_assignments_school_id ON subject_assignments(school_id);
CREATE INDEX idx_subject_assignments_staff_id ON subject_assignments(staff_id);
CREATE INDEX idx_subject_assignments_class_subject_id ON subject_assignments(class_subject_id);
CREATE INDEX idx_subject_assignments_term_id ON subject_assignments(term_id);
```

---

## 4.11 Attendance

### Table: `attendance_sessions`

**Purpose:** Stores daily attendance sessions per class.

```sql
CREATE TABLE attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  classroom_id UUID NOT NULL REFERENCES classrooms(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  attendance_date DATE NOT NULL,
  recorded_by UUID NOT NULL REFERENCES staff(id),
  status attendance_session_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_attendance_session_class_date UNIQUE (classroom_id, attendance_date)
);

CREATE INDEX idx_attendance_sessions_school_id ON attendance_sessions(school_id);
CREATE INDEX idx_attendance_sessions_classroom_id ON attendance_sessions(classroom_id);
CREATE INDEX idx_attendance_sessions_term_id ON attendance_sessions(term_id);
CREATE INDEX idx_attendance_sessions_date ON attendance_sessions(attendance_date);
```

### Table: `attendance_records`

**Purpose:** Stores individual attendance status per enrolled student.

```sql
CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  attendance_session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id),
  status attendance_status NOT NULL DEFAULT 'present',
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_attendance_record_session_enrollment UNIQUE (
    attendance_session_id,
    enrollment_id
  )
);

CREATE INDEX idx_attendance_records_school_id ON attendance_records(school_id);
CREATE INDEX idx_attendance_records_enrollment_id ON attendance_records(enrollment_id);
CREATE INDEX idx_attendance_records_status ON attendance_records(status);
```

### Table: `attendance_lock_settings`

**Purpose:** Configures how many days after attendance date entries should be locked.

```sql
CREATE TABLE attendance_lock_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  term_id UUID NOT NULL REFERENCES terms(id),

  lock_after_days SMALLINT NOT NULL DEFAULT 3,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_attendance_lock_term UNIQUE (term_id),
  CONSTRAINT chk_attendance_lock_days CHECK (lock_after_days >= 0)
);
```

---

## 4.12 Assessment Types and Scores

### Table: `assessment_types`

**Purpose:** Configurable assessment components for GES/NaCCA, ABEKA, and ECE milestone reports.

```sql
CREATE TABLE assessment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  curriculum_track_id UUID NOT NULL REFERENCES curriculum_tracks(id),

  name VARCHAR(150) NOT NULL,
  code VARCHAR(80) NOT NULL,
  level_group level_group NOT NULL,
  max_score INTEGER NOT NULL,
  weight_percentage NUMERIC(5,2),
  assessment_category assessment_category NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_assessment_type_school_track_code_group UNIQUE (
    school_id,
    curriculum_track_id,
    code,
    level_group
  ),
  CONSTRAINT chk_assessment_max_score CHECK (max_score > 0),
  CONSTRAINT chk_assessment_weight CHECK (
    weight_percentage IS NULL
    OR (weight_percentage >= 0 AND weight_percentage <= 100)
  )
);

CREATE INDEX idx_assessment_types_school_id ON assessment_types(school_id);
CREATE INDEX idx_assessment_types_curriculum_track_id ON assessment_types(curriculum_track_id);
CREATE INDEX idx_assessment_types_level_group ON assessment_types(level_group);
```

### Table: `assessment_scores`

**Purpose:** Stores raw score entries per student, subject, assessment type, and term.

```sql
CREATE TABLE assessment_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  enrollment_id UUID NOT NULL REFERENCES enrollments(id),
  subject_id UUID NOT NULL REFERENCES subjects(id),
  assessment_type_id UUID NOT NULL REFERENCES assessment_types(id),
  term_id UUID NOT NULL REFERENCES terms(id),

  raw_score NUMERIC(7,2) NOT NULL,
  max_score NUMERIC(7,2) NOT NULL,
  recorded_by UUID NOT NULL REFERENCES staff(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_assessment_score UNIQUE (
    enrollment_id,
    subject_id,
    assessment_type_id,
    term_id
  ),
  CONSTRAINT chk_assessment_score_raw CHECK (raw_score >= 0),
  CONSTRAINT chk_assessment_score_max CHECK (max_score > 0),
  CONSTRAINT chk_assessment_score_not_above_max CHECK (raw_score <= max_score)
);

CREATE INDEX idx_assessment_scores_school_id ON assessment_scores(school_id);
CREATE INDEX idx_assessment_scores_enrollment_id ON assessment_scores(enrollment_id);
CREATE INDEX idx_assessment_scores_subject_id ON assessment_scores(subject_id);
CREATE INDEX idx_assessment_scores_term_id ON assessment_scores(term_id);
CREATE INDEX idx_assessment_scores_recorded_by ON assessment_scores(recorded_by);
```

---

## 4.13 Grading Scales and Grading Formulas

### Table: `grading_scales`

**Purpose:** Stores score-to-grade mappings, descriptors, and GPA values where applicable.

```sql
CREATE TABLE grading_scales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  curriculum_track_id UUID NOT NULL REFERENCES curriculum_tracks(id),

  level_group level_group NOT NULL,
  min_score NUMERIC(5,2) NOT NULL,
  max_score NUMERIC(5,2) NOT NULL,
  letter_grade VARCHAR(20),
  descriptor VARCHAR(150),
  gpa_value NUMERIC(4,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT chk_grading_scale_range CHECK (
    min_score >= 0
    AND max_score <= 100
    AND max_score >= min_score
  )
);

CREATE INDEX idx_grading_scales_school_track_group
ON grading_scales(school_id, curriculum_track_id, level_group);
```

### Table: `grading_formula_configs`

**Purpose:** Stores configurable grading formulas. This avoids hardcoded SBA, exam, profile dimension, ABEKA letter grade, and GPA logic.

```sql
CREATE TABLE grading_formula_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  curriculum_track_id UUID NOT NULL REFERENCES curriculum_tracks(id),

  level_group level_group NOT NULL,
  subject_id UUID REFERENCES subjects(id),
  name VARCHAR(150) NOT NULL,

  -- Example:
  -- {
  --   "components": [
  --     {"assessment_type_code": "SBA", "weight": 50},
  --     {"assessment_type_code": "END_TERM_EXAM", "weight": 50}
  --   ],
  --   "rounding": "nearest_integer"
  -- }
  formula_json JSONB NOT NULL,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX idx_grading_formula_school_track_group
ON grading_formula_configs(school_id, curriculum_track_id, level_group);

CREATE INDEX idx_grading_formula_subject_id
ON grading_formula_configs(subject_id);

CREATE INDEX idx_grading_formula_json
ON grading_formula_configs USING GIN(formula_json);
```

---

## 4.14 Report Cards and Report Card Templates

### Table: `report_card_templates`

**Purpose:** Stores configurable report card layouts and display rules.

```sql
CREATE TABLE report_card_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  curriculum_track_id UUID REFERENCES curriculum_tracks(id),

  name VARCHAR(150) NOT NULL,
  template_type report_template_type NOT NULL,
  level_group level_group NOT NULL,

  -- Stores layout blocks, columns, grading display rules, remarks fields, etc.
  template_config JSONB NOT NULL,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_report_template_school_name UNIQUE (school_id, name)
);

CREATE INDEX idx_report_templates_school_id ON report_card_templates(school_id);
CREATE INDEX idx_report_templates_type ON report_card_templates(template_type);
CREATE INDEX idx_report_templates_config ON report_card_templates USING GIN(template_config);
```

### Table: `report_cards`

**Purpose:** Stores report card records and immutable computed snapshots so old reports do not change if grading settings change later.

```sql
CREATE TABLE report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  enrollment_id UUID NOT NULL REFERENCES enrollments(id),
  student_id UUID NOT NULL REFERENCES students(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  curriculum_track_id UUID NOT NULL REFERENCES curriculum_tracks(id),
  template_id UUID REFERENCES report_card_templates(id),

  -- Snapshot: subject scores, grade descriptors, GPA, attendance, remarks, promotion status.
  computed_grades JSONB NOT NULL,
  attendance_summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  overall_grade VARCHAR(50),
  gpa NUMERIC(4,2),

  teacher_remarks TEXT,
  headteacher_remarks TEXT,
  conduct_rating VARCHAR(100),

  status report_card_status NOT NULL DEFAULT 'draft',
  approved_by UUID REFERENCES staff(id),
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_report_card_enrollment_term UNIQUE (enrollment_id, term_id)
);

CREATE INDEX idx_report_cards_school_id ON report_cards(school_id);
CREATE INDEX idx_report_cards_student_id ON report_cards(student_id);
CREATE INDEX idx_report_cards_term_id ON report_cards(term_id);
CREATE INDEX idx_report_cards_status ON report_cards(status);
CREATE INDEX idx_report_cards_computed_grades ON report_cards USING GIN(computed_grades);
```

### Table: `report_card_files`

**Purpose:** Links generated report card PDFs to report card records.

```sql
CREATE TABLE report_card_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  report_card_id UUID NOT NULL REFERENCES report_cards(id) ON DELETE CASCADE,

  file_id UUID NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by UUID REFERENCES users(id),

  CONSTRAINT uq_report_card_file UNIQUE (report_card_id, file_id)
);

CREATE INDEX idx_report_card_files_report_card_id ON report_card_files(report_card_id);
```

The `file_id` foreign key should be added after the `files` table is created.

---

## 4.15 Fees, Invoices, Discounts, and Payments

### Table: `fee_items`

**Purpose:** Stores fee categories/items such as tuition, feeding, books, uniforms, examination, and miscellaneous charges.

```sql
CREATE TABLE fee_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  name VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_fee_item_school_name UNIQUE (school_id, name)
);

CREATE INDEX idx_fee_items_school_id ON fee_items(school_id);
```

### Table: `fee_schedules`

**Purpose:** Stores term and level-specific fee amounts.

```sql
CREATE TABLE fee_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  fee_item_id UUID NOT NULL REFERENCES fee_items(id),
  level_id UUID NOT NULL REFERENCES levels(id),
  term_id UUID NOT NULL REFERENCES terms(id),

  amount_pesewas INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_fee_schedule_item_level_term UNIQUE (fee_item_id, level_id, term_id),
  CONSTRAINT chk_fee_schedule_amount CHECK (amount_pesewas >= 0)
);

CREATE INDEX idx_fee_schedules_school_id ON fee_schedules(school_id);
CREATE INDEX idx_fee_schedules_level_id ON fee_schedules(level_id);
CREATE INDEX idx_fee_schedules_term_id ON fee_schedules(term_id);
```

### Table: `invoices`

**Purpose:** Stores student term invoices, arrears, discounts, paid amount, and outstanding amount.

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  student_id UUID NOT NULL REFERENCES students(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  invoice_number VARCHAR(80) NOT NULL,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date DATE,

  total_amount_pesewas INTEGER NOT NULL DEFAULT 0,
  total_paid_pesewas INTEGER NOT NULL DEFAULT 0,
  outstanding_pesewas INTEGER NOT NULL DEFAULT 0,
  arrears_pesewas INTEGER NOT NULL DEFAULT 0,
  discount_pesewas INTEGER NOT NULL DEFAULT 0,

  status invoice_status NOT NULL DEFAULT 'unpaid',
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_invoice_school_number UNIQUE (school_id, invoice_number),
  CONSTRAINT uq_invoice_student_term UNIQUE (student_id, term_id),
  CONSTRAINT chk_invoice_amounts CHECK (
    total_amount_pesewas >= 0
    AND total_paid_pesewas >= 0
    AND outstanding_pesewas >= 0
    AND arrears_pesewas >= 0
    AND discount_pesewas >= 0
  )
);

CREATE INDEX idx_invoices_school_id ON invoices(school_id);
CREATE INDEX idx_invoices_student_id ON invoices(student_id);
CREATE INDEX idx_invoices_term_id ON invoices(term_id);
CREATE INDEX idx_invoices_status ON invoices(status);
```

### Table: `invoice_line_items`

**Purpose:** Stores individual line items on an invoice.

```sql
CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  fee_item_id UUID REFERENCES fee_items(id),

  description VARCHAR(255) NOT NULL,
  amount_pesewas INTEGER NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,

  CONSTRAINT chk_invoice_line_amount CHECK (amount_pesewas >= 0)
);

CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX idx_invoice_line_items_fee_item_id ON invoice_line_items(fee_item_id);
```

### Table: `invoice_discounts`

**Purpose:** Stores discounts, waivers, scholarship deductions, sibling discounts, and approval details.

```sql
CREATE TABLE invoice_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  discount_type VARCHAR(80) NOT NULL,
  amount_pesewas INTEGER NOT NULL,
  reason TEXT,
  approved_by UUID REFERENCES staff(id),
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,

  CONSTRAINT chk_invoice_discount_amount CHECK (amount_pesewas >= 0)
);

CREATE INDEX idx_invoice_discounts_invoice_id ON invoice_discounts(invoice_id);
```

### Table: `payments`

**Purpose:** Stores verified manual and gateway payments against invoices.

```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  invoice_id UUID NOT NULL REFERENCES invoices(id),
  student_id UUID NOT NULL REFERENCES students(id),

  amount_pesewas INTEGER NOT NULL,
  payment_method payment_method NOT NULL,
  payment_reference VARCHAR(150),
  gateway payment_gateway,
  gateway_reference VARCHAR(150),

  paid_at TIMESTAMPTZ NOT NULL,
  recorded_by UUID REFERENCES staff(id),
  receipt_number VARCHAR(80) NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_payment_school_receipt UNIQUE (school_id, receipt_number),
  CONSTRAINT uq_payment_gateway_reference UNIQUE (gateway, gateway_reference),
  CONSTRAINT chk_payment_amount CHECK (amount_pesewas > 0)
);

CREATE INDEX idx_payments_school_id ON payments(school_id);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_student_id ON payments(student_id);
CREATE INDEX idx_payments_paid_at ON payments(paid_at);
CREATE INDEX idx_payments_gateway_reference ON payments(gateway, gateway_reference);
```

---

## 4.16 Payment Gateway Logs and Payment Intents

### Table: `payment_intents`

**Purpose:** Supports payment link creation before actual payment is confirmed.

```sql
CREATE TABLE payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  invoice_id UUID NOT NULL REFERENCES invoices(id),
  student_id UUID NOT NULL REFERENCES students(id),

  gateway payment_gateway NOT NULL,
  amount_pesewas INTEGER NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'GHS',

  status payment_intent_status NOT NULL DEFAULT 'pending',
  gateway_reference VARCHAR(150) NOT NULL,
  authorization_url TEXT,
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_payment_intent_gateway_reference UNIQUE (gateway, gateway_reference),
  CONSTRAINT chk_payment_intent_amount CHECK (amount_pesewas > 0),
  CONSTRAINT chk_payment_intent_currency CHECK (currency = 'GHS')
);

CREATE INDEX idx_payment_intents_school_id ON payment_intents(school_id);
CREATE INDEX idx_payment_intents_invoice_id ON payment_intents(invoice_id);
CREATE INDEX idx_payment_intents_status ON payment_intents(status);
```

### Table: `payment_gateway_logs`

**Purpose:** Logs webhook events, supports idempotency, and preserves raw gateway events for reconciliation.

```sql
CREATE TABLE payment_gateway_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  gateway payment_gateway NOT NULL,
  event_id VARCHAR(200),
  gateway_reference VARCHAR(150),
  event_type VARCHAR(150) NOT NULL,

  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,

  invoice_id UUID REFERENCES invoices(id),
  payment_intent_id UUID REFERENCES payment_intents(id),
  payment_id UUID REFERENCES payments(id),

  CONSTRAINT uq_gateway_event_id UNIQUE (gateway, event_id),
  CONSTRAINT uq_gateway_event_reference_type UNIQUE (
    gateway,
    gateway_reference,
    event_type
  )
);

CREATE INDEX idx_payment_gateway_logs_school_id ON payment_gateway_logs(school_id);
CREATE INDEX idx_payment_gateway_logs_reference ON payment_gateway_logs(gateway, gateway_reference);
CREATE INDEX idx_payment_gateway_logs_processed ON payment_gateway_logs(processed);
CREATE INDEX idx_payment_gateway_logs_payload ON payment_gateway_logs USING GIN(payload);
```

---

## 4.17 Notifications and SMS Logs

### Table: `message_templates`

**Purpose:** Stores reusable SMS/notification templates.

```sql
CREATE TABLE message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  type notification_type NOT NULL,
  title VARCHAR(150) NOT NULL,
  body TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT uq_message_template_school_type_title UNIQUE (school_id, type, title)
);

CREATE INDEX idx_message_templates_school_id ON message_templates(school_id);
```

### Table: `notifications`

**Purpose:** Stores sent or prepared notifications.

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  sender_id UUID REFERENCES users(id),
  type notification_type NOT NULL,
  subject VARCHAR(200),
  body TEXT NOT NULL,

  -- Example: {"classroom_ids": [], "student_ids": [], "scope": "all"}
  audience JSONB NOT NULL DEFAULT '{}'::jsonb,

  channel notification_channel NOT NULL DEFAULT 'sms',
  sent_at TIMESTAMPTZ,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  CONSTRAINT chk_notification_counts CHECK (
    recipient_count >= 0 AND failure_count >= 0
  )
);

CREATE INDEX idx_notifications_school_id ON notifications(school_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_channel ON notifications(channel);
CREATE INDEX idx_notifications_audience ON notifications USING GIN(audience);
```

### Table: `notification_recipients`

**Purpose:** Stores the recipient-level delivery status for each notification.

```sql
CREATE TABLE notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  guardian_id UUID REFERENCES guardians(id),
  student_id UUID REFERENCES students(id),

  phone VARCHAR(30),
  email VARCHAR(150),
  status notification_recipient_status NOT NULL DEFAULT 'pending',

  provider VARCHAR(50),
  provider_message_id VARCHAR(150),
  failure_reason TEXT,
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_notification_recipient_contact CHECK (
    phone IS NOT NULL OR email IS NOT NULL
  )
);

CREATE INDEX idx_notification_recipients_school_id ON notification_recipients(school_id);
CREATE INDEX idx_notification_recipients_notification_id ON notification_recipients(notification_id);
CREATE INDEX idx_notification_recipients_guardian_id ON notification_recipients(guardian_id);
CREATE INDEX idx_notification_recipients_status ON notification_recipients(status);
```

### Table: `sms_provider_logs`

**Purpose:** Stores provider request/response logs for SMS delivery troubleshooting and reconciliation.

```sql
CREATE TABLE sms_provider_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  notification_recipient_id UUID REFERENCES notification_recipients(id),
  provider VARCHAR(50) NOT NULL,
  request_payload JSONB,
  response_payload JSONB,
  provider_message_id VARCHAR(150),
  status VARCHAR(50),
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_provider_logs_school_id ON sms_provider_logs(school_id);
CREATE INDEX idx_sms_provider_logs_provider_message_id ON sms_provider_logs(provider_message_id);
CREATE INDEX idx_sms_provider_logs_response_payload ON sms_provider_logs USING GIN(response_payload);
```

---

## 4.18 Files and Document Uploads

### Table: `files`

**Purpose:** Tracks S3-compatible object storage metadata. File bytes should not be stored in PostgreSQL.

```sql
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  owner_type file_owner_type NOT NULL,
  owner_id UUID NOT NULL,

  original_file_name VARCHAR(255) NOT NULL,
  stored_file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_bucket VARCHAR(150) NOT NULL,
  storage_key TEXT NOT NULL,
  checksum_sha256 VARCHAR(100),

  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_file_storage_key UNIQUE (storage_bucket, storage_key),
  CONSTRAINT chk_file_size CHECK (size_bytes > 0)
);

CREATE INDEX idx_files_school_id ON files(school_id);
CREATE INDEX idx_files_owner ON files(owner_type, owner_id);
CREATE INDEX idx_files_uploaded_by ON files(uploaded_by);
```

Add the report-card file foreign key after `files` is created:

```sql
ALTER TABLE report_card_files
ADD CONSTRAINT fk_report_card_files_file
FOREIGN KEY (file_id) REFERENCES files(id);
```

---

## 4.19 Consent Records

### Table: `consent_records`

**Purpose:** Records verifiable parental consent for child data processing.

```sql
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  student_id UUID NOT NULL REFERENCES students(id),
  guardian_id UUID NOT NULL REFERENCES guardians(id),

  consent_type consent_type NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET,
  user_agent TEXT,
  method consent_method NOT NULL,
  consent_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  revoked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,

  CONSTRAINT uq_active_consent UNIQUE (
    student_id,
    guardian_id,
    consent_type,
    granted_at
  )
);

CREATE INDEX idx_consent_records_school_id ON consent_records(school_id);
CREATE INDEX idx_consent_records_student_id ON consent_records(student_id);
CREATE INDEX idx_consent_records_guardian_id ON consent_records(guardian_id);
CREATE INDEX idx_consent_records_type ON consent_records(consent_type);
CREATE INDEX idx_consent_records_details ON consent_records USING GIN(consent_details);
```

---

## 4.20 Audit Logs

### Table: `audit_logs`

**Purpose:** Immutable event history. This table should not be updated or deleted by application users.

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),

  user_id UUID REFERENCES users(id),
  action VARCHAR(150) NOT NULL,
  entity_type VARCHAR(150) NOT NULL,
  entity_id UUID,

  changes JSONB,
  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_school_id ON audit_logs(school_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_changes ON audit_logs USING GIN(changes);
```

Immutability trigger:

```sql
CREATE OR REPLACE FUNCTION prevent_audit_log_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_audit_log_update
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_update_delete();
```

---

## 4.21 Data Subject Requests

### Table: `data_subject_requests`

**Purpose:** Tracks parent/guardian requests for access, correction, export, or erasure.

```sql
CREATE TABLE data_subject_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  guardian_id UUID REFERENCES guardians(id),
  student_id UUID REFERENCES students(id),

  request_type data_request_type NOT NULL,
  status request_status NOT NULL DEFAULT 'open',
  request_details TEXT,
  response_notes TEXT,

  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  handled_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_data_request_guardian_or_student CHECK (
    guardian_id IS NOT NULL OR student_id IS NOT NULL
  )
);

CREATE INDEX idx_data_subject_requests_school_id ON data_subject_requests(school_id);
CREATE INDEX idx_data_subject_requests_status ON data_subject_requests(status);
CREATE INDEX idx_data_subject_requests_guardian_id ON data_subject_requests(guardian_id);
CREATE INDEX idx_data_subject_requests_student_id ON data_subject_requests(student_id);
```

---

## 4.22 Breach/Security Incident Logs

### Table: `security_incidents`

**Purpose:** Tracks internal breach/security incidents.

```sql
CREATE TABLE security_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),

  severity security_incident_severity NOT NULL,
  status security_incident_status NOT NULL DEFAULT 'open',

  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  affected_records_estimate INTEGER,
  mitigation_steps TEXT,
  dpc_notification_payload JSONB,
  reported_to_dpc_at TIMESTAMPTZ,
  affected_individuals_notified_at TIMESTAMPTZ,

  created_by UUID REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_affected_records_estimate CHECK (
    affected_records_estimate IS NULL OR affected_records_estimate >= 0
  )
);

CREATE INDEX idx_security_incidents_school_id ON security_incidents(school_id);
CREATE INDEX idx_security_incidents_status ON security_incidents(status);
CREATE INDEX idx_security_incidents_severity ON security_incidents(severity);
```

---

## 4.23 Backup and Logging Metadata

### Table: `backup_runs`

**Purpose:** Tracks automated and manual backups.

```sql
CREATE TABLE backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),

  backup_type VARCHAR(50) NOT NULL,
  status backup_status NOT NULL DEFAULT 'pending',

  storage_bucket VARCHAR(150),
  storage_key TEXT,
  size_bytes BIGINT,
  checksum_sha256 VARCHAR(100),

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  triggered_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_backup_size CHECK (size_bytes IS NULL OR size_bytes > 0)
);

CREATE INDEX idx_backup_runs_school_id ON backup_runs(school_id);
CREATE INDEX idx_backup_runs_status ON backup_runs(status);
CREATE INDEX idx_backup_runs_created_at ON backup_runs(created_at);
```

---

# 5. Index Strategy

Use indexes around common query paths, not every column.

## Tenant indexes

Every tenant-owned table should have:

```sql
CREATE INDEX idx_<table>_school_id ON <table>(school_id);
```

## Parent portal indexes

```txt
student_guardians.guardian_id
student_guardians.student_id
users.linked_entity_type + linked_entity_id
report_cards.student_id
invoices.student_id
attendance_records.enrollment_id
```

## Teacher portal indexes

```txt
classrooms.class_teacher_id
subject_assignments.staff_id
class_subjects.classroom_id
class_subjects.subject_id
assessment_scores.recorded_by
assessment_scores.subject_id
assessment_scores.term_id
```

## Finance indexes

```txt
invoices.student_id
invoices.term_id
invoices.status
payments.invoice_id
payments.student_id
payments.gateway + gateway_reference
payment_intents.gateway + gateway_reference
payment_gateway_logs.gateway + gateway_reference
```

## Audit/reporting indexes

```txt
audit_logs.user_id
audit_logs.entity_type + entity_id
audit_logs.created_at
audit_logs.action
```

Use GIN indexes only on JSONB fields that will actually be searched:

```txt
report_cards.computed_grades
payment_gateway_logs.payload
audit_logs.changes
notifications.audience
```

---

# 6. Constraint Strategy

## Use database constraints for hard business rules

Examples:

```txt
One academic year label per school
One active academic year per school
One classroom section per level/year
One invoice per student/term
One attendance session per class/date
One attendance record per student/session
One report card per enrollment/term
One payment gateway reference processed once
```

## Use application-level validation for flexible school rules

Examples:

```txt
Whether Ghana Card is required
Whether a student can switch curriculum track
Whether attendance can be edited after lock
Whether report cards can be regenerated after approval
Whether a class is over capacity
Whether grading formula weights total 100%
```

Some rules are better in the service layer because they may differ by school.

---

# 7. Multi-Tenant Readiness Notes

Even though MVP is single-school, this design prepares for future SaaS by:

```txt
Adding school_id to tenant-owned tables
Keeping roles optionally school-scoped
Keeping permissions global
Avoiding global unique constraints for names and codes
Using school_id + code/name unique constraints
Keeping storage keys under school-specific folders
Making users school-scoped
```

For future multi-school support, add:

```txt
school_users
school_subscriptions
tenant billing tables
school-specific domain settings
row-level security policies
```

Do not build those into the MVP unless needed.

---

# 8. Soft Delete and Archival Strategy

Use different strategies depending on record type.

## Archive, do not delete

Use `archived_at` for:

```txt
students
guardians
staff
files
```

These records may be needed for compliance, report cards, payment history, and audit history.

## Deactivate, do not delete

Use `is_active` for:

```txt
schools
levels
classrooms
subjects
curriculum_tracks
fee_items
assessment_types
grading_scales
report_card_templates
message_templates
```

## Void, do not delete

Use `status = 'void'` for:

```txt
invoices
```

Payments should not be deleted. If there is an error, reverse or adjust with a new record later.

## Immutable

Never update/delete:

```txt
audit_logs
payment_gateway_logs after processing, except processed fields
published report card snapshots
```

---

# 9. Audit Logging Strategy

The audit log should capture:

```txt
login
logout
failed_login
password_change
user_created
role_assigned
student_created
student_updated
guardian_updated
attendance_submitted
attendance_updated
score_created
score_updated
score_locked
report_card_generated
report_card_approved
report_card_published
invoice_generated
manual_payment_recorded
payment_webhook_received
payment_verified
notification_sent
file_uploaded
data_exported
data_subject_request_created
security_incident_created
```

Recommended audit payload:

```json
{
  "before": {},
  "after": {},
  "metadata": {
    "module": "students",
    "source": "web",
    "request_id": "..."
  }
}
```

Do not rely only on frontend audit logs. Write audit logs in the backend service layer.

---

# 10. Payment Idempotency Strategy

Payment idempotency should be enforced at both database and service level.

## Database-level protection

```sql
CONSTRAINT uq_payment_gateway_reference UNIQUE (gateway, gateway_reference)
```

On `payment_gateway_logs`:

```sql
CONSTRAINT uq_gateway_event_id UNIQUE (gateway, event_id)
```

And fallback:

```sql
CONSTRAINT uq_gateway_event_reference_type UNIQUE (
  gateway,
  gateway_reference,
  event_type
)
```

## Service-level flow

```txt
1. Receive webhook.
2. Store raw event in payment_gateway_logs.
3. Verify signature.
4. If signature invalid, mark signature_valid = false and stop.
5. Check if gateway_reference already has a verified payment.
6. If already processed, mark log processed and stop.
7. Call gateway verification endpoint.
8. Confirm amount, currency, status, invoice reference.
9. Create payment inside a database transaction.
10. Update invoice totals inside same transaction.
11. Mark payment_gateway_log as processed.
12. Generate receipt and send SMS asynchronously.
```

Do not mark payment successful from frontend callback parameters.

---

# 11. Security and Privacy Notes

## Sensitive fields

Encrypt at application layer:

```txt
students.medical_alerts_encrypted
consent_records.consent_details if sensitive
security_incidents.dpc_notification_payload if sensitive
```

## Parent access

Parent queries must always join through:

```txt
users.linked_entity_type = 'guardian'
users.linked_entity_id = guardians.id
student_guardians.guardian_id = guardians.id
```

A parent should never request a raw `student_id` and receive data without checking linkage.

## Teacher access

Class teacher access:

```txt
classrooms.class_teacher_id = staff.id
```

Subject teacher access:

```txt
subject_assignments.staff_id = staff.id
```

## Bursar separation

Bursar permissions should allow:

```txt
invoices.read
payments.record
finance.reports.read
```

But not:

```txt
scores.update
report_cards.approve
grading.configure
```

## JWT/session notes

Use:

```txt
HTTP-only refresh token cookie
Short-lived access token
Refresh token rotation
Rate limiting on login and OTP
Password hashing with Argon2 or bcrypt
```

---

# 12. Prisma Schema Version of the Design

Below is a practical Prisma version. It is intentionally focused on the MVP model. Some advanced PostgreSQL features, such as partial unique indexes and immutability triggers, should still be implemented using raw SQL migrations.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum GenderType {
  male
  female
  other
}

enum TermStatus {
  draft
  active
  closed
}

enum CurriculumCode {
  GES_NACCA
  ABEKA
}

enum CurriculumScope {
  GES_NACCA
  ABEKA
  BOTH
}

enum LevelGroup {
  CRECHE
  NURSERY
  KG
  LOWER_PRIMARY
  UPPER_PRIMARY
  JHS
}

enum StaffStatus {
  active
  on_leave
  resigned
  terminated
}

enum StaffRoleCategory {
  teacher
  admin
  support
}

enum EmploymentType {
  full_time
  part_time
  contract
}

enum NtcStatus {
  licensed
  induction
  unlicensed
  not_applicable
}

enum LinkedEntityType {
  staff
  guardian
}

enum AdmissionStatus {
  enquiry
  application
  offered
  rejected
  enrolled
}

enum EnrollmentStatus {
  active
  transferred
  withdrawn
  completed
  graduated
}

enum AttendanceStatus {
  present
  absent
  late
  excused
}

enum AttendanceSessionStatus {
  draft
  submitted
  locked
}

enum AssessmentCategory {
  formative
  summative
  exam
  milestone
}

enum ReportCardStatus {
  draft
  review
  approved
  published
}

enum ReportTemplateType {
  GES_PRIMARY
  GES_JHS
  ABEKA
  ECE_DEVELOPMENTAL
}

enum InvoiceStatus {
  unpaid
  partial
  paid
  waived
  void
}

enum PaymentMethod {
  cash
  bank_deposit
  cheque
  mobile_money
  manual_momo
}

enum PaymentGateway {
  paystack
  hubtel
}

enum PaymentIntentStatus {
  pending
  successful
  failed
  expired
  cancelled
}

enum NotificationType {
  announcement
  fee_reminder
  report_ready
  absence_alert
  payment_receipt
  account_setup
  password_reset
}

enum NotificationChannel {
  sms
  portal
  email
}

enum NotificationRecipientStatus {
  pending
  sent
  failed
  cancelled
}

enum ConsentType {
  educational_processing
  marketing
  third_party_sharing
}

enum ConsentMethod {
  checkbox
  otp
  signature
  paper_form
}

model School {
  id                 String   @id @default(uuid()) @db.Uuid
  name               String   @db.VarChar(200)
  slug               String   @unique @db.VarChar(100)
  logoUrl            String?  @map("logo_url")
  address            String?
  ghanaPostGps       String?  @map("ghana_post_gps") @db.VarChar(50)
  phone              String?  @db.VarChar(30)
  email              String?  @db.VarChar(150)
  motto              String?  @db.VarChar(255)
  registrationNumber String?  @map("registration_number") @db.VarChar(100)
  isActive           Boolean  @default(true) @map("is_active")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  academicYears      AcademicYear[]
  levels             Level[]
  users              User[]
  staff              Staff[]
  students           Student[]
  guardians          Guardian[]

  @@map("schools")
}

model AcademicYear {
  id        String   @id @default(uuid()) @db.Uuid
  schoolId  String   @map("school_id") @db.Uuid
  label     String   @db.VarChar(20)
  startDate DateTime @map("start_date") @db.Date
  endDate   DateTime @map("end_date") @db.Date
  isActive  Boolean  @default(false) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  school    School   @relation(fields: [schoolId], references: [id])
  terms     Term[]
  classrooms Classroom[]
  enrollments Enrollment[]

  @@unique([schoolId, label])
  @@index([schoolId])
  @@map("academic_years")
}

model Term {
  id              String          @id @default(uuid()) @db.Uuid
  schoolId        String          @map("school_id") @db.Uuid
  academicYearId  String          @map("academic_year_id") @db.Uuid
  termNumber      Int             @map("term_number") @db.SmallInt
  label           String          @db.VarChar(50)
  startDate       DateTime        @map("start_date") @db.Date
  endDate         DateTime        @map("end_date") @db.Date
  examStartDate   DateTime?       @map("exam_start_date") @db.Date
  examEndDate     DateTime?       @map("exam_end_date") @db.Date
  status          TermStatus      @default(draft)
  curriculumScope CurriculumScope @default(BOTH) @map("curriculum_scope")
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")

  school          School          @relation(fields: [schoolId], references: [id])
  academicYear    AcademicYear    @relation(fields: [academicYearId], references: [id])
  invoices        Invoice[]
  reportCards     ReportCard[]

  @@unique([academicYearId, termNumber])
  @@index([schoolId])
  @@index([academicYearId])
  @@map("terms")
}

model Level {
  id                String     @id @default(uuid()) @db.Uuid
  schoolId          String     @map("school_id") @db.Uuid
  name              String     @db.VarChar(100)
  gesDesignation    String?    @map("ges_designation") @db.VarChar(100)
  abekaDesignation  String?    @map("abeka_designation") @db.VarChar(100)
  orderIndex        Int        @map("order_index") @db.SmallInt
  levelGroup        LevelGroup @map("level_group")
  isActive          Boolean    @default(true) @map("is_active")
  createdAt         DateTime   @default(now()) @map("created_at")
  updatedAt         DateTime   @updatedAt @map("updated_at")

  school            School     @relation(fields: [schoolId], references: [id])
  classrooms        Classroom[]
  feeSchedules      FeeSchedule[]

  @@unique([schoolId, name])
  @@unique([schoolId, orderIndex])
  @@index([schoolId])
  @@map("levels")
}

model Classroom {
  id             String   @id @default(uuid()) @db.Uuid
  schoolId       String   @map("school_id") @db.Uuid
  levelId        String   @map("level_id") @db.Uuid
  academicYearId String   @map("academic_year_id") @db.Uuid
  sectionLabel   String   @map("section_label") @db.VarChar(20)
  displayName    String   @map("display_name") @db.VarChar(120)
  capacity       Int?
  classTeacherId String?  @map("class_teacher_id") @db.Uuid
  isActive       Boolean  @default(true) @map("is_active")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  school         School       @relation(fields: [schoolId], references: [id])
  level          Level        @relation(fields: [levelId], references: [id])
  academicYear   AcademicYear @relation(fields: [academicYearId], references: [id])
  classTeacher   Staff?       @relation(fields: [classTeacherId], references: [id])
  enrollments    Enrollment[]
  classSubjects  ClassSubject[]

  @@unique([levelId, academicYearId, sectionLabel])
  @@index([schoolId])
  @@index([classTeacherId])
  @@map("classrooms")
}

model User {
  id               String           @id @default(uuid()) @db.Uuid
  schoolId         String           @map("school_id") @db.Uuid
  email            String?          @db.VarChar(150)
  phone            String?          @db.VarChar(30)
  passwordHash     String           @map("password_hash")
  linkedEntityType LinkedEntityType @map("linked_entity_type")
  linkedEntityId   String           @map("linked_entity_id") @db.Uuid
  isActive         Boolean          @default(true) @map("is_active")
  mustChangePassword Boolean        @default(true) @map("must_change_password")
  lastLoginAt      DateTime?        @map("last_login_at")
  refreshTokenHash String?          @map("refresh_token_hash")
  createdAt        DateTime         @default(now()) @map("created_at")
  updatedAt        DateTime         @updatedAt @map("updated_at")

  school           School           @relation(fields: [schoolId], references: [id])
  userRoles        UserRole[]
  notifications    Notification[]

  @@index([schoolId])
  @@index([linkedEntityType, linkedEntityId])
  @@map("users")
}

model Role {
  id           String   @id @default(uuid()) @db.Uuid
  schoolId     String?  @map("school_id") @db.Uuid
  name         String   @db.VarChar(100)
  code         String   @db.VarChar(100)
  description  String?
  isSystemRole Boolean  @default(false) @map("is_system_role")
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  userRoles       UserRole[]
  rolePermissions RolePermission[]

  @@unique([schoolId, code])
  @@map("roles")
}

model Permission {
  id          String   @id @default(uuid()) @db.Uuid
  key         String   @unique @db.VarChar(150)
  module      String   @db.VarChar(100)
  description String?
  createdAt   DateTime @default(now()) @map("created_at")

  rolePermissions RolePermission[]

  @@map("permissions")
}

model RolePermission {
  id           String @id @default(uuid()) @db.Uuid
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  role         Role       @relation(fields: [roleId], references: [id])
  permission   Permission @relation(fields: [permissionId], references: [id])

  @@unique([roleId, permissionId])
  @@map("role_permissions")
}

model UserRole {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  roleId    String   @map("role_id") @db.Uuid
  grantedBy String?  @map("granted_by") @db.Uuid
  grantedAt DateTime @default(now()) @map("granted_at")

  user      User     @relation(fields: [userId], references: [id])
  role      Role     @relation(fields: [roleId], references: [id])

  @@unique([userId, roleId])
  @@map("user_roles")
}

model Staff {
  id                    String            @id @default(uuid()) @db.Uuid
  schoolId              String            @map("school_id") @db.Uuid
  staffNumber           String            @map("staff_number") @db.VarChar(50)
  firstName             String            @map("first_name") @db.VarChar(100)
  lastName              String            @map("last_name") @db.VarChar(100)
  phone                 String?           @db.VarChar(30)
  email                 String?           @db.VarChar(150)
  photoUrl              String?           @map("photo_url")
  roleCategory          StaffRoleCategory @map("role_category")
  employmentType        EmploymentType    @default(full_time) @map("employment_type")
  status                StaffStatus       @default(active)
  ntcRegistrationNumber String?           @map("ntc_registration_number") @db.VarChar(100)
  ntcStatus             NtcStatus         @default(not_applicable) @map("ntc_status")
  archivedAt            DateTime?         @map("archived_at")
  createdAt             DateTime          @default(now()) @map("created_at")
  updatedAt             DateTime          @updatedAt @map("updated_at")

  school                School            @relation(fields: [schoolId], references: [id])
  classrooms            Classroom[]
  subjectAssignments    SubjectAssignment[]
  assessmentScores      AssessmentScore[]

  @@unique([schoolId, staffNumber])
  @@index([schoolId])
  @@map("staff")
}

model Student {
  id                    String           @id @default(uuid()) @db.Uuid
  schoolId              String           @map("school_id") @db.Uuid
  studentNumber         String           @map("student_number") @db.VarChar(50)
  firstName             String           @map("first_name") @db.VarChar(100)
  middleName            String?          @map("middle_name") @db.VarChar(100)
  lastName              String           @map("last_name") @db.VarChar(100)
  preferredName         String?          @map("preferred_name") @db.VarChar(100)
  dateOfBirth           DateTime         @map("date_of_birth") @db.Date
  gender                GenderType
  nationality           String?          @db.VarChar(100)
  religion              String?          @db.VarChar(100)
  ghanaCardId           String?          @map("ghana_card_id") @db.VarChar(50)
  profilePhotoUrl       String?          @map("profile_photo_url")
  previousSchool        String?          @map("previous_school") @db.VarChar(200)
  medicalAlertsEncrypted String?         @map("medical_alerts_encrypted")
  admissionDate         DateTime?        @map("admission_date") @db.Date
  status                EnrollmentStatus @default(active)
  archivedAt            DateTime?        @map("archived_at")
  createdAt             DateTime         @default(now()) @map("created_at")
  updatedAt             DateTime         @updatedAt @map("updated_at")

  school                School           @relation(fields: [schoolId], references: [id])
  guardians             StudentGuardian[]
  enrollments           Enrollment[]
  invoices              Invoice[]
  payments              Payment[]
  reportCards           ReportCard[]

  @@unique([schoolId, studentNumber])
  @@index([schoolId])
  @@index([lastName, firstName])
  @@map("students")
}

model Guardian {
  id             String   @id @default(uuid()) @db.Uuid
  schoolId       String   @map("school_id") @db.Uuid
  firstName      String   @map("first_name") @db.VarChar(100)
  lastName       String   @map("last_name") @db.VarChar(100)
  relationship   String?  @db.VarChar(50)
  phonePrimary   String   @map("phone_primary") @db.VarChar(30)
  phoneSecondary String?  @map("phone_secondary") @db.VarChar(30)
  email          String?  @db.VarChar(150)
  occupation     String?  @db.VarChar(150)
  address        String?
  archivedAt     DateTime? @map("archived_at")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  school         School   @relation(fields: [schoolId], references: [id])
  students       StudentGuardian[]

  @@unique([schoolId, phonePrimary])
  @@index([schoolId])
  @@map("guardians")
}

model StudentGuardian {
  id                 String   @id @default(uuid()) @db.Uuid
  schoolId           String   @map("school_id") @db.Uuid
  studentId          String   @map("student_id") @db.Uuid
  guardianId         String   @map("guardian_id") @db.Uuid
  relationship       String?  @db.VarChar(50)
  isPrimary          Boolean  @default(false) @map("is_primary")
  isEmergencyContact Boolean  @default(false) @map("is_emergency_contact")
  canReceiveSms      Boolean  @default(true) @map("can_receive_sms")
  canAccessPortal    Boolean  @default(true) @map("can_access_portal")
  createdAt          DateTime @default(now()) @map("created_at")

  student            Student  @relation(fields: [studentId], references: [id])
  guardian           Guardian @relation(fields: [guardianId], references: [id])

  @@unique([studentId, guardianId])
  @@index([guardianId])
  @@map("student_guardians")
}

model Enrollment {
  id              String           @id @default(uuid()) @db.Uuid
  schoolId        String           @map("school_id") @db.Uuid
  studentId       String           @map("student_id") @db.Uuid
  classroomId     String           @map("classroom_id") @db.Uuid
  academicYearId  String           @map("academic_year_id") @db.Uuid
  curriculumTrack CurriculumCode   @map("curriculum_track")
  enrollmentDate  DateTime         @default(now()) @map("enrollment_date") @db.Date
  status          EnrollmentStatus @default(active)
  exitDate        DateTime?        @map("exit_date") @db.Date
  exitReason      String?          @map("exit_reason")
  createdAt       DateTime         @default(now()) @map("created_at")
  updatedAt       DateTime         @updatedAt @map("updated_at")

  student         Student          @relation(fields: [studentId], references: [id])
  classroom       Classroom        @relation(fields: [classroomId], references: [id])
  academicYear    AcademicYear     @relation(fields: [academicYearId], references: [id])
  assessmentScores AssessmentScore[]
  attendanceRecords AttendanceRecord[]
  reportCards     ReportCard[]

  @@unique([studentId, academicYearId, curriculumTrack])
  @@index([schoolId])
  @@index([classroomId])
  @@map("enrollments")
}

model CurriculumTrack {
  id        String         @id @default(uuid()) @db.Uuid
  schoolId  String         @map("school_id") @db.Uuid
  code      CurriculumCode
  name      String         @db.VarChar(100)
  isActive  Boolean        @default(true) @map("is_active")
  createdAt DateTime       @default(now()) @map("created_at")
  updatedAt DateTime       @updatedAt @map("updated_at")

  subjects  Subject[]
  assessmentTypes AssessmentType[]
  gradingScales GradingScale[]
  reportCards ReportCard[]

  @@unique([schoolId, code])
  @@map("curriculum_tracks")
}

model Subject {
  id                      String   @id @default(uuid()) @db.Uuid
  schoolId                String   @map("school_id") @db.Uuid
  curriculumTrackId       String   @map("curriculum_track_id") @db.Uuid
  name                    String   @db.VarChar(150)
  code                    String   @db.VarChar(50)
  levelGroupApplicability Json     @default("[]") @map("level_group_applicability")
  creditHours             Decimal? @map("credit_hours") @db.Decimal(5, 2)
  isActive                Boolean  @default(true) @map("is_active")
  createdAt               DateTime @default(now()) @map("created_at")
  updatedAt               DateTime @updatedAt @map("updated_at")

  curriculumTrack         CurriculumTrack @relation(fields: [curriculumTrackId], references: [id])
  classSubjects           ClassSubject[]
  assessmentScores        AssessmentScore[]

  @@unique([schoolId, curriculumTrackId, code])
  @@index([schoolId])
  @@map("subjects")
}

model ClassSubject {
  id          String   @id @default(uuid()) @db.Uuid
  schoolId    String   @map("school_id") @db.Uuid
  classroomId String   @map("classroom_id") @db.Uuid
  subjectId   String   @map("subject_id") @db.Uuid
  termId      String   @map("term_id") @db.Uuid
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  classroom   Classroom @relation(fields: [classroomId], references: [id])
  subject     Subject   @relation(fields: [subjectId], references: [id])
  assignments SubjectAssignment[]

  @@unique([classroomId, subjectId, termId])
  @@index([schoolId])
  @@map("class_subjects")
}

model SubjectAssignment {
  id               String   @id @default(uuid()) @db.Uuid
  schoolId         String   @map("school_id") @db.Uuid
  staffId          String   @map("staff_id") @db.Uuid
  classSubjectId   String   @map("class_subject_id") @db.Uuid
  termId           String   @map("term_id") @db.Uuid
  isPrimaryTeacher Boolean  @default(true) @map("is_primary_teacher")
  isActive         Boolean  @default(true) @map("is_active")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  staff            Staff        @relation(fields: [staffId], references: [id])
  classSubject     ClassSubject @relation(fields: [classSubjectId], references: [id])

  @@unique([staffId, classSubjectId, termId])
  @@index([schoolId])
  @@map("subject_assignments")
}

model AttendanceSession {
  id             String                  @id @default(uuid()) @db.Uuid
  schoolId       String                  @map("school_id") @db.Uuid
  classroomId    String                  @map("classroom_id") @db.Uuid
  termId         String                  @map("term_id") @db.Uuid
  attendanceDate DateTime                @map("attendance_date") @db.Date
  recordedBy     String                  @map("recorded_by") @db.Uuid
  status         AttendanceSessionStatus @default(draft)
  submittedAt    DateTime?               @map("submitted_at")
  lockedAt       DateTime?               @map("locked_at")
  createdAt      DateTime                @default(now()) @map("created_at")
  updatedAt      DateTime                @updatedAt @map("updated_at")

  records        AttendanceRecord[]

  @@unique([classroomId, attendanceDate])
  @@index([schoolId])
  @@map("attendance_sessions")
}

model AttendanceRecord {
  id                  String           @id @default(uuid()) @db.Uuid
  schoolId            String           @map("school_id") @db.Uuid
  attendanceSessionId String           @map("attendance_session_id") @db.Uuid
  enrollmentId        String           @map("enrollment_id") @db.Uuid
  status              AttendanceStatus @default(present)
  notes               String?
  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt @map("updated_at")

  session             AttendanceSession @relation(fields: [attendanceSessionId], references: [id])
  enrollment          Enrollment        @relation(fields: [enrollmentId], references: [id])

  @@unique([attendanceSessionId, enrollmentId])
  @@index([schoolId])
  @@map("attendance_records")
}

model AssessmentType {
  id                String             @id @default(uuid()) @db.Uuid
  schoolId          String             @map("school_id") @db.Uuid
  curriculumTrackId String             @map("curriculum_track_id") @db.Uuid
  name              String             @db.VarChar(150)
  code              String             @db.VarChar(80)
  levelGroup        LevelGroup         @map("level_group")
  maxScore          Int                @map("max_score")
  weightPercentage  Decimal?           @map("weight_percentage") @db.Decimal(5, 2)
  assessmentCategory AssessmentCategory @map("assessment_category")
  isActive          Boolean            @default(true) @map("is_active")
  createdAt         DateTime           @default(now()) @map("created_at")
  updatedAt         DateTime           @updatedAt @map("updated_at")

  curriculumTrack   CurriculumTrack    @relation(fields: [curriculumTrackId], references: [id])
  scores            AssessmentScore[]

  @@unique([schoolId, curriculumTrackId, code, levelGroup])
  @@index([schoolId])
  @@map("assessment_types")
}

model AssessmentScore {
  id               String   @id @default(uuid()) @db.Uuid
  schoolId         String   @map("school_id") @db.Uuid
  enrollmentId     String   @map("enrollment_id") @db.Uuid
  subjectId        String   @map("subject_id") @db.Uuid
  assessmentTypeId String   @map("assessment_type_id") @db.Uuid
  termId           String   @map("term_id") @db.Uuid
  rawScore         Decimal  @map("raw_score") @db.Decimal(7, 2)
  maxScore         Decimal  @map("max_score") @db.Decimal(7, 2)
  recordedBy       String   @map("recorded_by") @db.Uuid
  recordedAt       DateTime @default(now()) @map("recorded_at")
  isLocked         Boolean  @default(false) @map("is_locked")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  enrollment       Enrollment     @relation(fields: [enrollmentId], references: [id])
  subject          Subject        @relation(fields: [subjectId], references: [id])
  assessmentType   AssessmentType @relation(fields: [assessmentTypeId], references: [id])
  recorder         Staff          @relation(fields: [recordedBy], references: [id])

  @@unique([enrollmentId, subjectId, assessmentTypeId, termId])
  @@index([schoolId])
  @@map("assessment_scores")
}

model GradingScale {
  id                String   @id @default(uuid()) @db.Uuid
  schoolId          String   @map("school_id") @db.Uuid
  curriculumTrackId String   @map("curriculum_track_id") @db.Uuid
  levelGroup        LevelGroup @map("level_group")
  minScore          Decimal  @map("min_score") @db.Decimal(5, 2)
  maxScore          Decimal  @map("max_score") @db.Decimal(5, 2)
  letterGrade       String?  @map("letter_grade") @db.VarChar(20)
  descriptor        String?  @db.VarChar(150)
  gpaValue          Decimal? @map("gpa_value") @db.Decimal(4, 2)
  isActive          Boolean  @default(true) @map("is_active")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  curriculumTrack   CurriculumTrack @relation(fields: [curriculumTrackId], references: [id])

  @@index([schoolId, curriculumTrackId, levelGroup])
  @@map("grading_scales")
}

model GradingFormulaConfig {
  id                String   @id @default(uuid()) @db.Uuid
  schoolId          String   @map("school_id") @db.Uuid
  curriculumTrackId String   @map("curriculum_track_id") @db.Uuid
  levelGroup        LevelGroup @map("level_group")
  subjectId         String?  @map("subject_id") @db.Uuid
  name              String   @db.VarChar(150)
  formulaJson       Json     @map("formula_json")
  isActive          Boolean  @default(true) @map("is_active")
  effectiveFrom     DateTime? @map("effective_from") @db.Date
  effectiveTo       DateTime? @map("effective_to") @db.Date
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@index([schoolId, curriculumTrackId, levelGroup])
  @@map("grading_formula_configs")
}

model ReportCardTemplate {
  id                String             @id @default(uuid()) @db.Uuid
  schoolId          String             @map("school_id") @db.Uuid
  curriculumTrackId String?            @map("curriculum_track_id") @db.Uuid
  name              String             @db.VarChar(150)
  templateType      ReportTemplateType @map("template_type")
  levelGroup        LevelGroup         @map("level_group")
  templateConfig    Json               @map("template_config")
  isActive          Boolean            @default(true) @map("is_active")
  createdAt         DateTime           @default(now()) @map("created_at")
  updatedAt         DateTime           @updatedAt @map("updated_at")

  reportCards       ReportCard[]

  @@unique([schoolId, name])
  @@index([schoolId])
  @@map("report_card_templates")
}

model ReportCard {
  id                String           @id @default(uuid()) @db.Uuid
  schoolId          String           @map("school_id") @db.Uuid
  enrollmentId      String           @map("enrollment_id") @db.Uuid
  studentId         String           @map("student_id") @db.Uuid
  termId            String           @map("term_id") @db.Uuid
  curriculumTrackId String           @map("curriculum_track_id") @db.Uuid
  templateId        String?          @map("template_id") @db.Uuid
  computedGrades    Json             @map("computed_grades")
  attendanceSummary Json             @map("attendance_summary")
  overallGrade      String?          @map("overall_grade") @db.VarChar(50)
  gpa               Decimal?         @db.Decimal(4, 2)
  teacherRemarks    String?          @map("teacher_remarks")
  headteacherRemarks String?         @map("headteacher_remarks")
  conductRating     String?          @map("conduct_rating") @db.VarChar(100)
  status            ReportCardStatus @default(draft)
  approvedBy        String?          @map("approved_by") @db.Uuid
  approvedAt        DateTime?        @map("approved_at")
  publishedAt       DateTime?        @map("published_at")
  createdAt         DateTime         @default(now()) @map("created_at")
  updatedAt         DateTime         @updatedAt @map("updated_at")

  enrollment        Enrollment       @relation(fields: [enrollmentId], references: [id])
  student           Student          @relation(fields: [studentId], references: [id])
  term              Term             @relation(fields: [termId], references: [id])
  curriculumTrack   CurriculumTrack  @relation(fields: [curriculumTrackId], references: [id])
  template          ReportCardTemplate? @relation(fields: [templateId], references: [id])

  @@unique([enrollmentId, termId])
  @@index([schoolId])
  @@index([studentId])
  @@map("report_cards")
}

model FeeItem {
  id          String   @id @default(uuid()) @db.Uuid
  schoolId    String   @map("school_id") @db.Uuid
  name        String   @db.VarChar(150)
  category    String   @db.VarChar(100)
  description String?
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  schedules   FeeSchedule[]
  lineItems   InvoiceLineItem[]

  @@unique([schoolId, name])
  @@map("fee_items")
}

model FeeSchedule {
  id             String   @id @default(uuid()) @db.Uuid
  schoolId       String   @map("school_id") @db.Uuid
  feeItemId      String   @map("fee_item_id") @db.Uuid
  levelId        String   @map("level_id") @db.Uuid
  termId         String   @map("term_id") @db.Uuid
  amountPesewas  Int      @map("amount_pesewas")
  isActive       Boolean  @default(true) @map("is_active")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  feeItem        FeeItem  @relation(fields: [feeItemId], references: [id])
  level          Level    @relation(fields: [levelId], references: [id])

  @@unique([feeItemId, levelId, termId])
  @@index([schoolId])
  @@map("fee_schedules")
}

model Invoice {
  id                    String        @id @default(uuid()) @db.Uuid
  schoolId              String        @map("school_id") @db.Uuid
  studentId             String        @map("student_id") @db.Uuid
  termId                String        @map("term_id") @db.Uuid
  invoiceNumber         String        @map("invoice_number") @db.VarChar(80)
  generatedAt           DateTime      @default(now()) @map("generated_at")
  dueDate               DateTime?     @map("due_date") @db.Date
  totalAmountPesewas    Int           @default(0) @map("total_amount_pesewas")
  totalPaidPesewas      Int           @default(0) @map("total_paid_pesewas")
  outstandingPesewas    Int           @default(0) @map("outstanding_pesewas")
  arrearsPesewas        Int           @default(0) @map("arrears_pesewas")
  discountPesewas       Int           @default(0) @map("discount_pesewas")
  status                InvoiceStatus @default(unpaid)
  voidReason            String?       @map("void_reason")
  createdAt             DateTime      @default(now()) @map("created_at")
  updatedAt             DateTime      @updatedAt @map("updated_at")

  student               Student       @relation(fields: [studentId], references: [id])
  term                  Term          @relation(fields: [termId], references: [id])
  lineItems             InvoiceLineItem[]
  payments              Payment[]
  paymentIntents        PaymentIntent[]

  @@unique([schoolId, invoiceNumber])
  @@unique([studentId, termId])
  @@index([schoolId])
  @@index([status])
  @@map("invoices")
}

model InvoiceLineItem {
  id             String   @id @default(uuid()) @db.Uuid
  schoolId       String   @map("school_id") @db.Uuid
  invoiceId      String   @map("invoice_id") @db.Uuid
  feeItemId      String?  @map("fee_item_id") @db.Uuid
  description    String   @db.VarChar(255)
  amountPesewas  Int      @map("amount_pesewas")
  createdAt      DateTime @default(now()) @map("created_at")

  invoice        Invoice  @relation(fields: [invoiceId], references: [id])
  feeItem        FeeItem? @relation(fields: [feeItemId], references: [id])

  @@index([invoiceId])
  @@map("invoice_line_items")
}

model Payment {
  id               String          @id @default(uuid()) @db.Uuid
  schoolId         String          @map("school_id") @db.Uuid
  invoiceId        String          @map("invoice_id") @db.Uuid
  studentId        String          @map("student_id") @db.Uuid
  amountPesewas    Int             @map("amount_pesewas")
  paymentMethod    PaymentMethod   @map("payment_method")
  paymentReference String?         @map("payment_reference") @db.VarChar(150)
  gateway          PaymentGateway?
  gatewayReference String?         @map("gateway_reference") @db.VarChar(150)
  paidAt           DateTime        @map("paid_at")
  receiptNumber    String          @map("receipt_number") @db.VarChar(80)
  isVerified       Boolean         @default(false) @map("is_verified")
  notes            String?
  createdAt        DateTime        @default(now()) @map("created_at")
  updatedAt        DateTime        @updatedAt @map("updated_at")

  invoice          Invoice         @relation(fields: [invoiceId], references: [id])
  student          Student         @relation(fields: [studentId], references: [id])

  @@unique([schoolId, receiptNumber])
  @@unique([gateway, gatewayReference])
  @@index([schoolId])
  @@index([invoiceId])
  @@map("payments")
}

model PaymentIntent {
  id               String              @id @default(uuid()) @db.Uuid
  schoolId         String              @map("school_id") @db.Uuid
  invoiceId        String              @map("invoice_id") @db.Uuid
  studentId        String              @map("student_id") @db.Uuid
  gateway          PaymentGateway
  amountPesewas    Int                 @map("amount_pesewas")
  currency         String              @default("GHS") @db.Char(3)
  status           PaymentIntentStatus @default(pending)
  gatewayReference String              @map("gateway_reference") @db.VarChar(150)
  authorizationUrl String?             @map("authorization_url")
  expiresAt        DateTime?           @map("expires_at")
  createdAt        DateTime            @default(now()) @map("created_at")
  updatedAt        DateTime            @updatedAt @map("updated_at")

  invoice          Invoice             @relation(fields: [invoiceId], references: [id])

  @@unique([gateway, gatewayReference])
  @@index([schoolId])
  @@map("payment_intents")
}

model PaymentGatewayLog {
  id               String          @id @default(uuid()) @db.Uuid
  schoolId         String          @map("school_id") @db.Uuid
  gateway          PaymentGateway
  eventId          String?         @map("event_id") @db.VarChar(200)
  gatewayReference String?         @map("gateway_reference") @db.VarChar(150)
  eventType        String          @map("event_type") @db.VarChar(150)
  payload          Json
  receivedAt       DateTime        @default(now()) @map("received_at")
  signatureValid   Boolean         @default(false) @map("signature_valid")
  processed        Boolean         @default(false)
  processedAt      DateTime?       @map("processed_at")
  processingError  String?         @map("processing_error")
  invoiceId        String?         @map("invoice_id") @db.Uuid
  paymentIntentId  String?         @map("payment_intent_id") @db.Uuid
  paymentId        String?         @map("payment_id") @db.Uuid

  @@unique([gateway, eventId])
  @@unique([gateway, gatewayReference, eventType])
  @@index([schoolId])
  @@map("payment_gateway_logs")
}

model Notification {
  id             String              @id @default(uuid()) @db.Uuid
  schoolId       String              @map("school_id") @db.Uuid
  senderId       String?             @map("sender_id") @db.Uuid
  type           NotificationType
  subject        String?             @db.VarChar(200)
  body           String
  audience       Json                @default("{}")
  channel        NotificationChannel @default(sms)
  sentAt         DateTime?           @map("sent_at")
  recipientCount Int                 @default(0) @map("recipient_count")
  failureCount   Int                 @default(0) @map("failure_count")
  createdAt      DateTime            @default(now()) @map("created_at")
  updatedAt      DateTime            @updatedAt @map("updated_at")

  sender         User?               @relation(fields: [senderId], references: [id])
  recipients     NotificationRecipient[]

  @@index([schoolId])
  @@map("notifications")
}

model NotificationRecipient {
  id             String                      @id @default(uuid()) @db.Uuid
  schoolId       String                      @map("school_id") @db.Uuid
  notificationId String                      @map("notification_id") @db.Uuid
  guardianId     String?                     @map("guardian_id") @db.Uuid
  studentId      String?                     @map("student_id") @db.Uuid
  phone          String?                     @db.VarChar(30)
  email          String?                     @db.VarChar(150)
  status         NotificationRecipientStatus @default(pending)
  provider       String?                     @db.VarChar(50)
  providerMessageId String?                  @map("provider_message_id") @db.VarChar(150)
  failureReason  String?                     @map("failure_reason")
  sentAt         DateTime?                   @map("sent_at")
  createdAt      DateTime                    @default(now()) @map("created_at")
  updatedAt      DateTime                    @updatedAt @map("updated_at")

  notification   Notification                @relation(fields: [notificationId], references: [id])

  @@index([schoolId])
  @@index([notificationId])
  @@map("notification_recipients")
}

model File {
  id               String   @id @default(uuid()) @db.Uuid
  schoolId         String   @map("school_id") @db.Uuid
  ownerType        String   @map("owner_type") @db.VarChar(80)
  ownerId          String   @map("owner_id") @db.Uuid
  originalFileName String   @map("original_file_name") @db.VarChar(255)
  storedFileName   String   @map("stored_file_name") @db.VarChar(255)
  mimeType         String   @map("mime_type") @db.VarChar(150)
  sizeBytes        BigInt   @map("size_bytes")
  storageBucket    String   @map("storage_bucket") @db.VarChar(150)
  storageKey       String   @map("storage_key")
  checksumSha256   String?  @map("checksum_sha256") @db.VarChar(100)
  isPublic         Boolean  @default(false) @map("is_public")
  uploadedBy       String?  @map("uploaded_by") @db.Uuid
  archivedAt       DateTime? @map("archived_at")
  createdAt        DateTime @default(now()) @map("created_at")

  @@unique([storageBucket, storageKey])
  @@index([schoolId])
  @@index([ownerType, ownerId])
  @@map("files")
}

model ConsentRecord {
  id             String        @id @default(uuid()) @db.Uuid
  schoolId       String        @map("school_id") @db.Uuid
  studentId      String        @map("student_id") @db.Uuid
  guardianId     String        @map("guardian_id") @db.Uuid
  consentType    ConsentType   @map("consent_type")
  granted        Boolean       @default(true)
  grantedAt      DateTime      @default(now()) @map("granted_at")
  ipAddress      String?       @map("ip_address")
  userAgent      String?       @map("user_agent")
  method         ConsentMethod
  consentDetails Json          @default("{}") @map("consent_details")
  revokedAt      DateTime?     @map("revoked_at")
  createdAt      DateTime      @default(now()) @map("created_at")

  @@index([schoolId])
  @@index([studentId])
  @@index([guardianId])
  @@map("consent_records")
}

model AuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  schoolId   String?  @map("school_id") @db.Uuid
  userId     String?  @map("user_id") @db.Uuid
  action     String   @db.VarChar(150)
  entityType String   @map("entity_type") @db.VarChar(150)
  entityId   String?  @map("entity_id") @db.Uuid
  changes    Json?
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([schoolId])
  @@index([userId])
  @@index([entityType, entityId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

---

# 13. Migration Order

Use this order to avoid circular dependency issues:

```txt
1. Enable extensions
   - pgcrypto

2. Create ENUM types

3. Core setup
   - schools
   - academic_years
   - terms
   - levels

4. Users and RBAC
   - users
   - roles
   - permissions
   - role_permissions
   - user_roles

5. Staff and classes
   - staff
   - classrooms
   - add classrooms.class_teacher_id FK

6. Students and guardians
   - students
   - guardians
   - student_guardians
   - admission_applications
   - consent_records

7. Enrollments
   - enrollments
   - promotion_records

8. Curriculum
   - curriculum_tracks
   - subjects
   - class_subjects
   - subject_assignments

9. Attendance
   - attendance_sessions
   - attendance_records
   - attendance_lock_settings

10. Assessment and grading
   - assessment_types
   - assessment_scores
   - grading_scales
   - grading_formula_configs

11. Report cards
   - report_card_templates
   - report_cards

12. Finance
   - fee_items
   - fee_schedules
   - invoices
   - invoice_line_items
   - invoice_discounts
   - payments

13. Payments
   - payment_intents
   - payment_gateway_logs

14. Notifications
   - message_templates
   - notifications
   - notification_recipients
   - sms_provider_logs

15. Files
   - files
   - report_card_files
   - add report_card_files.file_id FK

16. Compliance
   - audit_logs
   - data_subject_requests
   - security_incidents
   - backup_runs

17. Triggers
   - updated_at trigger
   - audit log immutability trigger

18. Seed data
   - default permissions
   - default roles
   - default curriculum tracks
   - initial school profile
```

---

# 14. Open Questions Before Implementation

The PRD warns that several academic and compliance details must be confirmed directly with the school before development.

Key questions:

```txt
1. What exact report card formats does the school currently use?
2. Does the school want one report card or separate GES and ABEKA reports?
3. What SBA/exam weights are used per level and subject?
4. What ABEKA GPA scale should be used?
5. Does ABEKA require transcript export in a specific format?
6. Is Ghana Card required for all students or only older students?
7. What are the exact early childhood milestone categories?
8. What fee categories and level-specific fee schedules are used?
9. Which payment gateway does the school prefer: Paystack or Hubtel?
10. Which SMS provider should be used first: Arkesel, mNotify, or Hubtel SMS?
11. What is the attendance edit-lock period?
12. Who approves report cards?
13. Should parent accounts be created automatically or manually?
14. What data retention period should the school apply?
15. Has the school registered with the Data Protection Commission?
```

---

# Practical Implementation Recommendation

Implement the schema in **Prisma for normal application tables**, then use **raw SQL migrations** for PostgreSQL-specific features like:

```txt
Partial unique indexes
GIN indexes
Immutable audit triggers
Stricter check constraints
Updated_at triggers
```

This gives you the benefit of Prisma’s type-safe development while still preserving the PostgreSQL-specific rules that matter for payments, audit logs, JSONB search, and compliance.
