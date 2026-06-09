# Phase 1 Build Plan — Ghana School Management System

## Stack
- NestJS + TypeScript
- Prisma ORM + PostgreSQL
- JWT (access) + HTTP-only cookie (refresh)
- argon2 password/token hashing
- class-validator / class-transformer

## Source of Truth
- `starter-docs/phase_1_school_management_schema.prisma` — database schema
- `starter-docs/phase_1_required_raw_sql_migrations.sql` — raw SQL (applied after Prisma migration)
- `starter-docs/SEED_DATA_SPEC.md` — seed data
- `starter-docs/API_ENDPOINTS_PHASE_1.md` — REST routes
- `starter-docs/PERMISSIONS_MATRIX_PHASE_1.md` — RBAC matrix
- `starter-docs/MODULE_BOUNDARIES_PHASE_1.md` — import rules

## Schema Fix Applied
The Prisma schema from `starter-docs/` has one validation issue (R1 in RISKS.md).  
Fixed in `prisma/schema.prisma`: named the `User ↔ UserRole` relation `"UserRoles"`.

## Build Order

### Phase A — Infrastructure
1. NestJS project scaffold (package.json, tsconfig, nest-cli.json)
2. PrismaModule + PrismaService
3. ConfigModule with env validation
4. Common layer: decorators, guards, interceptors, filters, utils

### Phase B — Auth & RBAC
5. Auth module (login, refresh, logout, password change/reset, account setup, JWT strategy)
6. RBAC guard + `@RequirePermissions()` decorator

### Phase C — Identity & School
7. Users module
8. Roles + Permissions module
9. School module
10. School Settings module
11. Document Sequences module (transaction-safe)

### Phase D — Academic Setup
12. Academic Years module
13. Terms module
14. Levels module
15. Classrooms module

### Phase E — People
16. Staff module
17. Students module
18. Guardians module
19. Student-Guardian Relationships module

### Phase F — Admissions & Enrollments
20. Admissions module (orchestration)
21. Enrollments module

### Phase G — Supporting
22. Files Metadata module
23. Audit Logs module (read-only endpoints)

### Phase H — Data & Tests
24. Seed script (idempotent)
25. Tests (auth, RBAC, tenant isolation, sequences, audit)

## Key Rules Enforced Throughout
- `schoolId` always from JWT, never from request body
- Every tenant query filters by `schoolId`
- Same-school validation before linking child records
- `@RequirePermissions()` on all non-public endpoints
- Audit logs written in service layer for all sensitive actions
- No Phase 2 modules (attendance, grades, fees, SMS, notifications)
- No binary file upload
- No frontend code

## Commands
```bash
npm run prisma:format     # npx prisma format
npm run prisma:validate   # npx prisma validate
npm run prisma:migrate    # npx prisma migrate dev
npm run prisma:generate   # npx prisma generate
npm run prisma:seed       # ts-node prisma/seed.ts
npm run start:dev         # nest start --watch
npm run test              # jest
```
