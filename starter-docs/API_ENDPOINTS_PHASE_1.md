# Phase 1 API Endpoints

## Response Shape

Use a consistent response shape.

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

For paginated responses:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 0
    }
  }
}
```

---

## Auth

Base route: `/auth`

```txt
POST /auth/login
POST /auth/refresh
POST /auth/logout
POST /auth/change-password
POST /auth/password-reset/request
POST /auth/password-reset/confirm
POST /auth/account-setup/confirm
GET  /auth/me
```

### Auth rules

- Login accepts email or phone plus password.
- Refresh token is stored in HTTP-only cookie.
- Refresh token must be rotated.
- Logout revokes current session.
- Password change revokes old sessions.
- Store only hashed refresh/reset/setup tokens.

---

## Users

Base route: `/users`

```txt
POST   /users
GET    /users
GET    /users/:id
PATCH  /users/:id
PATCH  /users/:id/deactivate
POST   /users/:id/roles
DELETE /users/:id/roles/:roleId
```

Permissions:

```txt
users.create
users.read
users.update
users.deactivate
users.manage_roles
```

---

## Roles

Base route: `/roles`

```txt
POST  /roles
GET   /roles
GET   /roles/:id
PATCH /roles/:id
POST  /roles/:id/permissions
DELETE /roles/:id/permissions/:permissionId
```

Permissions:

```txt
roles.create
roles.read
roles.update
roles.assign_permissions
```

---

## Permissions

Base route: `/permissions`

```txt
GET /permissions
GET /permissions/:id
```

Permission:

```txt
permissions.read
```

---

## School

Base route: `/school`

```txt
GET   /school
PATCH /school
```

Permissions:

```txt
school.read
school.update
```

---

## School Settings

Base route: `/school-settings`

```txt
GET   /school-settings
GET   /school-settings/:key
PATCH /school-settings/:key
```

Permissions:

```txt
school_settings.read
school_settings.update
```

---

## Document Sequences

Base route: `/document-sequences`

```txt
GET  /document-sequences
GET  /document-sequences/:type
POST /document-sequences/:type/generate
PATCH /document-sequences/:type
```

Permissions:

```txt
document_sequences.read
document_sequences.generate
document_sequences.update
```

Sequence generation must be transaction-safe.

---

## Academic Years

Base route: `/academic-years`

```txt
POST  /academic-years
GET   /academic-years
GET   /academic-years/:id
PATCH /academic-years/:id
POST  /academic-years/:id/activate
POST  /academic-years/:id/close
```

Permissions:

```txt
academic_years.create
academic_years.read
academic_years.update
academic_years.activate
academic_years.close
```

---

## Terms

Base route: `/terms`

```txt
POST  /terms
GET   /terms
GET   /terms/:id
PATCH /terms/:id
POST  /terms/:id/activate
POST  /terms/:id/close
```

Permissions:

```txt
terms.create
terms.read
terms.update
terms.activate
terms.close
```

---

## Levels

Base route: `/levels`

```txt
POST  /levels
GET   /levels
GET   /levels/:id
PATCH /levels/:id
POST  /levels/:id/archive
```

Permissions:

```txt
levels.create
levels.read
levels.update
levels.archive
```

---

## Classrooms

Base route: `/classrooms`

```txt
POST  /classrooms
GET   /classrooms
GET   /classrooms/:id
PATCH /classrooms/:id
POST  /classrooms/:id/assign-class-teacher
POST  /classrooms/:id/archive
```

Permissions:

```txt
classrooms.create
classrooms.read
classrooms.update
classrooms.assign_teacher
classrooms.archive
```

---

## Staff

Base route: `/staff`

```txt
POST  /staff
GET   /staff
GET   /staff/:id
PATCH /staff/:id
POST  /staff/:id/archive
```

Permissions:

```txt
staff.create
staff.read
staff.update
staff.archive
```

---

## Students

Base route: `/students`

```txt
POST  /students
GET   /students
GET   /students/:id
PATCH /students/:id
POST  /students/:id/archive
GET   /students/:id/guardians
GET   /students/:id/enrollments
```

Permissions:

```txt
students.create
students.read
students.update
students.archive
```

---

## Guardians

Base route: `/guardians`

```txt
POST  /guardians
GET   /guardians
GET   /guardians/:id
PATCH /guardians/:id
POST  /guardians/:id/archive
GET   /guardians/:id/students
```

Permissions:

```txt
guardians.create
guardians.read
guardians.update
guardians.archive
```

---

## Student-Guardian Relationships

Base route: `/student-guardians`

```txt
POST  /student-guardians
PATCH /student-guardians/:id
DELETE /student-guardians/:id
POST  /student-guardians/:id/set-primary
```

Permission:

```txt
student_guardians.manage
```

---

## Admissions

Base route: `/admissions`

```txt
POST  /admissions
GET   /admissions
GET   /admissions/:id
PATCH /admissions/:id
POST  /admissions/:id/offer
POST  /admissions/:id/enroll
```

Permissions:

```txt
admissions.create
admissions.read
admissions.update
admissions.approve
admissions.enroll
```

---

## Enrollments

Base route: `/enrollments`

```txt
POST  /enrollments
GET   /enrollments
GET   /enrollments/:id
PATCH /enrollments/:id
POST  /enrollments/:id/withdraw
```

Permissions:

```txt
enrollments.create
enrollments.read
enrollments.update
enrollments.withdraw
```

---

## Files Metadata

Base route: `/files`

```txt
POST  /files
GET   /files
GET   /files/:id
GET   /files/owner/:ownerType/:ownerId
POST  /files/:id/archive
```

Permissions:

```txt
files.upload
files.read
files.archive
```

Do not implement binary upload unless explicitly instructed. Phase 1 is metadata only.

---

## Audit Logs

Base route: `/audit-logs`

```txt
GET /audit-logs
GET /audit-logs/:id
```

Permission:

```txt
audit_logs.read
```

No create/update/delete public endpoints. Audit creation should happen internally in backend services.
