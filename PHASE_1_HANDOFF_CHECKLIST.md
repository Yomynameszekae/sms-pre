# Phase 1 Handoff Checklist
### Ghana School Management System (Brite SMS)

**Status:** Phase 1 complete — use this checklist to verify and deliver the handoff package  
**Date:** June 2026  
**Reference documents:** `PHASE_1_COMPLETION_REPORT.md`, `DEPLOYMENT_GUIDE_PHASE_1.md`, `STAKEHOLDER_TESTING_GUIDE_PHASE_1.md`, `PHASE_2_PLANNING_BRIEF.md`

---

## 1. Files That Must Be Included in the Handoff Package

Verify each file exists before handoff. Use `ls` or your file explorer to confirm.

### Source Code

- [ ] `src/` — entire NestJS application source
- [ ] `prisma/schema.prisma` — database schema
- [ ] `prisma/migrations/` — Prisma migration history
- [ ] `scripts/apply-raw-migration.js` — dotenv-aware psql wrapper for raw SQL constraints
- [ ] `starter-docs/phase_1_required_raw_sql_migrations.sql` — partial indexes, CHECK constraints, audit trigger
- [ ] `package.json` and `package-lock.json` — dependency manifest and lockfile
- [ ] `tsconfig.json` and `tsconfig.build.json` — TypeScript configuration
- [ ] `nest-cli.json` — NestJS build configuration
- [ ] `.env.example` or `starter-docs/env.example` — environment variable template (never the real `.env`)

### Testing

- [ ] `postman/brite-sms.postman_collection.json` — all 79 Phase 1 endpoints
- [ ] `postman/brite-sms.local.postman_environment.json` — local environment variables for Postman

### Documentation

- [ ] `PHASE_1_COMPLETION_REPORT.md` — full technical completion report
- [ ] `DEPLOYMENT_GUIDE_PHASE_1.md` — production/staging deployment instructions
- [ ] `STAKEHOLDER_TESTING_GUIDE_PHASE_1.md` — non-developer testing guide
- [ ] `PHASE_2_PLANNING_BRIEF.md` — next phase feature scope and planning notes
- [ ] `PHASE_1_HANDOFF_CHECKLIST.md` — this file

### Reference / Specification (starter-docs/)

- [ ] `starter-docs/API_ENDPOINTS_PHASE_1.md` — endpoint and permission reference
- [ ] `starter-docs/PERMISSIONS_MATRIX_PHASE_1.md` — role-permission mapping table
- [ ] `starter-docs/MODULE_BOUNDARIES_PHASE_1.md` — inter-module dependency rules
- [ ] `starter-docs/SEED_DATA_SPEC.md` — seed data specification
- [ ] `starter-docs/IMPLEMENTATION_CHECKLIST_PHASE_1.md` — original build checklist

### Files That Must NOT Be Included

- [ ] `.env` — never committed or shared in plain text; contains real secrets
- [ ] `dist/` — compiled output; regenerated with `npm run build`
- [ ] `node_modules/` — regenerated with `npm ci`

---

## 2. Files for Developers

Developers receiving the codebase need these to understand, run, and extend the system.

| File | Purpose |
|---|---|
| `src/` | Full application source |
| `prisma/schema.prisma` | Authoritative database schema |
| `prisma/migrations/` | Applied migration history |
| `scripts/apply-raw-migration.js` | Raw SQL migration runner |
| `starter-docs/phase_1_required_raw_sql_migrations.sql` | Constraints and triggers to apply manually |
| `starter-docs/env.example` | Template for `.env` setup |
| `starter-docs/MODULE_BOUNDARIES_PHASE_1.md` | Import rules to prevent circular dependencies |
| `starter-docs/API_ENDPOINTS_PHASE_1.md` | Route and permission reference |
| `PHASE_1_COMPLETION_REPORT.md` | Bugs fixed, constraints verified, test status |
| `DEPLOYMENT_GUIDE_PHASE_1.md` | Step-by-step deployment for dev, staging, and production |
| `PHASE_2_PLANNING_BRIEF.md` | Scope and build order for next phase |
| `package.json` | Scripts, dependencies, version |

---

## 3. Files for Stakeholders and Testers

Non-developer stakeholders need only these files to participate in testing.

| File | Purpose |
|---|---|
| `STAKEHOLDER_TESTING_GUIDE_PHASE_1.md` | Plain-English testing instructions and all 52 test scenarios |
| `postman/brite-sms.postman_collection.json` | Import into Postman to run all tests |
| `postman/brite-sms.local.postman_environment.json` | Import into Postman alongside the collection |
| `PHASE_2_PLANNING_BRIEF.md` | For stakeholders who want to understand what comes next |

> Stakeholders do not need access to source code, the Prisma schema, or any server configuration files.

---

## 4. Files for Deployment

Whoever deploys the system to staging or production needs these.

| File | Purpose |
|---|---|
| `DEPLOYMENT_GUIDE_PHASE_1.md` | Primary deployment reference — follow Section by Section |
| `starter-docs/env.example` | Template for environment variables |
| `starter-docs/phase_1_required_raw_sql_migrations.sql` | Must be applied after Prisma migration |
| `scripts/apply-raw-migration.js` | Runner for the raw SQL file above |
| `PHASE_1_COMPLETION_REPORT.md` — Section 14–17 | Deployment checklist, env vars, commands, smoke test |

---

## 5. Environment Variables Required

All variables below must be set before the server will start. The server will **refuse to start** if any required variable is missing or invalid.

### Required at startup

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Full PostgreSQL connection string | `postgresql://user:pass@localhost:5432/sms_db` |
| `JWT_ACCESS_SECRET` | Long random secret for signing access tokens (32+ chars) | `openssl rand -base64 48` |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `15m` |
| `REFRESH_TOKEN_EXPIRES_IN_DAYS` | Refresh token lifetime in days | `7` |
| `TOKEN_HASH_SECRET` | Separate secret for HMAC token hashing (must differ from JWT secret) | `openssl rand -base64 48` |
| `COOKIE_NAME` | Name of the HTTP-only refresh cookie | `sms_refresh` |
| `COOKIE_SECURE` | `true` in production (requires HTTPS), `false` for local dev | `true` |
| `COOKIE_SAME_SITE` | `strict` or `lax` in production; `none` only with HTTPS | `strict` |
| `PASSWORD_HASH_ALGORITHM` | `argon2` (recommended) or `bcrypt` | `argon2` |
| `S3_BUCKET` | Storage bucket name (metadata only in Phase 1) | `sms-files-prod` |
| `S3_REGION` | Storage region | `eu-west-1` |

### Optional

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Runtime environment | *(none)* |
| `PORT` | Port the server listens on | `3000` |
| `API_PREFIX` | URL prefix for all routes | `api/v1` |
| `CORS_ORIGIN` | Allowed CORS origin (frontend URL) | `http://localhost:3001` |
| `S3_ENDPOINT` | S3-compatible endpoint (for MinIO, R2, etc.) | *(AWS default)* |
| `S3_ACCESS_KEY_ID` | S3 credentials | *(from IAM / provider)* |
| `S3_SECRET_ACCESS_KEY` | S3 credentials | *(from IAM / provider)* |
| `ARGON2_MEMORY_COST` | Argon2id memory cost (KB) | *(library default)* |
| `ARGON2_TIME_COST` | Argon2id time cost (iterations) | *(library default)* |
| `ARGON2_PARALLELISM` | Argon2id parallelism factor | *(library default)* |
| `BCRYPT_SALT_ROUNDS` | bcrypt rounds (only if `PASSWORD_HASH_ALGORITHM=bcrypt`) | *(library default)* |

### Seed variables (required only when running `npm run prisma:seed`)

| Variable | Description |
|---|---|
| `SEED_SCHOOL_NAME` | School display name (defaults to `Demo Ghana Private School`) |
| `SEED_SCHOOL_SLUG` | URL-safe school identifier (defaults to `demo-ghana-private-school`) |
| `SEED_SUPER_ADMIN_EMAIL` | Super Admin login email |
| `SEED_SUPER_ADMIN_PHONE` | Super Admin phone number |
| `SEED_SUPER_ADMIN_PASSWORD` | Super Admin initial password (will be flagged `mustChangePassword: true`) |

> **Security:** `JWT_ACCESS_SECRET` and `TOKEN_HASH_SECRET` must be different values. Both must be generated randomly, kept out of version control, and rotated if compromised.

---

## 6. Commands to Run Before Handoff

Run these on the development machine to verify the codebase is in a clean, deliverable state.

```bash
# Verify TypeScript compiles cleanly
npx tsc --noEmit

# Verify Prisma schema is valid
npx prisma validate

# Run all unit tests
npm test

# Verify the build produces a dist/ output
npm run build
```

**Expected results:**

- [ ] `npx tsc --noEmit` — exits with no errors
- [ ] `npx prisma validate` — prints `Schema is valid`
- [ ] `npm test` — all 81 tests pass across 10 suites with no failures
- [ ] `npm run build` — completes with no TypeScript errors; `dist/` folder created

If any of the above fail, resolve before handoff.

---

## 7. Commands to Run After Cloning the Repo

A developer or DevOps engineer setting up the project from scratch should run these commands in order.

```bash
# 1. Install dependencies
npm ci

# 2. Copy environment template and fill in values
cp starter-docs/env.example .env
# Edit .env — set DATABASE_URL, JWT_ACCESS_SECRET, TOKEN_HASH_SECRET, and all required variables

# 3. Apply Prisma migration
npm run prisma:migrate

# 4. Apply raw SQL constraints and triggers
npm run db:raw-sql

# 5. Generate Prisma client
npm run prisma:generate

# 6. Seed reference data, roles, permissions, and Super Admin user
npm run prisma:seed

# 7. Build TypeScript (production) or skip for local dev
npm run build          # production
# or
npm run start:dev      # local development (auto-reload)
```

**One-shot setup for a fresh environment:**

```bash
npm ci && npm run db:setup && npm run build && npm run start
```

> `npm run db:setup` runs steps 3–6 above in sequence.

---

## 8. How to Verify the Backend Locally

After setup, run these checks to confirm the backend is healthy before handing off to testers or deploying.

### Step 1 — Server starts

```bash
npm run start:dev
```

Expect output similar to:
```
[Nest] LOG [NestApplication] Nest application successfully started
[Nest] LOG [NestApplication] Application is running on: http://localhost:3000
```

No `Error` or `FATAL` lines should appear.

### Step 2 — Unauthenticated rejection

```bash
curl -s http://localhost:3000/api/v1/school
```

Expect: `{"statusCode":401,"message":"Unauthorized"}`

### Step 3 — Login

```bash
curl -s -c /tmp/sms_cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
```

Expect: `"success":true` and an `accessToken` in the response.

> Note: The seed admin has `mustChangePassword: true`. You may need to change the password first using `/auth/change-password` before continuing.

### Step 4 — Authenticated access

```bash
# Replace TOKEN with the accessToken from Step 3
curl -s http://localhost:3000/api/v1/school \
  -H "Authorization: Bearer TOKEN"
```

Expect: `"success":true` and school details.

### Step 5 — Audit log confirms seed ran

```bash
curl -s http://localhost:3000/api/v1/audit-logs \
  -H "Authorization: Bearer TOKEN" | grep 'seed.completed'
```

Expect: At least one audit log entry with `"action":"seed.completed"`.

### Step 6 — Verify audit trigger is active (database check)

Connect to the PostgreSQL database and run:

```sql
UPDATE audit_logs SET action = 'tamper_test' WHERE 1=1;
```

Expect: `ERROR: Audit log records cannot be modified or deleted.`

### Step 7 — TypeScript and tests

```bash
npx tsc --noEmit && npm test
```

Expect: No TypeScript errors. 81 tests pass.

**All seven steps passing = backend is healthy and ready for handoff.**

---

## 9. How to Import and Use the Postman Collection

### Import

1. Open **Postman** (desktop app — required for cookie handling).
2. Click **Import** (top left).
3. Select `postman/brite-sms.postman_collection.json`.
4. Click **Import** again.
5. Repeat for `postman/brite-sms.local.postman_environment.json`.
6. Select the **Brite SMS Local** environment from the environment dropdown (top right of Postman).

### Logging in

1. Open the **Auth** folder in the collection.
2. Open **Create/Action /auth/login**.
3. In the request body, set `email` and `password` to the seeded credentials:
   - Email: `admin@example.com`
   - Password: `ChangeMe123!` (must be changed on first login — see Change Password request in Auth folder)
4. Click **Send**.
5. The login request includes a Postman test script that automatically saves the `accessToken` to the environment. All other requests use this token via `{{accessToken}}`.

### Cookie handling

The refresh token is stored in an HTTP-only cookie. Postman's desktop app handles this automatically via the cookie jar. Do not use Postman Web (browser) for Phase 1 testing — it cannot store HTTP-only cookies correctly.

### Path parameters and IDs

The collection uses Postman variables for all IDs (e.g. `{{studentId}}`, `{{classroomId}}`). After creating a record, copy its `id` from the response and set the corresponding variable in the Postman environment.

### Session expiry

Access tokens expire after 15 minutes (configurable via `JWT_ACCESS_EXPIRES_IN`). If a request returns `401 Unauthorized`:

1. Open **Auth → Create/Action /auth/refresh** and click Send, or
2. Log in again via **Auth → Create/Action /auth/login**.

---

## 10. How Stakeholders Should Submit Feedback

Direct stakeholders to `STAKEHOLDER_TESTING_GUIDE_PHASE_1.md` — Section 9 contains the full bug report and feedback templates.

### Summary for the handoff pack

**Bug reports** should include:
- Date and tester name
- Module and scenario number (e.g. "6.3 Academic Years — Scenario C")
- What they did, what they expected, what actually happened
- The full Postman response (copy-paste or screenshot)
- The HTTP error code if any (400, 403, 404, 500, etc.)
- Whether the issue is reproducible

**Feedback (non-bug)** should include:
- Date and tester name
- Module and type (Suggestion / Unclear behaviour / Missing field / Other)
- Description

**Priority levels:**

| Priority | Description |
|---|---|
| P1 — Blocker | Error, crash, or clearly wrong data. Testing cannot continue. |
| P2 — Major | Feature does not work correctly but testing can continue. |
| P3 — Minor | Slightly off; data is correct. Display or labelling concern. |
| P4 — Suggestion | Works correctly but could be improved for real-world use. |

**Submission channel:** Agree on a channel before testing begins — email, shared document, project management tool, or a dedicated Slack/WhatsApp thread.

---

## 11. Known Limitations

These are intentional design decisions and constraints for Phase 1. Do not raise them as bugs.

| Limitation | Detail |
|---|---|
| No web interface | Phase 1 is an API. All testing requires Postman. |
| No binary file upload | Files module stores metadata (filename, size, type, storage key) only. Actual upload is Phase 2. |
| No email delivery | Password reset and account setup links are not sent by email. The reset token is returned in the API response for Phase 1 only. Email delivery is Phase 2. |
| No SMS notifications | All notifications are Phase 2. |
| No parent/guardian login | The `PARENT_GUARDIAN` role is seeded but there is no portal for guardians to log in through. This is Phase 2. |
| No attendance, grades, fees, or report cards | These modules are Phase 2. |
| Access tokens expire after 15 minutes | Re-login or use the refresh endpoint periodically during testing sessions. |
| No bulk import | Students, staff, and guardians must be created one record at a time through the API. |
| Single-school per environment | Phase 1 is built for one school per deployment. Multi-school or multi-branch support is a Phase 2 planning question. |
| `admission.approvedBy` not populated | The offer flow records `offeredAt` and the acting user via `updatedBy`. The `approvedBy` staff FK field is reserved for Phase 2 when the auth context will expose the actor's staff ID. |
| Password reset token returned in API response | In Phase 1, the reset token is returned directly in the API response for testing purposes. Before exposing the reset flow to real users, Phase 2 must route this token through email or SMS delivery. |

---

## 12. What Must Not Be Treated as a Bug — Phase 2 Scope

If a tester reports any of the following as missing or broken, clarify that these are **deliberately not in Phase 1**:

| Feature | Phase |
|---|---|
| Attendance tracking (daily, by student, by class) | Phase 2 |
| Assessment scores, test marks, grades | Phase 2 |
| Report card generation (PDF or otherwise) | Phase 2 |
| Fee schedules, invoices, payment records | Phase 2 |
| Mobile money payment integration | Phase 2 |
| SMS messages to parents/guardians | Phase 2 |
| In-app or email notifications | Phase 2 |
| Parent/guardian web portal | Phase 2 |
| Actual file upload (binary/documents) | Phase 2 |
| Student performance dashboards | Phase 2 |
| Dashboards or analytics of any kind | Phase 2 |
| Mobile application | Phase 2 |
| Frontend web application | Phase 2 |
| Bulk CSV import of students, staff, or guardians | Future planning |
| Multi-campus / multi-branch support | Under review for Phase 2 |
| Backup scheduling or restore | Phase 2 |
| Security incident management | Phase 2 |
| Data subject request (GDPR / Data Protection Act) handling | Phase 2 |

---

## 13. Criteria for Signing Off Phase 1

Phase 1 is signed off when all of the following are met:

### Technical sign-off (development team)

- [ ] 81 unit tests pass with `npm test`
- [ ] `npx tsc --noEmit` exits with no errors
- [ ] `npx prisma validate` passes
- [ ] All seven backend health checks in Section 8 pass against the target environment
- [ ] No P1 or P2 bugs remain open from stakeholder testing
- [ ] Postman collection imports cleanly and all 79 endpoints are accessible
- [ ] Seed admin user exists and `mustChangePassword` is set to `true`
- [ ] Audit log immutability trigger is verified active in the target environment

### Stakeholder sign-off

- [ ] At least one non-developer stakeholder has completed testing using `STAKEHOLDER_TESTING_GUIDE_PHASE_1.md`
- [ ] All P1 (Blocker) issues reported by testers have been resolved
- [ ] All P2 (Major) issues reported by testers have been resolved or formally accepted as known limitations
- [ ] Stakeholders confirm the admissions-to-enrollment pipeline works end-to-end
- [ ] Stakeholders confirm student, guardian, and staff records are created and retrievable correctly
- [ ] Stakeholders confirm audit logs capture all significant actions

### Documentation sign-off

- [ ] `PHASE_1_COMPLETION_REPORT.md` is accurate and up to date
- [ ] `DEPLOYMENT_GUIDE_PHASE_1.md` is verified against at least one successful deployment
- [ ] `STAKEHOLDER_TESTING_GUIDE_PHASE_1.md` has been distributed to testers
- [ ] `PHASE_2_PLANNING_BRIEF.md` has been reviewed by the project owner

### Security sign-off

- [ ] No secrets are committed to the repository (check `.gitignore` and `git log`)
- [ ] `COOKIE_SECURE=true` is set in the production/staging environment
- [ ] `NODE_ENV=production` is set in the production environment
- [ ] Seed admin password has been changed from `ChangeMe123!`
- [ ] CORS is configured to allow only the intended origin(s)
- [ ] HTTPS is enforced at the load balancer or reverse proxy

---

## 14. Recommended Next Steps After Stakeholder Testing

Once Phase 1 is signed off and the feedback period is closed:

### Immediate

1. **Triage all bug reports** — categorise as Phase 1 fixes (must fix) or Phase 2 backlog (defer).
2. **Fix any remaining P1/P2 Phase 1 bugs** before beginning Phase 2 planning.
3. **Archive the stakeholder feedback** in the project repository or documentation system.
4. **Change the seed admin password** in every environment it was deployed to.

### Before starting Phase 2 development

5. **Answer the 9 open questions** in `PHASE_2_PLANNING_BRIEF.md` — curriculum scope, payment provider, SMS provider, report card format, file storage provider, mobile app decision, multi-branch support, data retention policy, and data protection compliance level.
6. **Produce a Phase 2 technical specification** — equivalent in depth to the Phase 1 `starter-docs/` package. This should include: PRD, schema additions, API endpoint list, module boundaries, permissions matrix, seed data updates, and test plan.
7. **Agree on a Phase 2 build order** — the suggested order in `PHASE_2_PLANNING_BRIEF.md` (frontend first, then attendance, assessments, report cards, fees, payments, SMS, parent portal) is a starting point. Adjust based on school priorities.

### Parallel with Phase 2

8. **Deploy Phase 1 to production or staging** using `DEPLOYMENT_GUIDE_PHASE_1.md`.
9. **Begin onboarding real school data** — levels, classrooms, staff, academic year, and terms can be populated now through the Postman collection. Students and guardians can be entered as they are processed through admissions.
10. **Set up process management** — PM2, Docker, or systemd for the NestJS server (see `DEPLOYMENT_GUIDE_PHASE_1.md` Section 11).

---

*Phase 1 delivers a complete, tested, and secure foundation. Everything built in Phase 2 will sit on top of this layer without requiring changes to the core data model or authentication system.*
