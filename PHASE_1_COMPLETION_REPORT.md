# Phase 1 Completion Report — Ghana School Management System Backend

**Project:** Ghana School Management System — Phase 1 Backend  
**Package:** `ghana-sms-backend` v0.1.0  
**Completed:** 2026-06-03  
**Status: READY FOR STAKEHOLDER TESTING**

---

## 1. Executive Summary

Phase 1 of the Ghana School Management System backend is complete. All 18 business modules have been built, tested against a live PostgreSQL database, and verified through both automated tests (81 tests, 10 suites) and a full manual QA session. Two runtime bugs discovered during QA have been fixed. The API is stable, the authentication and session lifecycle work end-to-end, all database safety constraints are enforced, and the Postman collection is accurate and importable.

The system is ready for manual stakeholder testing. Phase 2 planning can begin.

---

## 2. Scope Completed

Phase 1 delivered a backend-only REST API for a Ghanaian private school. The following areas are in scope and complete:

- School registration, profile, and settings
- Role-based access control (RBAC) with per-permission granularity
- JWT authentication with HTTP-only refresh cookie rotation
- Academic structure: academic years, terms, levels, classrooms
- People: staff, students, guardians, student-guardian relationships
- Admissions workflow: enquiry → application → offered → enrolled
- Enrollments with withdrawal support
- Document sequence generation (student numbers, admission numbers)
- File metadata (no binary upload — metadata only as specified)
- Immutable audit logging
- Tenant isolation enforced at the service layer throughout

The following are explicitly out of scope for Phase 1 and have not been built:

- Attendance, assessments, grading, report cards
- Fees, invoices, payments, payment gateways
- SMS, notifications, parent portal
- Backups, security incidents, data subject requests
- Any frontend or mobile application

---

## 3. Modules Completed

| # | Module | Routes | Permission Keys |
|---|--------|--------|----------------|
| 1 | Auth | POST /login, /refresh, /logout, /change-password, /password-reset/request, /password-reset/confirm, /account-setup/confirm, GET /me | auth.* |
| 2 | Users | POST, GET (list), GET /:id, PATCH /:id, PATCH /:id/deactivate, POST /:id/roles, DELETE /:id/roles/:roleId | users.* |
| 3 | Roles | POST, GET, GET /:id, PATCH /:id, POST /:id/permissions, DELETE /:id/permissions/:permissionId | roles.* |
| 4 | Permissions | GET, GET /:id | permissions.read |
| 5 | School | GET, PATCH | school.read, school.update |
| 6 | School Settings | GET, GET /:key, PATCH /:key | school_settings.* |
| 7 | Document Sequences | GET, GET /:type, POST /:type/generate, PATCH /:type | document_sequences.* |
| 8 | Academic Years | POST, GET, GET /:id, PATCH /:id, POST /:id/activate, POST /:id/close | academic_years.* |
| 9 | Terms | POST, GET, GET /:id, PATCH /:id, POST /:id/activate, POST /:id/close | terms.* |
| 10 | Levels | POST, GET, GET /:id, PATCH /:id, POST /:id/archive | levels.* |
| 11 | Classrooms | POST, GET, GET /:id, PATCH /:id, POST /:id/assign-class-teacher, POST /:id/archive | classrooms.* |
| 12 | Staff | POST, GET, GET /:id, PATCH /:id, POST /:id/archive | staff.* |
| 13 | Students | POST, GET, GET /:id, PATCH /:id, POST /:id/archive, GET /:id/guardians, GET /:id/enrollments | students.* |
| 14 | Guardians | POST, GET, GET /:id, PATCH /:id, POST /:id/archive, GET /:id/students | guardians.* |
| 15 | Student-Guardians | POST, PATCH /:id, DELETE /:id, POST /:id/set-primary | student_guardians.manage |
| 16 | Admissions | POST, GET, GET /:id, PATCH /:id, POST /:id/offer, POST /:id/enroll | admissions.* |
| 17 | Enrollments | POST, GET, GET /:id, PATCH /:id, POST /:id/withdraw | enrollments.* |
| 18 | Files (metadata) | POST, GET, GET /:id, GET /owner/:ownerType/:ownerId, POST /:id/archive | files.* |
| 19 | Audit Logs | GET, GET /:id (read-only) | audit_logs.read |

**Total routes:** 79 endpoints across 19 API groups.

---

## 4. Database and Migration Status

### Prisma Migration

- **Migration:** `20260603205711_first_migration` — applied and locked.
- **Prisma validate:** passes with no errors.
- **Prisma generate:** Prisma client generated from current schema.

### Raw SQL Migration

Applied via `npm run db:raw-sql` (Node.js script — dotenv-aware, OS-portable):

| Object | Purpose |
|--------|---------|
| `pgcrypto` extension | UUID generation |
| `uq_users_school_email_lower` | Case-insensitive unique email per school |
| `uq_users_school_phone` | Unique phone per school |
| `uq_users_school_linked_entity` | One user per linked staff/guardian |
| `uq_staff_school_email_lower` | Case-insensitive unique staff email per school |
| `uq_system_role_code` | Global role code uniqueness |
| `uq_school_role_code` | School-scoped role code uniqueness |
| `uq_admission_school_number` | Unique admission number per school |
| `uq_one_active_academic_year_per_school` | At most one active academic year per school |
| `uq_one_active_term_per_school` | At most one active term per school |
| `uq_one_primary_guardian_per_student` | At most one primary guardian per student |
| `uq_one_active_enrollment_per_student_year` | One active enrollment per student per academic year |
| `ALTER TABLE` CHECK constraints | Date range validation, enum guards, positive capacity |
| `prevent_audit_log_changes()` trigger function | Blocks UPDATE and DELETE on audit_logs |
| `trg_prevent_audit_log_update` | Fires trigger on UPDATE |
| `trg_prevent_audit_log_delete` | Fires trigger on DELETE |

All constraints have been verified live against the database. Each returns the expected 409 Conflict or trigger error.

### One-shot setup command

```bash
npm run db:setup
```

Runs: `prisma migrate dev` → `db:raw-sql` → `prisma generate` → `prisma:seed`.

---

## 5. Auth/Session Status

| Feature | Status |
|---------|--------|
| Login with email or phone | Working |
| Argon2id password hashing | Implemented |
| JWT access token (RS/HS256) | Issued on login; all 66+ permissions embedded |
| HTTP-only refresh cookie | Set on login; rotated on refresh |
| Refresh token rotation | Old session revoked; new token issued |
| Logout | Session row deleted; cookie cleared |
| Revoked refresh token reuse | Returns 401 "Refresh token is invalid or expired" |
| Password change (revokes sessions) | Implemented |
| Password reset request/confirm | Implemented (token stored hashed) |
| Account setup confirm | Implemented |
| Rate limiting on auth routes | Applied via `@nestjs/throttler` |

All five stages of the auth lifecycle were proven against the live database.

---

## 6. RBAC/Security Status

| Feature | Status |
|---------|--------|
| Permission keys (not role names) | All guards use `@RequirePermissions('resource.action')` |
| Permissions embedded in JWT | All user permissions serialized at login |
| `PermissionsGuard` | Applied globally; enforces `@RequirePermissions` |
| `JwtAuthGuard` | Protects all routes; public routes use `@Public()` |
| Unauthenticated rejection | 401 on all protected routes |
| Missing permission rejection | 403 (verified via unit tests) |
| `schoolId` from JWT only | Never trusted from request body |
| Whitelist validation | `class-validator` `whitelist: true` — unknown fields rejected with 400 |
| Helmet | HTTP security headers applied |
| Compression | Response compression enabled |
| Cookie security | `httpOnly: true`, `sameSite` and `secure` configurable via env |
| Token hashing | Refresh, reset, and setup tokens stored as HMAC-SHA256 hashes |

**Seeded roles:** SUPER_ADMIN, SCHOOL_ADMIN, HEADTEACHER, ACADEMIC_COORDINATOR, CLASS_TEACHER, ADMISSIONS_OFFICER, PARENT_GUARDIAN, COMPLIANCE_OFFICER (8 roles).

**Seeded permissions:** 66 permission keys across 19 modules, each mapped to the SUPER_ADMIN role.

---

## 7. Tenant Isolation Status

| Mechanism | Status |
|-----------|--------|
| `schoolId` extracted from JWT payload only | All service methods receive `schoolId` from the JWT guard |
| Request body `schoolId` injection blocked | `whitelist: true` validation rejects unknown fields — confirmed live |
| All list queries filtered by `schoolId` | Verified in service code and unit tests |
| Cross-school resource access returns 404 | `findFirst({ where: { id, schoolId } })` returns null → NotFoundException |
| Cross-school relationship validation | Admissions.enroll and Enrollments.create validate student, classroom, and academic year all belong to same school |
| One-primary-guardian enforced per school | Partial unique index via raw SQL |
| Module boundaries | No circular dependencies; no `forwardRef()` |

---

## 8. Seed Data Status

| Entity | Seeded |
|--------|--------|
| School | 1 school (`brite-sms-demo`, configurable via `SCHOOL_SLUG` env) |
| School settings | Default academic and notification settings |
| Document sequences | `student_number`, `admission_number` |
| Permissions | 66 permission keys |
| Roles | 8 roles (system-scoped SUPER_ADMIN + 7 school-scoped) |
| Role-permission mappings | All 66 permissions assigned to SUPER_ADMIN |
| Staff (Super Admin) | 1 staff record linked to admin user |
| User (Super Admin) | `admin@example.com` / `ChangeMe123!` (must change on first login) |
| User role assignment | SUPER_ADMIN role assigned to admin user |
| Seed audit log | Written once; guarded against duplicate on re-run |

**Seed idempotency:** Fixed. Running `npm run prisma:seed` multiple times does not create duplicate records or duplicate audit log entries.

**Credentials:** `admin@example.com` / `ChangeMe123!` — flag `mustChangePassword: true` is set on the seed user.

---

## 9. Audit Logging Status

| Feature | Status |
|---------|--------|
| Internal `AuditLogsService` | All business modules inject and call it |
| Immutability trigger | PostgreSQL trigger blocks UPDATE and DELETE at the database level |
| Read-only API | Only GET /audit-logs and GET /audit-logs/:id exist; no write endpoints |
| Fields logged | `action`, `module`, `entityType`, `entityId`, `actorType`, `userId`, `requestId`, `changes.before`, `changes.after` |
| Sensitive actions covered | login, logout, password change, password reset, all CRUD operations, activate/close/archive/withdraw state changes |
| `storageKey` excluded from file audit logs | Intentional — prevents raw storage paths from appearing in audit trail |

---

## 10. Postman / Manual QA Status

### Collection

- **File:** `postman/brite-sms.postman_collection.json`
- **Environment:** `postman/brite-sms.local.postman_environment.json`
- **Base URL:** `http://localhost:3000/api/v1` (via `{{baseUrl}}`)
- **Auth:** Collection-level Bearer `{{accessToken}}`; login test script auto-saves token to environment
- **Cookie handling:** Refresh and logout use Postman cookie jar; requires "Postman Interceptor" or desktop app cookie support

### Coverage

All 79 Phase 1 endpoints are represented in the collection. Variables cover all path parameters, query parameters, and body fields needed to exercise each route.

### QA Session Results (2026-06-03)

All 18 module groups passed manual smoke testing:

| Module Group | Result |
|-------------|--------|
| Auth (login, /me, refresh, logout, revoked token) | PASS |
| Users, Roles, Permissions | PASS |
| School, School Settings | PASS |
| Document Sequences (generate, update) | PASS |
| Academic Years (full lifecycle) | PASS |
| Terms (full lifecycle) | PASS |
| Levels | PASS |
| Classrooms (incl. assign-class-teacher) | PASS |
| Staff | PASS |
| Students (incl. /guardians, /enrollments sub-routes) | PASS |
| Guardians (incl. /students sub-route) | PASS |
| Student-Guardian Relationships | PASS |
| Admissions (enquiry → offer → enroll) | PASS (after bug fix) |
| Enrollments (create → update → withdraw) | PASS |
| Files Metadata | PASS (after bug fix) |
| Audit Logs (read-only) | PASS |

---

## 11. Test Status

| Suite | Tests | Status |
|-------|-------|--------|
| `auth.service.spec.ts` | – | PASS |
| `permissions.guard.spec.ts` | – | PASS |
| `document-sequences.service.spec.ts` | – | PASS |
| `students.service.spec.ts` | – | PASS |
| `student-guardians.service.spec.ts` | – | PASS |
| `audit-logs.service.spec.ts` | – | PASS |
| `academic-years.service.spec.ts` | 9 | PASS |
| `admissions.service.spec.ts` | 13 | PASS |
| `enrollments.service.spec.ts` | 9 | PASS |
| `files.service.spec.ts` | 10 | PASS |
| **Total** | **81** | **PASS** |

**TypeScript:** `npx tsc --noEmit` exits with no errors.  
**Prisma:** `npx prisma validate` passes.

Key test coverage areas:

- Tenant isolation: `findOne` and `findAll` always filter by `schoolId`
- `schoolId` injected from service parameter, never from DTO
- P2002 unique constraint violations translated to `ConflictException` (409)
- State machine validation (admissions offer only from enquiry/application status)
- Cross-school relationship validation (student, classroom, academic year)
- `sizeBytes` cast to BigInt for storage; serialized back to Number for API responses
- `storageKey` excluded from file audit metadata
- Audit log writes on all sensitive actions
- One-active-academic-year and one-primary-guardian constraints

---

## 12. Bugs Found and Fixed

### Bug 1: Admissions offer endpoint — 500 Internal Server Error

**Symptom:** `POST /admissions/:id/offer` returned 500 for all admissions in enquiry or application status.

**Root cause:** `admissions.service.ts` `offer()` method set `approvedBy: userId` in the Prisma update payload. `approvedBy` is a foreign key to the `staff` table, but `userId` is a UUID from the `users` table. The FK violation caused Prisma to throw an unhandled error.

**Fix:** Removed `approvedBy` and `approvedAt` from the offer update. The offer is recorded via `offeredAt: new Date()` and `updatedBy: userId`. The `approvedBy` field can be populated in Phase 2 once staff-to-user linking is surfaced in the auth context.

**File:** `src/admissions/admissions.service.ts`

---

### Bug 2: Files endpoints — 500 Internal Server Error on all routes

**Symptom:** `POST /files`, `GET /files`, `GET /files/:id`, `GET /files/owner/:ownerType/:ownerId` all returned 500.

**Root cause:** The `file.sizeBytes` column is `BigInt` in the Prisma schema. Node.js `JSON.stringify` cannot serialize `BigInt` natively and throws `TypeError: Do not know how to serialize a BigInt`.

**Fix:** Added a private `serialize()` helper in `FilesService` that converts `sizeBytes` from `BigInt` to `Number` before returning. Applied to all four return paths (`create`, `findAll`, `findOne`, `findByOwner`, `archive`).

```typescript
private serialize<T extends { sizeBytes: bigint }>(file: T): Omit<T, 'sizeBytes'> & { sizeBytes: number } {
  return { ...file, sizeBytes: Number(file.sizeBytes) };
}
```

**Precision note:** `Number(BigInt)` is safe for file sizes up to 2^53 bytes (~8 petabytes). This is acceptable for Phase 1.

**File:** `src/files/files.service.ts`

---

### Bug 3: Postman enrollment create body — 400 Validation Failed

**Symptom:** `POST /enrollments` in the Postman collection would return 400 with error `property enrollmentDate should not exist`.

**Root cause:** The Postman collection body included `"enrollmentDate": "2026-09-01"` which is not a field in `CreateEnrollmentDto`. The global `whitelist: true` validation rejects unknown properties.

**Fix:** Removed `enrollmentDate` from the collection body for `Create/Action /enrollments`.

**File:** `postman/brite-sms.postman_collection.json`

---

## 13. Remaining Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| No live 403 test with a restricted-permission user | Low | Unit tests cover the permissions guard for all scenarios. A second seeded user with limited permissions would close this gap in Phase 2. |
| `admission.approvedBy` (Staff FK) is never populated | Low | The offer flow records `offeredAt` and `updatedBy`. The `approvedBy` field can be populated in Phase 2 when the auth context is extended to include the actor's staff ID. |
| `sizeBytes` precision above 8 PB | Negligible | School file uploads will not approach this limit in Phase 1. |
| Access token expiry during Postman sessions | Low | Tokens expire per `JWT_ACCESS_EXPIRES_IN` config. Stakeholders using Postman should run the login request to refresh `{{accessToken}}`, or use the `/auth/refresh` endpoint. |
| No binary file upload | Design decision | Files module stores metadata only, as specified for Phase 1. Binary upload via S3 is a Phase 2 item. |
| Password reset flow requires out-of-band token delivery | Design decision | The reset token is returned in the API response for Phase 1 (no email/SMS yet). In production, this must be delivered via the Phase 2 notifications system before going live with external users. |

---

## 14. Deployment Readiness Checklist

### Infrastructure

- [ ] PostgreSQL 14+ instance provisioned
- [ ] Database created for the environment (dev/staging/production)
- [ ] Node.js 20 LTS runtime available
- [ ] Outbound HTTPS access for any future external integrations

### Code

- [ ] All secrets are in environment variables — no hardcoded credentials in source
- [ ] `.env` is in `.gitignore` — confirmed not committed
- [ ] `npm ci` installs production + dev dependencies cleanly
- [ ] `npm run build` compiles TypeScript to `dist/` without errors
- [ ] `npx tsc --noEmit` passes with no errors

### Database

- [ ] `npm run prisma:migrate` — applies the Prisma migration
- [ ] `npm run db:raw-sql` — applies partial unique indexes, CHECK constraints, and audit trigger
- [ ] `npm run prisma:generate` — regenerates the Prisma client against the migrated schema
- [ ] `npm run prisma:seed` — seeds permissions, roles, school, and Super Admin user
- [ ] Verify seed audit log appears in `audit_logs` table: `SELECT * FROM audit_logs WHERE action = 'seed.completed';`

### Environment

- [ ] All required environment variables are set (see Section 15)
- [ ] `COOKIE_SECURE=true` in production
- [ ] `COOKIE_SAME_SITE=strict` or `lax` in production (not `none` without HTTPS)
- [ ] `NODE_ENV=production` in production
- [ ] `JWT_ACCESS_SECRET` is a long random string (32+ characters), not the default

### Security

- [ ] HTTPS is terminated at the load balancer or reverse proxy (required for `COOKIE_SECURE=true`)
- [ ] CORS configured to allow only the frontend origin(s)
- [ ] Rate limiting is active (`@nestjs/throttler` — configured at module level)
- [ ] Helmet security headers are active (wired in `main.ts`)
- [ ] Admin password changed on first login (`mustChangePassword: true` is set on seed user)

### Smoke test

- [ ] `npm run start` (production) or `npm run start:dev` starts without errors
- [ ] `POST /api/v1/auth/login` returns access token
- [ ] `GET /api/v1/school` returns school data
- [ ] `GET /api/v1/audit-logs` returns seed audit log entries

---

## 15. Recommended Environment Variables for Deployment

Refer to `starter-docs/env.example` for the full template. Required variables:

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database_name

# JWT
JWT_ACCESS_SECRET=<long-random-secret-32+-chars>
JWT_ACCESS_EXPIRES_IN=15m

# Refresh token
REFRESH_TOKEN_EXPIRES_IN_DAYS=7

# Token hashing
TOKEN_HASH_SECRET=<long-random-secret-32+-chars>

# Cookie
COOKIE_NAME=sms_refresh
COOKIE_SECURE=true           # true in production, false in local dev
COOKIE_SAME_SITE=strict      # strict or lax in production

# Password
PASSWORD_HASH_ALGORITHM=argon2

# Storage (metadata stored; binary upload is Phase 2)
S3_BUCKET=<your-bucket-name>
S3_REGION=<your-region>

# Application
NODE_ENV=production
PORT=3000

# Seed (optional — defaults to 'brite-sms-demo')
SCHOOL_SLUG=your-school-slug
```

**Important:** `JWT_ACCESS_SECRET` and `TOKEN_HASH_SECRET` must be different values. Both must be long random strings and never committed to source control.

---

## 16. Pre-Deployment Commands

Run in order on the target environment. Assumes Node.js and PostgreSQL are available and `DATABASE_URL` is set.

```bash
# 1. Install dependencies
npm ci

# 2. Apply Prisma migration
npm run prisma:migrate

# 3. Apply raw SQL constraints and triggers
npm run db:raw-sql

# 4. Generate Prisma client
npm run prisma:generate

# 5. Seed reference data
npm run prisma:seed

# 6. Build TypeScript
npm run build

# 7. Start server
npm run start
```

Or in one command for a fresh environment:

```bash
npm ci && npm run db:setup && npm run build && npm run start
```

---

## 17. Post-Deployment Smoke Test Checklist

Run these after deploying to a new environment. Replace `BASE_URL` with the actual domain.

```bash
BASE_URL="https://your-domain.com/api/v1"

# 1. Server health — should return 401 (not 5xx)
curl -s "$BASE_URL/school" | grep '"statusCode":401'

# 2. Login
curl -s -c /tmp/sms_cookies.txt -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}' | grep '"success":true'

# 3. Get school (authenticated)
# (use access token from step 2)
curl -s "$BASE_URL/school" -H "Authorization: Bearer <ACCESS_TOKEN>" | grep '"success":true'

# 4. List audit logs — confirm seed log present
curl -s "$BASE_URL/audit-logs" -H "Authorization: Bearer <ACCESS_TOKEN>" | grep 'seed.completed'

# 5. Generate a document sequence
curl -s -X POST "$BASE_URL/document-sequences/student_number/generate" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" | grep '"success":true'

# 6. Verify audit log immutability (trigger active)
# Try to update an audit log directly in psql — should fail with trigger error
```

---

## 18. Phase 2 Readiness Notes

Phase 1 provides a stable foundation. The following architectural decisions made in Phase 1 are explicitly forward-compatible with Phase 2:

| Decision | Phase 2 Impact |
|----------|---------------|
| `schoolId` always from JWT | Tenant isolation is already enforced; no refactoring needed |
| Permission keys not role names | Phase 2 permissions can be added to the seed and existing roles without changing guard logic |
| `auditLogs.create()` injectable service | All Phase 2 modules can log by injecting `AuditLogsService` |
| `DocumentSequencesModule` standalone | Phase 2 modules (e.g., fees, invoices) can call `generate` without coupling |
| `admission.approvedBy` (Staff FK) ready | Phase 2 can populate this when staff ID is available in the auth context |
| File metadata schema with `ownerType` / `ownerId` | Binary upload can be added to the existing `FilesModule` in Phase 2 |
| `mustChangePassword` flag on seed user | Phase 2 should enforce a redirect to change-password on first login |
| Password reset returns token in response | Phase 2 must wire the reset token into the email/SMS delivery system before exposing the reset flow to end users |

**Suggested Phase 2 starting points:**
1. Attendance module (the most immediately useful addition for teachers)
2. Email/SMS notification delivery for password reset and account setup tokens
3. Parent portal read-only access (PARENT_GUARDIAN role is already seeded)
4. Fees and invoice generation

---

## 19. Phase 1 Is Ready for Stakeholder Testing

**Phase 1 is complete and ready for manual stakeholder testing.**

The backend API is stable, authenticated, secure, and covering all Phase 1 functional requirements. All runtime bugs discovered during QA have been fixed. The test suite is green. The Postman collection and environment file are accurate and importable.

Stakeholders can begin manual testing immediately using:

- **Postman collection:** `postman/brite-sms.postman_collection.json`
- **Environment:** `postman/brite-sms.local.postman_environment.json`
- **Admin login:** `admin@example.com` / `ChangeMe123!`
- **Base URL:** `http://localhost:3000/api/v1` (local) or the deployed URL
- **First step:** Run **Auth → Create/Action /auth/login** — the test script auto-populates `{{accessToken}}`

It is safe to begin planning Phase 2.
