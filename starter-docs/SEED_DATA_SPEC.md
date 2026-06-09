# Seed Data Specification — Phase 1

## Purpose

This file defines the default seed data Claude Code should create for Phase 1 of the Ghanaian private school management system MVP.

The seed script should be idempotent. Running it more than once should not create duplicate schools, roles, permissions, document sequences, or users.

---

## 1. Default School

Create one default school.

```ts
{
  name: process.env.SEED_SCHOOL_NAME || "Demo Ghana Private School",
  slug: process.env.SEED_SCHOOL_SLUG || "demo-ghana-private-school",
  phone: "233200000000",
  email: "admin@example.com",
  address: "Accra, Ghana",
  ghanaPostGps: null,
  motto: null,
  registrationNumber: null,
  isActive: true
}
```

---

## 2. Default School Settings

Seed the following settings for the default school.

```txt
academic.default_curriculum_scope = "BOTH"
academic.primary_calendar = "GES_TERM_STRUCTURE"
auth.access_token_minutes = 15
auth.refresh_token_days = 14
files.default_storage_bucket = value from S3_BUCKET
files.private_by_default = true
students.ghana_card_required = false
students.student_number_format = "{PREFIX}-{YEAR}-{SEQUENCE}"
admissions.admission_number_format = "ADM-{YEAR}-{SEQUENCE}"
staff.staff_number_format = "STF-{YEAR}-{SEQUENCE}"
```

Store each setting in `school_settings.valueJson`.

Example:

```json
{
  "value": false,
  "type": "boolean"
}
```

---

## 3. Document Sequences

Seed these document sequences for the default school:

```txt
student_number
admission_number
staff_number
invoice_number
receipt_number
```

Suggested defaults:

```ts
[
  { type: "student_number", prefix: "STU", currentNumber: 0, paddingLength: 4, resetPolicy: "yearly" },
  { type: "admission_number", prefix: "ADM", currentNumber: 0, paddingLength: 4, resetPolicy: "yearly" },
  { type: "staff_number", prefix: "STF", currentNumber: 0, paddingLength: 4, resetPolicy: "yearly" },
  { type: "invoice_number", prefix: "INV", currentNumber: 0, paddingLength: 5, resetPolicy: "yearly" },
  { type: "receipt_number", prefix: "RCT", currentNumber: 0, paddingLength: 5, resetPolicy: "yearly" }
]
```

Invoice and receipt sequences are seeded for future readiness only. Do not build finance tables in Phase 1.

---

## 4. Permission Keys

Seed these permissions.

```txt
auth.login
auth.refresh
auth.logout
auth.change_password

users.create
users.read
users.update
users.deactivate
users.manage_roles

roles.create
roles.read
roles.update
roles.assign_permissions

permissions.read

school.read
school.update

school_settings.read
school_settings.update

document_sequences.read
document_sequences.update
document_sequences.generate

academic_years.create
academic_years.read
academic_years.update
academic_years.activate
academic_years.close

terms.create
terms.read
terms.update
terms.activate
terms.close

levels.create
levels.read
levels.update
levels.archive

classrooms.create
classrooms.read
classrooms.update
classrooms.assign_teacher
classrooms.archive

staff.create
staff.read
staff.update
staff.archive

students.create
students.read
students.update
students.archive

guardians.create
guardians.read
guardians.update
guardians.archive

student_guardians.manage

admissions.create
admissions.read
admissions.update
admissions.approve
admissions.enroll

enrollments.create
enrollments.read
enrollments.update
enrollments.withdraw

files.upload
files.read
files.archive

audit_logs.read
```

---

## 5. System Roles

Seed these roles with `schoolId = null`.

```txt
SUPER_ADMIN
SCHOOL_ADMIN
HEADTEACHER
ACADEMIC_COORDINATOR
CLASS_TEACHER
ADMISSIONS_OFFICER
PARENT_GUARDIAN
COMPLIANCE_OFFICER
```

Use:

```ts
isSystemRole: true
isActive: true
```

---

## 6. Role-Permission Mapping

### SUPER_ADMIN

Assign all permissions.

### SCHOOL_ADMIN

Assign all Phase 1 operational permissions except direct audit mutation, because audit logs are read-only.

Suggested:

```txt
users.*
roles.*
permissions.read
school.*
school_settings.*
document_sequences.*
academic_years.*
terms.*
levels.*
classrooms.*
staff.*
students.*
guardians.*
student_guardians.manage
admissions.*
enrollments.*
files.*
audit_logs.read
```

### HEADTEACHER

```txt
school.read
academic_years.read
terms.read
levels.read
classrooms.read
staff.read
students.read
guardians.read
admissions.read
enrollments.read
files.read
audit_logs.read
```

### ACADEMIC_COORDINATOR

```txt
academic_years.read
terms.read
levels.*
classrooms.*
staff.read
students.read
guardians.read
enrollments.*
```

### CLASS_TEACHER

```txt
classrooms.read
students.read
guardians.read
enrollments.read
files.read
```

### ADMISSIONS_OFFICER

```txt
students.create
students.read
students.update
guardians.create
guardians.read
guardians.update
student_guardians.manage
admissions.*
enrollments.create
enrollments.read
files.upload
files.read
```

### PARENT_GUARDIAN

```txt
students.read
guardians.read
files.read
```

Parent/guardian access must still be constrained to linked students only.

### COMPLIANCE_OFFICER

```txt
audit_logs.read
students.read
guardians.read
staff.read
files.read
```

---

## 7. Super Admin User

Create one Super Admin user from environment values.

Required:

```txt
SEED_SUPER_ADMIN_EMAIL
SEED_SUPER_ADMIN_PHONE
SEED_SUPER_ADMIN_PASSWORD
```

Implementation notes:

- Create a staff record for the Super Admin or a system staff placeholder.
- Create the user linked to that staff record.
- Hash the password using argon2 or bcrypt.
- Set `mustChangePassword` to `true`.
- Assign the `SUPER_ADMIN` role.
- Write an audit log with `actorType = "seed"`.
