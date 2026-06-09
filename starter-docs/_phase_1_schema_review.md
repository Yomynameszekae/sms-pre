# Phase 1 Schema Review & Build Notes

**Project:** Ghanaian Private School Management System MVP  
**Target builder:** Claude Code  
**Backend stack:** NestJS, TypeScript, Prisma, PostgreSQL  
**Frontend:** Next.js planned later; do not build in Phase 1 unless explicitly instructed.  
**Auth:** JWT access tokens, hashed refresh tokens in `user_sessions`, HTTP-only refresh cookie.  
**Status:** Phase 1 foundation schema is ready to build after applying the provided Prisma schema and raw SQL migration files.

---

## 1. Purpose of This File

This file summarizes the final Phase 1 schema review and implementation corrections for Claude Code.

It should be used together with:

1. `CLAUDE_CODE_BUILD_BRIEF.md`
2. `phase_1_school_management_schema.prisma`
3. `phase_1_required_raw_sql_migrations.sql`
4. `Ghana_SMS_PRD_MVP_Plan.pdf`
5. `school_management_system_technical_architecture.md`
6. This file: `_phase_1_schema_review.md`

The goal is to make sure Phase 1 is built only around the foundation layer and does not accidentally drift into attendance, grading, report cards, finance, payments, SMS, notifications, or parent portal work.

---

## 2. Phase 1 Scope Confirmed

Build only these modules:

1. Prisma setup
2. Database migration setup
3. Seed script
4. Auth module
5. Users module
6. Roles and permissions module
7. User sessions / refresh token handling
8. Auth tokens for password reset, account setup, phone verification, email verification, and OTP
9. School setup module
10. School settings module
11. Document sequences module
12. Academic years module
13. Terms module
14. Levels module
15. Classrooms module
16. Staff module
17. Students module
18. Guardians module
19. Student-guardian relationships
20. Admissions module
21. Enrollments module
22. Files metadata module
23. Audit logs module

---

## 3. Do Not Build in Phase 1

Do not build these yet:

- Attendance
- Assessment
- Grading
- Report cards
- Curriculum subject catalogue
- Subject teacher assignments
- Fee items
- Fee schedules
- Invoices
- Payments
- Payment intents
- Payment gateways
- SMS
- WhatsApp
- USSD
- Notifications
- Parent portal
- Data subject requests
- Security incident workflow
- Backup dashboard
- AI-generated comments
- Mobile app

These belong to Phase 2 or later.

---

## 4. Final Phase 1 Prisma Schema Readiness

The final Prisma schema should be considered **implementation-ready** after applying the following corrections:

### Critical corrections already applied

- `user_sessions` added instead of storing only one refresh token on `users`.
- `auth_tokens` added for password reset, account setup, phone verification, email verification, and OTP.
- `school_settings` added for configurable operational settings.
- `document_sequences` added for student numbers, admission numbers, staff numbers, and future invoice/receipt numbers.
- `relationship` removed from `guardians`.
- `relationship` kept on `student_guardians`.
- `schoolId` kept on tenant-owned tables.
- Ghana Card kept optional on `students`.
- UUID primary keys used across tables.
- `createdAt`, `updatedAt`, `createdBy`, and `updatedBy` included where appropriate.
- `archivedAt` included for students, guardians, staff, and files.
- `admissionNumber` left nullable.
- Prisma-level `@@unique([schoolId, admissionNumber])` removed because `admissionNumber` is nullable.
- Date-only defaults changed from `@default(now()) @db.Date` to `@default(dbgenerated("CURRENT_DATE"))`.
- Optional JSON defaults changed to non-nullable JSON where appropriate.
- `requestId` added to `AuditLog`.
- `actorType` added to `AuditLog`.
- `revokedReason` added to `UserSession`.
- `replacedBySessionId` added to `UserSession`.
- `category` added to `File`.
- `storageBucket` made required on `File`.
- Useful compound indexes added:
  - `[schoolId, status]` for Staff, Student, AdmissionApplication, Enrollment
  - `[schoolId, lastName, firstName]` for Student and Guardian
  - `[schoolId, createdAt]`, `[schoolId, action]`, `[schoolId, entityType, entityId]` for AuditLog

---

## 5. Important Prisma Validation Warning

Claude Code should inspect the provided Prisma schema before running migration commands.

The schema should be checked with:

```bash
npx prisma format
npx prisma validate
```

If validation fails, first check these areas:

1. Relation names involving `UserSession.replacedBySession`.
2. Relation fields involving `User.grantedRoles`.
3. Relation fields involving `File.uploadedByUser`.
4. Any typo where `id` may have been accidentally replaced with `schoolId`.
5. Prisma enum names versus mapped PostgreSQL enum names.

Do not redesign the schema unless a real Prisma validation error requires it.

---

## 6. Required Raw SQL Migrations

The raw SQL migration file must be applied after the Prisma migration.

Required raw SQL responsibilities:

1. Enable `pgcrypto`.
2. Add case-insensitive unique email indexes.
3. Add partial unique indexes that Prisma cannot express cleanly.
4. Add one-active-academic-year-per-school rule.
5. Add one-active-term-per-school rule.
6. Add one-primary-guardian-per-student rule.
7. Add one-active-enrollment-per-student-year rule.
8. Add check constraints.
9. Add immutable audit log trigger.

The provided file is:

```txt
phase_1_required_raw_sql_migrations.sql
```

Do not skip this file.

---

## 7. Migration Order

Use this order:

```txt
1. Create NestJS project and install dependencies.
2. Add Prisma.
3. Place the Prisma schema in `prisma/schema.prisma`.
4. Create the first Prisma migration.
5. Run Prisma format and validate.
6. Run Prisma migration.
7. Apply the raw SQL migration file.
8. Generate Prisma Client.
9. Create seed script.
10. Seed default data.
11. Build modules in the order listed below.
```

Recommended commands:

```bash
npm run prisma:format
npm run prisma:validate
npm run prisma:migrate
npm run prisma:generate
npm run prisma:seed
npm run start:dev
```

---

## 8. Recommended Module Build Order

Claude Code should build the backend in this order:

1. Project setup
2. Prisma module/service
3. Config module
4. Auth module
5. RBAC/permissions guard
6. Users module
7. Roles and permissions module
8. School module
9. School settings module
10. Document sequences module
11. Academic years module
12. Terms module
13. Levels module
14. Staff module
15. Classrooms module
16. Students module
17. Guardians module
18. Student-guardian relationships module
19. Admissions module
20. Enrollments module
21. Files metadata module
22. Audit logs module
23. Seed script
24. Basic tests

---

## 9. Tenant Isolation Rules

The system is single-school for MVP but must be coded with future multi-tenant readiness.

Rules:

- Every tenant-owned query must filter by `schoolId`.
- Do not trust `schoolId` from frontend request bodies.
- Resolve `schoolId` from the authenticated user/session.
- When creating child records, verify all parent records belong to the same school.
- Do not allow cross-school relationships.
- Do not expose records from another school even if the user guesses the UUID.
- Use `schoolId` in services, guards, and repository queries.
- Future multi-tenant work may add composite foreign keys, but Phase 1 can enforce tenant isolation in service logic and tests.

High-risk areas that need tenant checks:

- User creation
- Role assignment
- Staff creation
- Classroom assignment
- Student creation
- Guardian linking
- Admission creation
- Enrollment creation
- File metadata creation
- Audit log creation

---

## 10. Auth and Session Design Rules

Implement:

- Login with email or phone + password.
- Short-lived JWT access token.
- Refresh token stored in HTTP-only secure cookie.
- Store only hashed refresh tokens in `user_sessions`.
- Rotate refresh tokens on refresh.
- Revoke old refresh session on rotation.
- Logout should set `revokedAt` and `revokedReason`.
- Password change should revoke existing sessions, except optionally the current one.
- Password reset and account setup should use `auth_tokens`.
- Store only hashed reset/setup/OTP tokens.
- Never store raw OTPs, raw refresh tokens, or raw reset tokens.
- Rate-limit login, refresh, OTP, and reset endpoints.
- Use bcrypt or argon2 for password hashing.

Recommended access token payload:

```json
{
  "sub": "userId",
  "schoolId": "schoolId",
  "sessionId": "userSessionId",
  "permissions": ["students.read", "students.create"]
}
```

Permissions may also be fetched from the database per request if token size becomes a concern.

---

## 11. RBAC Design Rules

Use permission keys, not hardcoded role names.

Correct pattern:

```ts
@RequirePermissions('students.create')
```

Avoid:

```ts
if (user.role === 'SCHOOL_ADMIN')
```

Seed system roles first. For single-school MVP, users may be assigned system roles directly.

Recommended Phase 1 roles:

- SUPER_ADMIN
- SCHOOL_ADMIN
- HEADTEACHER
- ACADEMIC_COORDINATOR
- CLASS_TEACHER
- ADMISSIONS_OFFICER
- PARENT_GUARDIAN
- COMPLIANCE_OFFICER

Do not build Bursar-specific finance features yet, even if the Bursar role exists in the wider PRD.

---

## 12. Seed Script Requirements

The seed script should create:

1. One school
2. Default school settings
3. Document sequences
4. Permissions
5. System roles
6. Role-permission mappings
7. One Super Admin user

Default document sequences:

- `student_number`
- `admission_number`
- `staff_number`
- `invoice_number`
- `receipt_number`

Invoice and receipt sequences can be seeded now for future readiness, but finance tables must not be built in Phase 1.

---

## 13. Suggested Phase 1 Permission Keys

Use these as a starting point:

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

## 14. File Storage Design Rules

Phase 1 should store file metadata only.

Do not store file bytes in PostgreSQL.

File handling rules:

- Files are private by default.
- `storageBucket` is required.
- `storageKey` is required.
- `publicUrl` should usually remain null.
- Use signed URLs later when actual file upload/download is implemented.
- Do not expose raw storage paths to users.
- Use `category` to distinguish file purpose.

Suggested file categories:

```txt
school_logo
student_profile_photo
student_document
ghana_card
admission_document
staff_profile_photo
staff_police_clearance
staff_medical_certificate
guardian_document
other
```

---

## 15. Audit Log Design Rules

Audit logs must be written from the backend service layer for sensitive actions.

The raw SQL migration makes `audit_logs` immutable by blocking update and delete operations.

Audit log should capture:

- User login
- Failed login attempt, where appropriate
- Logout/session revoke
- User creation/update/deactivation
- Role assignment/removal
- Permission changes
- School setting changes
- Academic year/term changes
- Student creation/update/archive
- Guardian creation/update/archive
- Student-guardian linking/unlinking
- Admission status changes
- Enrollment creation/update/withdrawal
- File metadata creation/archive

Use `requestId` to group logs from one API request.

Use `actorType` for:

```txt
user
system
seed
job
```

---

## 16. Implementation Notes for Core Modules

### School module

Required operations:

- Get current school
- Update school profile
- Read school metadata

Do not build multi-school onboarding yet unless explicitly instructed.

### School settings module

Required operations:

- List settings
- Get setting by key
- Update setting
- Seed defaults

Use `valueJson` for flexible values.

### Document sequences module

Required operations:

- Get sequence
- Generate next number
- Update sequence configuration

Important: sequence generation must be transaction-safe.

Use a database transaction when incrementing `currentNumber`.

### Academic years module

Required operations:

- Create academic year
- List academic years
- Activate academic year
- Update academic year
- Close/deactivate academic year

Raw SQL ensures only one active academic year per school.

### Terms module

Required operations:

- Create term
- List terms
- Activate term
- Close term
- Update term dates

Raw SQL ensures only one active term per school.

### Levels module

Required operations:

- Create level
- List levels
- Update level
- Archive/deactivate level

### Classrooms module

Required operations:

- Create classroom
- List classrooms
- Update classroom
- Assign class teacher
- Archive/deactivate classroom

When assigning class teacher, verify:

- Staff exists.
- Staff belongs to the same school.
- Staff has appropriate role category or permission.

### Staff module

Required operations:

- Create staff
- List staff
- Get staff
- Update staff
- Archive staff

Do not physically delete staff.

### Students module

Required operations:

- Create student
- List students
- Get student
- Update student
- Archive student

Do not physically delete students.

Ghana Card is optional.

### Guardians module

Required operations:

- Create guardian
- List guardians
- Get guardian
- Update guardian
- Archive guardian

Relationship to student belongs in `student_guardians`, not `guardians`.

### Student-guardian module

Required operations:

- Link guardian to student
- Update relationship flags
- Set primary guardian
- Set emergency contact
- Unlink guardian from student if appropriate

Raw SQL allows only one primary guardian per student.

### Admissions module

Required operations:

- Create enquiry/application
- Update application
- Change admission status
- Offer admission
- Enroll admission into student/enrollment flow

Admission number is nullable and unique only when present through raw SQL partial unique index.

### Enrollments module

Required operations:

- Create enrollment
- List enrollments
- Update enrollment
- Withdraw/transfer student
- Get current enrollment

Raw SQL prevents more than one active enrollment per student per academic year.

### Files metadata module

Required operations:

- Create file metadata
- List files by owner
- Get file metadata
- Archive file metadata

No binary upload implementation is required unless explicitly instructed.

### Audit logs module

Required operations:

- Create audit log internally
- List audit logs for authorized users
- Filter by action, entity, requestId, date
- Read-only API only

Never expose update/delete endpoints for audit logs.

---

## 17. Suggested API Route Groups

Suggested REST route groups:

```txt
/auth
/users
/roles
/permissions
/school
/school-settings
/document-sequences
/academic-years
/terms
/levels
/classrooms
/staff
/students
/guardians
/student-guardians
/admissions
/enrollments
/files
/audit-logs
```

Do not create routes for Phase 2 modules yet.

---

## 18. Testing Requirements

At minimum, add tests for:

### Auth

- Login succeeds with email.
- Login succeeds with phone.
- Login fails with wrong password.
- Refresh token rotation works.
- Logout revokes session.
- Revoked refresh token cannot be reused.
- Password change revokes previous sessions.

### RBAC

- User without permission cannot access protected route.
- User with permission can access protected route.
- Permission guard checks permission keys, not role names.

### Tenant isolation

- User cannot read another school’s student.
- User cannot link guardian from another school.
- User cannot enroll student into classroom from another school.
- User cannot assign staff from another school as class teacher.

### Document sequences

- Generated numbers increment correctly.
- Concurrent generation does not create duplicates.

### Audit logs

- Sensitive actions create audit logs.
- Audit logs cannot be updated.
- Audit logs cannot be deleted.

---

## 19. Current Document Set Check

The documents gathered so far are enough to begin Phase 1:

1. `CLAUDE_CODE_BUILD_BRIEF.md`
2. `phase_1_school_management_schema.prisma`
3. `phase_1_required_raw_sql_migrations.sql`
4. `Ghana_SMS_PRD_MVP_Plan.pdf`
5. `school_management_system_technical_architecture.md`
6. `_phase_1_schema_review.md`

These are the core build documents Claude Code needs.

---

## 20. Recommended Extra Files to Add

The current documents are enough, but these extra files would make implementation smoother:

### Strongly recommended

1. `.env.example`

Include:

```env
DATABASE_URL=
JWT_ACCESS_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN_DAYS=14
COOKIE_DOMAIN=
COOKIE_SECURE=false
PASSWORD_HASH_ALGORITHM=argon2
S3_BUCKET=
S3_REGION=
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

2. `SEED_DATA_SPEC.md`

Describe:

- Default school
- Default permissions
- Default roles
- Role-permission mapping
- Super Admin user
- Default school settings
- Default document sequences

3. `API_ENDPOINTS_PHASE_1.md`

List expected routes, request DTOs, response shape, and required permissions.

4. `IMPLEMENTATION_CHECKLIST_PHASE_1.md`

A step-by-step checklist Claude Code can follow and mark complete.

### Optional but helpful

5. `TEST_PLAN_PHASE_1.md`

List auth, RBAC, tenant isolation, audit, and sequence tests.

6. `PROJECT_STRUCTURE.md`

Define expected NestJS folder/module structure.

7. `PERMISSIONS_MATRIX_PHASE_1.md`

A clear matrix of roles mapped to permission keys.

---

## 21. Final Build Instruction for Claude Code

Build only Phase 1.

Use the provided Prisma schema and raw SQL migration file as the database source of truth.

Do not add Phase 2 tables or modules.

Prioritize:

1. Correct database setup
2. Secure auth/session flow
3. Strict tenant isolation
4. RBAC with permission keys
5. Transaction-safe document sequence generation
6. Safe student/guardian/admission/enrollment flows
7. Immutable audit logs
8. Clean NestJS modular structure

The backend should be usable as a stable foundation for Phase 2 academic, finance, communication, and parent portal modules.
