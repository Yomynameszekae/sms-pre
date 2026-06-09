# Phase 1 Build Progress

## Status Legend
- ✅ Done
- 🔄 In progress
- ⏳ Pending
- ❌ Blocked

---

## Database Setup

| Task | Status | Notes |
|------|--------|-------|
| prisma/schema.prisma (fixed) | ✅ | Fixed: named `UserRoles` relation on User↔UserRole |
| npm install | ✅ | 783 packages |
| npx prisma format | ✅ | Passes |
| npx prisma validate | ✅ | Schema is valid |
| npx prisma migrate dev | ⏳ | Requires running PostgreSQL — run when DB is available |
| Apply raw SQL migration | ⏳ | Requires running PostgreSQL |
| npx prisma generate | ⏳ | Run after migration |
| npx prisma db seed | ⏳ | Run after generate |

---

## Phase A — Infrastructure

| Task | Status | Notes |
|------|--------|-------|
| build-docs created | ✅ | RISKS.md, BUILD_PLAN.md, PROGRESS.md |
| package.json + tsconfig | ✅ | All scripts configured |
| NestJS main.ts + app.module | ✅ | All 18 modules imported |
| PrismaModule + PrismaService | ✅ | Global module |
| ConfigModule + env configs | ✅ | app, auth, database, storage configs |
| Common decorators | ✅ | CurrentUser, RequirePermissions, Public |
| Common guards | ✅ | JwtAuthGuard, PermissionsGuard, ThrottlerGuard |
| Common interceptors | ✅ | RequestIdInterceptor |
| Common filters | ✅ | HttpExceptionFilter |
| Common utils | ✅ | hash.util, token.util, pagination.util, response.util |
| Common DTOs | ✅ | PaginationDto |

## Phase B — Auth & RBAC

| Task | Status | Notes |
|------|--------|-------|
| JWT strategy + passport setup | ✅ | Validates session not revoked |
| Auth login (email or phone) | ✅ | With audit log |
| Auth refresh token rotation | ✅ | Revokes old session |
| Auth logout | ✅ | Revokes session, clears cookie |
| Auth password change | ✅ | Revokes other sessions |
| Auth password reset flow | ✅ | token → hash → auth_tokens table |
| Auth account setup flow | ✅ | |
| Auth /me endpoint | ✅ | Returns permissions list |
| RBAC guard + @RequirePermissions | ✅ | Permission key checks, not role names |

## Phase C — Identity & School

| Task | Status | Notes |
|------|--------|-------|
| Users CRUD + role assignment | ✅ | |
| Roles + Permissions CRUD | ✅ | System + school-scoped roles |
| School read/update | ✅ | |
| School Settings CRUD | ✅ | Upsert by key |
| Document Sequences (transaction-safe) | ✅ | Atomic increment in $transaction |

## Phase D — Academic Setup

| Task | Status | Notes |
|------|--------|-------|
| Academic Years CRUD + activate/close | ✅ | P2002 → ConflictException |
| Terms CRUD + activate/close | ✅ | Validates academicYear belongs to school |
| Levels CRUD + archive | ✅ | Ordered by orderIndex |
| Classrooms CRUD + assign teacher + archive | ✅ | Validates staff school membership |

## Phase E — People

| Task | Status | Notes |
|------|--------|-------|
| Staff CRUD + archive | ✅ | |
| Students CRUD + archive | ✅ | Ghana Card optional |
| Guardians CRUD + archive | ✅ | |
| Student-Guardian link/update/unlink | ✅ | Cross-school validation, P2002 → ConflictException |

## Phase F — Admissions & Enrollments

| Task | Status | Notes |
|------|--------|-------|
| Admissions create/update/offer/enroll | ✅ | Full cross-school validation on enroll |
| Enrollments create/update/withdraw | ✅ | Three-entity school validation |

## Phase G — Supporting

| Task | Status | Notes |
|------|--------|-------|
| Files Metadata CRUD + archive | ✅ | isPublic=false always, storageKey not in audit logs |
| Audit Logs read-only endpoints | ✅ | No update/delete endpoints |

## Phase H — Data & Tests

| Task | Status | Notes |
|------|--------|-------|
| Seed script (idempotent) | ✅ | All permissions, roles, role-permissions, school, settings, sequences, super admin |
| Auth tests (39 tests total) | ✅ | login, refresh, logout, change-password |
| RBAC tests | ✅ | PermissionsGuard: permission keys not role names |
| Tenant isolation tests | ✅ | Students, StudentGuardians, AuditLogs |
| Document sequence tests | ✅ | Transaction-safe, formatting, missing NotFoundException |
| Audit log immutability tests | ✅ | No update/delete methods on service |

---

## Next Steps (when PostgreSQL is available)

```bash
# 1. Copy .env.example to .env and fill in DATABASE_URL + secrets
cp .env.example .env

# 2. Create the database
createdb ghana_sms_phase1

# 3. Run Prisma migration (creates all tables)
npm run prisma:migrate

# 4. Apply the raw SQL migration (partial indexes, triggers, constraints)
psql -d ghana_sms_phase1 -f starter-docs/phase_1_required_raw_sql_migrations.sql

# 5. Generate Prisma client
npm run prisma:generate

# 6. Seed the database
npm run prisma:seed

# 7. Start the dev server
npm run start:dev

# 8. Run tests
npm test
```

## Phase 2 TODOs Left in Code

- TODO: Phase 2 — send reset token via email/SMS (auth.service.ts)
- TODO: Phase 2 — implement binary upload via S3/MinIO (files.controller.ts)

---

## TypeScript Compilation
- `npx tsc --noEmit` — ✅ zero errors

## Test Results
- 6 test suites, 39 tests — ✅ all passing
