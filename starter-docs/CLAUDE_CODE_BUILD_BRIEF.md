# Claude Code Build Brief — Ghana School Management System Phase 1

## Goal

Build Phase 1 of a Ghanaian private school management system MVP.

The system is for a private basic school in Ghana from Creche/Nursery to JHS. The full product will eventually support GES/NaCCA and ABEKA curricula, but Phase 1 is only the foundation layer.

This build is **backend-only** for now.

Do not build the Next.js frontend, UI pages, React components, frontend routing, or frontend API clients yet.

---

## Tech Stack

## Backend

Use:

```txt
NestJS
TypeScript
Prisma
PostgreSQL
JWT access tokens
Refresh tokens stored as hashed values in user_sessions
HTTP-only refresh cookie
bcrypt or argon2 for password hashing
```

## Frontend

Do not build frontend yet unless explicitly instructed.

## Database

Use the provided Prisma schema:

```txt
phase_1_school_management_schema.prisma
```

Use the provided raw SQL migration file after Prisma migration:

```txt
phase_1_required_raw_sql_migrations.sql
```

---

## Documents to Read First

Read these files in this order:

```txt
1. CLAUDE_CODE_BUILD_BRIEF.md
2. _phase_1_schema_review.md
3. MODULE_BOUNDARIES_PHASE_1.md
4. phase_1_school_management_schema.prisma
5. phase_1_required_raw_sql_migrations.sql
6. SEED_DATA_SPEC.md
7. PROJECT_STRUCTURE.md
8. API_ENDPOINTS_PHASE_1.md
9. PERMISSIONS_MATRIX_PHASE_1.md
10. IMPLEMENTATION_CHECKLIST_PHASE_1.md
11. TEST_PLAN_PHASE_1.md
12. .env.example
```

Use the PRD and technical architecture only as reference documents.

---

## Phase 1 Scope

Build only:

1. Prisma setup
2. Database migration setup
3. Seed script
4. Auth module
5. Users module
6. Roles and permissions module
7. User sessions / refresh token handling
8. Auth tokens for password reset, OTP, account setup, phone verification, and email verification
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

## Do Not Build Yet

Do not build these in Phase 1:

```txt
Attendance
Assessment
Grading
Report cards
Fees
Invoices
Payments
Payment gateways
SMS
WhatsApp
USSD
Notifications
Parent portal
Data subject requests
Security incident workflow
Backup dashboard
AI comments
Mobile app
Next.js frontend
Frontend API client
Frontend route protection
Frontend forms/tables/pages
```

If any of these appear necessary during Phase 1, leave a TODO comment and do not implement them.

---

## Important Build Rules

- Build Phase 1 only.
- Backend only.
- Use NestJS, TypeScript, Prisma, and PostgreSQL.
- Use REST APIs.
- Use the provided Prisma schema as the database source of truth.
- Apply the raw SQL migration after the Prisma migration.
- Follow `MODULE_BOUNDARIES_PHASE_1.md` to avoid circular dependencies and spaghetti imports.
- Use `schoolId` on tenant-owned records.
- Do not trust `schoolId` from frontend requests.
- Resolve `schoolId` from the authenticated user/session.
- Every tenant-owned list/query must filter by `schoolId`.
- Validate same-school relationships before creating child records.
- Parents/guardians must only access linked students.
- Staff users must only access records allowed by their permissions.
- Use RBAC permission keys, not hardcoded role names.
- Write audit logs in the backend service layer for sensitive actions.
- Audit logs are immutable at database level using the raw SQL trigger.
- Files are metadata only in Phase 1.
- Do not store file bytes in PostgreSQL.
- File storage should be private by default.
- Do not expose raw storage paths as public URLs.
- Do not implement binary file upload unless explicitly instructed.

---

## Auth Requirements

Implement:

```txt
Login with email or phone + password
JWT access token
Refresh token in HTTP-only cookie
Refresh token rotation
Logout/revoke session
Password change
Password reset token table support
Account setup token support
Phone/email verification token support where needed
```

Security rules:

```txt
Do not store raw refresh tokens.
Do not store raw reset tokens.
Do not store raw OTPs.
Store only token hashes.
Use bcrypt or argon2 for password hashing.
Rate-limit login, refresh, OTP, and password reset endpoints.
Revoke old sessions on password change.
Mark sessions revoked on logout.
```

Recommended access token payload:

```json
{
  "sub": "userId",
  "schoolId": "schoolId",
  "sessionId": "userSessionId",
  "permissions": ["students.read", "students.create"]
}
```

---

## Seed Requirements

Create a seed script that seeds:

```txt
One school
Default school settings
Document sequences
Permissions
System roles
Role-permission mappings
One Super Admin staff record
One Super Admin user
SUPER_ADMIN role assignment
Initial seed audit log
```

The seed script must be idempotent.

Running the seed script more than once should not create duplicates.

---

## Required Commands

The project should support:

```bash
npm run prisma:format
npm run prisma:validate
npm run prisma:migrate
npm run prisma:generate
npm run prisma:seed
npm run start:dev
npm run test
```

Suggested script meanings:

```txt
prisma:format    -> npx prisma format
prisma:validate  -> npx prisma validate
prisma:migrate   -> npx prisma migrate dev
prisma:generate  -> npx prisma generate
prisma:seed      -> prisma db seed or ts-node prisma/seed.ts
start:dev        -> nest start --watch
test             -> jest
```

---

## Implementation Order

Build in this order:

```txt
1. Project setup
2. Prisma module/service
3. Config module
4. Seed script
5. Auth module
6. RBAC/permissions guard
7. Users module
8. Roles and permissions module
9. School module
10. School settings module
11. Document sequences module
12. Academic years module
13. Terms module
14. Levels module
15. Staff module
16. Classrooms module
17. Students module
18. Guardians module
19. Student-guardian relationships module
20. Admissions module
21. Enrollments module
22. Files metadata module
23. Audit logs module
24. Tests
```

Do not move to business modules until Prisma validates successfully.

---

## First Task for Claude Code

Before coding business modules:

1. Inspect the provided Prisma schema for syntax issues.
2. Set up the NestJS project structure according to `PROJECT_STRUCTURE.md`.
3. Configure Prisma.
4. Place the schema at `prisma/schema.prisma`.
5. Add package scripts for Prisma and dev commands.
6. Run or prepare validation with:
   - `npm run prisma:format`
   - `npm run prisma:validate`
7. Do not build business modules until Prisma validates successfully.

---

## Module Boundary Rules

Follow `MODULE_BOUNDARIES_PHASE_1.md`.

Important examples:

```txt
Auth may depend on Users, Roles, UserSessions, AuthTokens, and AuditLogs.
Users may depend on Roles and AuditLogs.
Roles must not depend on Auth.
Students may depend on StudentGuardians and read enrollment helpers only.
Admissions may depend on Students, Guardians, StudentGuardians, Levels, and Enrollments.
Enrollments may depend on Students, Classrooms, and AcademicYears.
Files should store metadata only and should not depend on upload providers yet.
AuditLogs should be used by services but should not depend on business modules.
DocumentSequences may be used by Staff, Students, Admissions, and future finance modules.
DocumentSequences must not depend on those business modules.
```

Avoid circular dependencies. Avoid `forwardRef()` unless there is no clean alternative.

---

## Tenant Isolation Rules

For every tenant-owned service:

1. Get `schoolId` from authenticated user/session.
2. Ignore or reject `schoolId` sent in request body.
3. Add `schoolId` to all `where` clauses.
4. Before linking records, verify all records belong to the same school.
5. Never expose data from another school.
6. Add tests for cross-school access denial.

High-risk operations:

```txt
Creating users
Assigning roles
Creating staff
Assigning class teachers
Creating students
Creating guardians
Linking student guardians
Creating admissions
Creating enrollments
Creating file metadata
Reading audit logs
```

---

## Audit Log Rules

Audit logs should be written for sensitive actions, including:

```txt
Login
Failed login where appropriate
Logout/session revoke
Password change
Password reset
User creation/update/deactivation
Role assignment/removal
Permission changes
School profile changes
School setting changes
Document sequence updates
Academic year/term creation or activation
Level/classroom changes
Staff creation/update/archive
Student creation/update/archive
Guardian creation/update/archive
Student-guardian link/unlink
Admission status changes
Enrollment creation/update/withdrawal
File metadata creation/archive
```

Audit logs must have read-only endpoints only.

Do not create update or delete endpoints for audit logs.

---

## File Metadata Rules

Phase 1 files are metadata only.

Build:

```txt
Create file metadata
List file metadata
Get file metadata
List files by owner
Archive file metadata
```

Do not build binary upload yet unless explicitly instructed.

Store:

```txt
storageBucket
storageKey
mimeType
sizeBytes
category
ownerType
ownerId
isPublic = false by default
```

Do not expose raw storage paths as public URLs.

---

## Testing Focus

Add tests for:

```txt
Auth login and refresh
Refresh token rotation
Logout/session revoke
Password change
RBAC permission checks
Tenant isolation
Document sequence concurrency
Academic year/term constraints
Student-guardian relationship rules
Admission and enrollment flows
Files metadata rules
Audit log immutability
```

---

## Completion Criteria

Phase 1 is complete when:

```txt
Prisma validates
Prisma migration runs
Raw SQL migration is applied
Seed script runs idempotently
Auth works with access and refresh tokens
RBAC works with permission keys
Tenant isolation is enforced in services
Core Phase 1 modules expose REST endpoints
Audit logs are written for sensitive actions
Audit logs cannot be updated or deleted
Files metadata module exists without binary upload
Tests cover critical security and data-integrity rules
No Phase 2 modules are built
No frontend is built
```

---

## Final Instruction

Build only Phase 1.

Use the provided Prisma schema and raw SQL migration as the database source of truth.

Prioritize:

```txt
Correct database setup
Secure auth/session flow
Strict tenant isolation
RBAC with permission keys
Transaction-safe document sequence generation
Safe student/guardian/admission/enrollment flows
Immutable audit logs
Clean NestJS modular structure
Tests for critical rules
```
