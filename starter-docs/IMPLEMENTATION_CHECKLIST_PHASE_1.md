# Phase 1 Implementation Checklist

## 1. Project Setup

- [ ] Create NestJS project.
- [ ] Install Prisma.
- [ ] Install PostgreSQL client dependencies.
- [ ] Install config package.
- [ ] Install auth dependencies.
- [ ] Install validation dependencies.
- [ ] Add `.env.example`.
- [ ] Add environment validation.

Suggested dependencies:

```bash
npm install @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt cookie-parser
npm install prisma @prisma/client
npm install argon2
npm install class-validator class-transformer
npm install helmet compression
npm install -D @types/cookie-parser
```

---

## 2. Prisma and Database

- [ ] Place schema at `prisma/schema.prisma`.
- [ ] Run `npx prisma format`.
- [ ] Run `npx prisma validate`.
- [ ] Create Prisma migration.
- [ ] Apply Prisma migration.
- [ ] Apply raw SQL migration.
- [ ] Generate Prisma client.
- [ ] Add PrismaService.
- [ ] Add PrismaModule.
- [ ] Add transaction helper if needed.

---

## 3. Seed Script

- [ ] Seed school.
- [ ] Seed school settings.
- [ ] Seed document sequences.
- [ ] Seed permissions.
- [ ] Seed system roles.
- [ ] Seed role-permission mappings.
- [ ] Seed Super Admin staff record.
- [ ] Seed Super Admin user.
- [ ] Assign SUPER_ADMIN role.
- [ ] Write seed audit log.

---

## 4. Auth Module

- [ ] Implement login with email or phone.
- [ ] Implement password verification.
- [ ] Issue JWT access token.
- [ ] Create hashed refresh token.
- [ ] Store refresh token hash in `user_sessions`.
- [ ] Set refresh token HTTP-only cookie.
- [ ] Implement refresh token rotation.
- [ ] Revoke previous session on rotation.
- [ ] Implement logout.
- [ ] Implement password change.
- [ ] Implement password reset request.
- [ ] Implement password reset confirm.
- [ ] Implement account setup confirm.
- [ ] Add rate limiting to auth endpoints.
- [ ] Add audit logs for sensitive auth events.

---

## 5. RBAC

- [ ] Create `@RequirePermissions()` decorator.
- [ ] Create permissions guard.
- [ ] Load user permissions from role assignments.
- [ ] Ensure permission checks use permission keys.
- [ ] Avoid hardcoded role checks.
- [ ] Add tests for permission guard.

---

## 6. Tenant Isolation

- [ ] Resolve `schoolId` from authenticated user/session.
- [ ] Never trust `schoolId` from request body.
- [ ] Filter tenant-owned queries by `schoolId`.
- [ ] Validate same-school relationships when creating child records.
- [ ] Add tests for cross-school access denial.

---

## 7. Core Modules

### School

- [ ] Get school.
- [ ] Update school.

### School Settings

- [ ] List settings.
- [ ] Get setting by key.
- [ ] Update setting.

### Document Sequences

- [ ] List sequences.
- [ ] Get sequence by type.
- [ ] Generate next number transaction-safely.
- [ ] Update sequence config.

### Academic Years

- [ ] Create.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Activate.
- [ ] Close/deactivate.

### Terms

- [ ] Create.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Activate.
- [ ] Close.

### Levels

- [ ] Create.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Archive/deactivate.

### Classrooms

- [ ] Create.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Assign class teacher.
- [ ] Archive/deactivate.

### Staff

- [ ] Create.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Archive.

### Students

- [ ] Create.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Archive.
- [ ] Get guardians.
- [ ] Get enrollments.

### Guardians

- [ ] Create.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Archive.
- [ ] Get linked students.

### Student Guardians

- [ ] Link guardian to student.
- [ ] Update relationship flags.
- [ ] Set primary guardian.
- [ ] Unlink if allowed.

### Admissions

- [ ] Create enquiry/application.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Offer admission.
- [ ] Enroll admission.

### Enrollments

- [ ] Create.
- [ ] List.
- [ ] Get by id.
- [ ] Update.
- [ ] Withdraw.

### Files Metadata

- [ ] Create metadata.
- [ ] List.
- [ ] Get by id.
- [ ] List by owner.
- [ ] Archive.

### Audit Logs

- [ ] Internal audit logging service.
- [ ] List audit logs.
- [ ] Get audit log by id.
- [ ] Ensure no update/delete endpoints exist.

---

## 8. Tests

- [ ] Auth tests.
- [ ] RBAC tests.
- [ ] Tenant isolation tests.
- [ ] Document sequence concurrency tests.
- [ ] Audit log immutability tests.
- [ ] Student-guardian relationship tests.
- [ ] Enrollment validation tests.

---

## 9. Final Verification

- [ ] `npm run prisma:format`
- [ ] `npm run prisma:validate`
- [ ] `npm run prisma:migrate`
- [ ] `npm run prisma:generate`
- [ ] `npm run prisma:seed`
- [ ] `npm run test`
- [ ] `npm run start:dev`
