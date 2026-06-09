# Phase 1 Test Plan

## 1. Auth Tests

### Login

- Valid email + password should login.
- Valid phone + password should login.
- Wrong password should fail.
- Unknown email/phone should fail.
- Inactive user should fail.
- Login should create a `user_sessions` record.
- Login should return access token.
- Login should set HTTP-only refresh cookie.

### Refresh Token

- Valid refresh token should rotate session.
- Old refresh token should be revoked after rotation.
- Reusing revoked refresh token should fail.
- Expired refresh token should fail.
- Refresh token should never be stored raw.

### Logout

- Logout should revoke current session.
- Logout should clear refresh cookie.
- Revoked session should not refresh.

### Password Change

- Correct old password should allow password change.
- Wrong old password should fail.
- Password change should revoke old sessions.
- Password change should update `passwordChangedAt`.

### Password Reset / Account Setup

- Password reset request should create an `auth_tokens` record.
- Token should be stored hashed.
- Expired token should fail.
- Used token should fail.
- Successful reset should set `usedAt`.

---

## 2. RBAC Tests

- User without required permission should receive 403.
- User with required permission should access route.
- Permission guard should check permission keys.
- Role name alone should not grant access unless mapped to permission.
- Changing role permissions should affect access after permission reload.

---

## 3. Tenant Isolation Tests

- User from School A cannot read School B students.
- User from School A cannot update School B staff.
- User from School A cannot link a School B guardian to a School A student.
- User from School A cannot enroll a School B student.
- User from School A cannot assign a School B staff member as class teacher.
- UUID guessing should not bypass `schoolId` filtering.

---

## 4. Document Sequence Tests

- Generating a student number increments the sequence.
- Generating an admission number increments the sequence.
- Concurrent generation should not produce duplicates.
- Sequence formatting should respect prefix and padding.
- Sequence generation should run inside a transaction.

---

## 5. Academic Setup Tests

### Academic Years

- Cannot create duplicate academic year label for same school.
- Can create same label for different schools.
- Cannot activate more than one academic year per school.
- End date must be after start date.

### Terms

- Cannot create duplicate term number in same academic year.
- Cannot activate more than one term per school.
- Term number must be between 1 and 4.
- End date must be after start date.
- Exam date pair must be valid.

### Levels

- Cannot create duplicate level name in same school.
- Cannot create duplicate level order in same school.

### Classrooms

- Cannot create duplicate section for same level and academic year.
- Capacity must be positive.
- Class teacher must belong to the same school.

---

## 6. People Record Tests

### Staff

- Cannot create duplicate staff number in same school.
- Staff email uniqueness should be case-insensitive where present.
- Staff archive should set `archivedAt`.

### Students

- Ghana Card should be optional.
- Cannot create duplicate student number in same school.
- Student archive should set `archivedAt`.

### Guardians

- Cannot create duplicate primary phone in same school.
- Guardian archive should set `archivedAt`.
- Relationship should not exist on guardian directly.

### Student-Guardian Relationships

- Can link guardian to student.
- Cannot duplicate same student-guardian link.
- Only one primary guardian per student.
- Relationship is stored on link table.
- Emergency contact flag can be updated.

---

## 7. Admissions Tests

- Can create enquiry without student.
- Can attach student later.
- Admission number can be null.
- Non-null admission number must be unique per school.
- Status can move through enquiry → application → offered → enrolled.
- Enrolling admission should create or link student and enrollment as required.

---

## 8. Enrollment Tests

- Student can be enrolled into classroom for academic year.
- Cannot create duplicate active enrollment for same student and academic year.
- Enrollment must reference same-school student, classroom, and academic year.
- Withdrawal should set status and exit reason/date.

---

## 9. Files Metadata Tests

- Can create file metadata.
- File size must be greater than zero.
- `storageBucket` is required.
- `storageKey` is required.
- Files are private by default.
- Archive sets `archivedAt`.
- File owner must belong to same school where applicable.

---

## 10. Audit Log Tests

- Sensitive actions create audit logs.
- Audit log includes requestId where available.
- Audit log includes actorType.
- Audit logs can be read by authorized users.
- Audit logs cannot be updated.
- Audit logs cannot be deleted.
