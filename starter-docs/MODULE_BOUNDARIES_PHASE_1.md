# Module Boundaries — Phase 1

## Purpose

This file defines which Phase 1 backend modules are allowed to depend on each other.

The goal is to help Claude Code avoid spaghetti dependencies while building the NestJS backend for the Ghanaian private school management system MVP.

Phase 1 is backend-only and should stay focused on the foundation layer.

---

## 1. General Dependency Rules

Use these rules across the backend:

1. Controllers should depend only on their own service and shared guards/decorators.
2. Services may depend on allowed services listed in this document.
3. Services should not directly call unrelated business modules.
4. Shared logic should go into `common/` only when it is truly reusable.
5. `PrismaService` may be used by all modules that need database access.
6. `AuditLogsService` may be used by business services to write audit logs.
7. `AuditLogsService` must not depend on business modules.
8. `FilesService` stores metadata only in Phase 1.
9. Do not introduce Phase 2 module dependencies.
10. Avoid circular dependencies. If a circular dependency appears, redesign the service boundary instead of using `forwardRef()` unless absolutely necessary.

---

## 2. Allowed Shared Dependencies

These can be used across modules:

```txt
PrismaModule / PrismaService
ConfigModule
Common decorators
Common guards
Common DTOs
Common pagination utilities
Common hashing/token utilities
AuditLogsService
```

Important:

- `AuditLogsService` can be called by other services.
- `AuditLogsService` should not call those services back.
- Shared utilities should not contain business rules.

---

## 3. Module Dependency Map

## Auth Module

Allowed dependencies:

```txt
UsersModule
RolesModule / Permissions access
UserSessions data access
AuthTokens data access
AuditLogsModule
ConfigModule
PrismaModule
```

Auth responsibilities:

```txt
login
refresh token rotation
logout/session revoke
password change
password reset token flow
account setup token flow
current user profile
```

Auth must not depend on:

```txt
StudentsModule
GuardiansModule
AdmissionsModule
EnrollmentsModule
FilesModule
AcademicYearsModule
TermsModule
LevelsModule
ClassroomsModule
StaffModule
```

If Auth needs linked staff or guardian data, it should only expose minimal user identity and permissions. Business profile loading should be handled by the relevant module later.

---

## Users Module

Allowed dependencies:

```txt
RolesModule
AuditLogsModule
PrismaModule
```

Users responsibilities:

```txt
create user
read user
update user
deactivate user
assign/remove roles
manage linkedEntityType and linkedEntityId
```

Users must not depend directly on:

```txt
StudentsModule
GuardiansModule
StaffModule
AdmissionsModule
EnrollmentsModule
```

When creating a user linked to staff or guardian, validate the linked entity either in the calling service before calling UsersService, or through a small validation method that checks the database with Prisma without importing the full business module.

Avoid circular dependencies between Users and Staff/Guardians.

---

## Roles and Permissions Module

Allowed dependencies:

```txt
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
roles
permissions
role_permissions
user_roles support where needed
permission lookup
permission assignment
```

Must not depend on:

```txt
AuthModule
UsersModule
StudentsModule
GuardiansModule
AdmissionsModule
EnrollmentsModule
```

Auth may depend on Roles, but Roles should not depend on Auth.

---

## School Module

Allowed dependencies:

```txt
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
read current school
update school profile
```

Must not depend on:

```txt
StudentsModule
StaffModule
AdmissionsModule
EnrollmentsModule
```

---

## School Settings Module

Allowed dependencies:

```txt
SchoolModule only if necessary
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
list settings
get setting by key
update setting
seed default settings
```

Business modules may read settings when needed, but avoid making SchoolSettings call those modules.

---

## Document Sequences Module

Allowed dependencies:

```txt
SchoolModule only if necessary
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
list sequences
get sequence by type
generate next number
update sequence config
```

Can be used by:

```txt
StaffModule
StudentsModule
AdmissionsModule
future finance modules
```

Important:

- Sequence generation must be transaction-safe.
- DocumentSequencesModule should not depend on Staff, Students, Admissions, or finance modules.
- The dependency direction should be from business modules to DocumentSequencesModule.

---

## Academic Years Module

Allowed dependencies:

```txt
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create academic year
list academic years
update academic year
activate academic year
close academic year
```

Can be used by:

```txt
TermsModule
ClassroomsModule
EnrollmentsModule
```

AcademicYearsModule should not depend on those modules.

---

## Terms Module

Allowed dependencies:

```txt
AcademicYearsModule if needed for validation
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create term
list terms
update term
activate term
close term
```

Must not depend on:

```txt
AttendanceModule
AssessmentsModule
ReportCardsModule
```

Those are Phase 2.

---

## Levels Module

Allowed dependencies:

```txt
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create level
list levels
update level
archive/deactivate level
```

Can be used by:

```txt
ClassroomsModule
AdmissionsModule
```

LevelsModule should not depend on Classrooms or Admissions.

---

## Classrooms Module

Allowed dependencies:

```txt
LevelsModule
AcademicYearsModule
Staff validation via Prisma or a small Staff lookup method
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create classroom
list classrooms
update classroom
assign class teacher
archive/deactivate classroom
```

Must not depend on:

```txt
StudentsModule
EnrollmentsModule
AttendanceModule
AssessmentsModule
```

Enrollments may depend on Classrooms, but Classrooms should not depend on Enrollments.

---

## Staff Module

Allowed dependencies:

```txt
DocumentSequencesModule
UsersModule only if creating staff user accounts is explicitly required
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create staff
list staff
read staff
update staff
archive staff
```

Prefer this flow:

```txt
StaffModule creates staff record.
UsersModule creates login account if needed.
```

Avoid making StaffModule and UsersModule depend on each other in both directions.

StaffModule must not depend on:

```txt
ClassroomsModule
StudentsModule
AdmissionsModule
EnrollmentsModule
```

Classrooms can validate staff as class teacher, but Staff should not manage classrooms.

---

## Students Module

Allowed dependencies:

```txt
DocumentSequencesModule
GuardiansModule only for read/link helper if needed
StudentGuardiansModule only for relationship operations if needed
EnrollmentsModule only for read-only student enrollment lookup if needed
FilesModule only for metadata lookup if needed
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create student
list students
read student
update student
archive student
get student guardians
get student enrollments
```

Preferred boundary:

- StudentsModule owns student records.
- StudentGuardiansModule owns student-guardian links.
- EnrollmentsModule owns enrollment records.
- FilesModule owns file metadata.

Avoid putting guardian-linking or enrollment creation directly inside StudentsService unless the operation is part of an intentional workflow.

---

## Guardians Module

Allowed dependencies:

```txt
StudentGuardiansModule only for linked student lookup if needed
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create guardian
list guardians
read guardian
update guardian
archive guardian
get linked students
```

GuardiansModule should not own student records.

GuardiansModule must not depend on:

```txt
StudentsModule
AdmissionsModule
EnrollmentsModule
```

Use StudentGuardiansModule for relationship operations.

---

## Student-Guardians Module

Allowed dependencies:

```txt
Students validation via Prisma or small lookup method
Guardians validation via Prisma or small lookup method
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
link guardian to student
update relationship
set primary guardian
set emergency contact
unlink relationship if allowed
```

Important:

- Relationship belongs here, not on Guardian.
- Enforce same-school validation.
- Enforce one primary guardian per student through raw SQL plus service logic.

Avoid circular dependency between StudentsModule and GuardiansModule.

---

## Admissions Module

Allowed dependencies:

```txt
StudentsModule
GuardiansModule
StudentGuardiansModule
LevelsModule
EnrollmentsModule
DocumentSequencesModule
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create enquiry/application
update application
change admission status
offer admission
enroll admission
create or link student during enrollment workflow
create/link guardian during enrollment workflow if needed
```

Admissions is an orchestration module, so it is allowed to coordinate Students, Guardians, StudentGuardians, Levels, and Enrollments.

Admissions must not depend on:

```txt
AttendanceModule
AssessmentsModule
ReportCardsModule
Finance modules
NotificationsModule
SMSModule
```

---

## Enrollments Module

Allowed dependencies:

```txt
Students validation via Prisma or StudentsModule
Classrooms validation via Prisma or ClassroomsModule
AcademicYears validation via Prisma or AcademicYearsModule
AuditLogsModule
PrismaModule
```

Responsibilities:

```txt
create enrollment
list enrollments
read enrollment
update enrollment
withdraw enrollment
get current enrollment
```

Enrollments may depend on Students, Classrooms, and AcademicYears.

Enrollments must not depend on:

```txt
AdmissionsModule
AttendanceModule
AssessmentsModule
ReportCardsModule
Finance modules
```

Dependency direction:

```txt
Admissions may call Enrollments.
Enrollments should not call Admissions.
```

---

## Files Module

Allowed dependencies:

```txt
AuditLogsModule
PrismaModule
ConfigModule
```

Responsibilities:

```txt
create file metadata
list file metadata
get file metadata
list files by owner
archive file metadata
```

Phase 1 restriction:

```txt
Files stores metadata only.
Do not implement binary upload yet unless explicitly instructed.
Do not depend on S3/MinIO provider modules yet.
Do not expose raw storage paths as public URLs.
```

Files should not depend directly on:

```txt
StudentsModule
GuardiansModule
StaffModule
AdmissionsModule
EnrollmentsModule
```

If owner validation is needed, validate with Prisma queries or let the calling service validate ownership before creating file metadata.

---

## Audit Logs Module

Allowed dependencies:

```txt
PrismaModule
ConfigModule if needed
```

Responsibilities:

```txt
create audit log internally
list audit logs for authorized users
read audit log
filter audit logs
```

AuditLogsModule must not depend on business modules.

Business modules may depend on AuditLogsModule.

AuditLogsModule must not expose:

```txt
update audit log
delete audit log
```

The database trigger already blocks update/delete.

---

## 4. Dependency Direction Summary

Allowed high-level direction:

```txt
Auth -> Users/Roles/UserSessions/AuthTokens
Users -> Roles
Business modules -> AuditLogs
Business modules -> DocumentSequences where number generation is needed
Admissions -> Students/Guardians/StudentGuardians/Levels/Enrollments
Enrollments -> Students/Classrooms/AcademicYears
Classrooms -> Levels/AcademicYears/Staff validation
Students -> StudentGuardians/Enrollments read helpers only
Files -> no business modules
AuditLogs -> no business modules
```

Avoid this direction:

```txt
Roles -> Auth
AuditLogs -> Business modules
Files -> Business modules
Classrooms -> Enrollments
Enrollments -> Admissions
Students -> Admissions
Guardians -> Admissions
DocumentSequences -> Business modules
```

---

## 5. Circular Dependency Rules

Avoid `forwardRef()` unless there is no clean alternative.

If a circular dependency appears, fix it by:

1. Moving shared validation into a small helper method.
2. Querying directly with Prisma inside the service.
3. Moving orchestration to a higher-level module such as Admissions.
4. Splitting read-only lookup from write operations.
5. Keeping ownership clear.

Example:

Bad:

```txt
StudentsService depends on GuardiansService
GuardiansService depends on StudentsService
```

Better:

```txt
StudentGuardiansService owns the relationship.
StudentsService reads student records.
GuardiansService reads guardian records.
```

---

## 6. Phase 2 Dependency Warning

Do not create dependencies for Phase 2 modules yet.

Do not add these imports or modules in Phase 1:

```txt
AttendanceModule
AssessmentsModule
GradingModule
ReportCardsModule
FeesModule
InvoicesModule
PaymentsModule
PaymentGatewaysModule
NotificationsModule
SmsModule
ParentPortalModule
DataSubjectRequestsModule
SecurityIncidentsModule
BackupsModule
```

If a Phase 1 service seems to need one of these, leave a TODO comment instead of implementing it.

---

## 7. Practical Build Instruction for Claude Code

When building each module:

1. Create the module, controller, service, and DTOs.
2. Inject only allowed dependencies.
3. Add permission guards at controller level.
4. Enforce `schoolId` filtering in the service.
5. Validate same-school relationships before creating child records.
6. Write audit logs for sensitive actions.
7. Avoid importing unrelated modules.
8. Add tests for key business rules.

The preferred dependency style is:

```txt
Controller -> Own Service
Own Service -> PrismaService
Own Service -> AuditLogsService
Own Service -> Allowed dependency service only when necessary
```

Keep the dependency graph simple and one-directional.
