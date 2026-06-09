# Phase 1 Build — Identified Risks & Contradictions

## Critical (must fix before migration)

### R1 — Unnamed UserRole relation (Prisma validation will fail)
**Location:** `prisma/schema.prisma` — `User` model and `UserRole` model  
**Problem:** `User` has two relations to `UserRole`:
- `roles UserRole[]` (unnamed)
- `grantedRoles UserRole[] @relation("GrantedUserRoles")` (named)

Prisma requires ALL relations between the same two models to be named when there are multiple. The unnamed pair will fail `prisma validate`.  
**Fix applied:** Named the first pair `"UserRoles"`:
- `User.roles` → `@relation("UserRoles")`
- `UserRole.user` → `@relation("UserRoles", ...)`

### R2 — gen_random_uuid() requires PostgreSQL 13+ or pgcrypto
**Location:** All models use `@default(dbgenerated("gen_random_uuid()"))`  
**Problem:** `gen_random_uuid()` is built-in in PostgreSQL 13+. For PostgreSQL ≤ 12, it requires the `pgcrypto` extension. The raw SQL migration runs `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` — but that runs **after** the Prisma migration.  
**Mitigation:** PostgreSQL 14+ is assumed. If using PostgreSQL ≤ 12, run `CREATE EXTENSION IF NOT EXISTS pgcrypto;` manually before `prisma migrate dev`. Added a note to `.env.example` and the migration script.

---

## Medium (design decisions to be aware of)

### R3 — Enrollment unique constraint vs. dual-curriculum
**Location:** `enrollments` table  
`@@unique([studentId, academicYearId, curriculumTrack])` + partial unique index `uq_one_active_enrollment_per_student_year ON enrollments (student_id, academic_year_id) WHERE status = 'active'`  
**Implication:** A student can technically have two enrollments in the same year in different curriculum tracks. The partial unique index then prevents having **two active** enrollments per year regardless of track. This is intentional for the dual-curriculum (GES/ABEKA) school model — accepted as designed.

### R4 — User must always be linked to Staff or Guardian
**Location:** `User.linkedEntityType` is required (non-nullable), `User.linkedEntityId` is required  
**Implication:** You cannot create a User without first having a Staff or Guardian record. The seed script must create a Staff record first, then create the Super Admin User pointing to it.  
**Handled:** Seed creates Staff record first, then User.

### R5 — Admissions is a high-dependency orchestration module
**Location:** `AdmissionsModule`  
Admissions may depend on Students, Guardians, StudentGuardians, Levels, and Enrollments. This is the most complex module. Risk of accidental circular import if any of those modules imports Admissions.  
**Mitigation:** Strictly follow MODULE_BOUNDARIES. Admissions → Students, Guardians, StudentGuardians, Levels, Enrollments. None of those must import Admissions.

### R6 — Rate limiting on auth endpoints
`@nestjs/throttler` must be configured for login, refresh, OTP, and password reset. Guard must be applied at controller or global level.  
**Plan:** Apply `ThrottlerGuard` globally; override with custom limits on sensitive auth endpoints.

---

## Low (watch-outs during implementation)

### R7 — Term status enum uses lowercase values
Prisma enum `TermStatus { draft active closed }` maps to PostgreSQL type `term_status`. The raw SQL uses `WHERE status = 'active'` — matches lowercase. Fine, but ensure seed/service code uses lowercase string values or the Prisma enum members.

### R8 — Role.schoolId is nullable (system roles)
System roles have `schoolId = null`. The raw SQL creates two partial unique indexes (`uq_system_role_code` and `uq_school_role_code`). Service layer must handle both when looking up roles.

### R9 — admissionNumber nullable unique
`admission_number` is nullable. Prisma `@@unique` on nullable fields is tricky. The schema correctly omits Prisma-level unique and instead uses a raw SQL partial unique index. Ensure service layer does not try to enforce unique at application level.

### R10 — Files have no binary upload in Phase 1
`FilesModule` stores metadata only. Any attempt to implement binary upload should leave a `// TODO: Phase 2 — implement binary upload via S3/MinIO` comment and return an error.

### R11 — schoolId must never come from request body
All tenant-scoped services must extract `schoolId` from the JWT payload (`req.user.schoolId`). DTOs must not include a `schoolId` field for mutation endpoints. Enforced in all service layers.

### R12 — Audit log trigger blocks updates/deletes at DB level
The raw SQL creates triggers on `audit_logs`. Any backend attempt to update/delete an audit log will throw a PostgreSQL exception. No update/delete endpoints should be exposed.
