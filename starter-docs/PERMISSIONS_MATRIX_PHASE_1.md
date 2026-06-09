# Phase 1 Permissions Matrix

## Roles

```txt
SUPER_ADMIN
SCHOOL_ADMIN
HEADTEACHER
ACADEMIC_COORDINATOR
CLASS_TEACHER
ADMISSIONS_OFFICER
PARENT_GUARDIAN
COMPLIANCE_OFFICER
```

---

## Permission Matrix

| Permission | SUPER_ADMIN | SCHOOL_ADMIN | HEADTEACHER | ACADEMIC_COORDINATOR | CLASS_TEACHER | ADMISSIONS_OFFICER | PARENT_GUARDIAN | COMPLIANCE_OFFICER |
|---|---|---|---|---|---|---|---|---|
| users.create | Yes | Yes | No | No | No | No | No | No |
| users.read | Yes | Yes | No | No | No | No | No | No |
| users.update | Yes | Yes | No | No | No | No | No | No |
| users.deactivate | Yes | Yes | No | No | No | No | No | No |
| users.manage_roles | Yes | Yes | No | No | No | No | No | No |
| roles.create | Yes | Yes | No | No | No | No | No | No |
| roles.read | Yes | Yes | No | No | No | No | No | No |
| roles.update | Yes | Yes | No | No | No | No | No | No |
| roles.assign_permissions | Yes | Yes | No | No | No | No | No | No |
| permissions.read | Yes | Yes | No | No | No | No | No | No |
| school.read | Yes | Yes | Yes | No | No | No | No | No |
| school.update | Yes | Yes | No | No | No | No | No | No |
| school_settings.read | Yes | Yes | No | No | No | No | No | No |
| school_settings.update | Yes | Yes | No | No | No | No | No | No |
| document_sequences.read | Yes | Yes | No | No | No | No | No | No |
| document_sequences.update | Yes | Yes | No | No | No | No | No | No |
| document_sequences.generate | Yes | Yes | No | No | No | Yes | No | No |
| academic_years.create | Yes | Yes | No | No | No | No | No | No |
| academic_years.read | Yes | Yes | Yes | Yes | No | No | No | No |
| academic_years.update | Yes | Yes | No | No | No | No | No | No |
| academic_years.activate | Yes | Yes | No | No | No | No | No | No |
| academic_years.close | Yes | Yes | No | No | No | No | No | No |
| terms.create | Yes | Yes | No | No | No | No | No | No |
| terms.read | Yes | Yes | Yes | Yes | No | No | No | No |
| terms.update | Yes | Yes | No | No | No | No | No | No |
| terms.activate | Yes | Yes | No | No | No | No | No | No |
| terms.close | Yes | Yes | No | No | No | No | No | No |
| levels.create | Yes | Yes | No | Yes | No | No | No | No |
| levels.read | Yes | Yes | Yes | Yes | No | No | No | No |
| levels.update | Yes | Yes | No | Yes | No | No | No | No |
| levels.archive | Yes | Yes | No | Yes | No | No | No | No |
| classrooms.create | Yes | Yes | No | Yes | No | No | No | No |
| classrooms.read | Yes | Yes | Yes | Yes | Yes | No | No | No |
| classrooms.update | Yes | Yes | No | Yes | No | No | No | No |
| classrooms.assign_teacher | Yes | Yes | No | Yes | No | No | No | No |
| classrooms.archive | Yes | Yes | No | Yes | No | No | No | No |
| staff.create | Yes | Yes | No | No | No | No | No | No |
| staff.read | Yes | Yes | Yes | Yes | No | No | No | Yes |
| staff.update | Yes | Yes | No | No | No | No | No | No |
| staff.archive | Yes | Yes | No | No | No | No | No | No |
| students.create | Yes | Yes | No | No | No | Yes | No | No |
| students.read | Yes | Yes | Yes | Yes | Yes | Yes | Linked only | Yes |
| students.update | Yes | Yes | No | No | No | Yes | No | No |
| students.archive | Yes | Yes | No | No | No | No | No | No |
| guardians.create | Yes | Yes | No | No | No | Yes | No | No |
| guardians.read | Yes | Yes | Yes | No | Yes | Yes | Own record only | Yes |
| guardians.update | Yes | Yes | No | No | No | Yes | No | No |
| guardians.archive | Yes | Yes | No | No | No | No | No | No |
| student_guardians.manage | Yes | Yes | No | No | No | Yes | No | No |
| admissions.create | Yes | Yes | No | No | No | Yes | No | No |
| admissions.read | Yes | Yes | Yes | No | No | Yes | No | No |
| admissions.update | Yes | Yes | No | No | No | Yes | No | No |
| admissions.approve | Yes | Yes | Yes | No | No | No | No | No |
| admissions.enroll | Yes | Yes | No | No | No | Yes | No | No |
| enrollments.create | Yes | Yes | No | Yes | No | Yes | No | No |
| enrollments.read | Yes | Yes | Yes | Yes | Yes | Yes | Linked only | No |
| enrollments.update | Yes | Yes | No | Yes | No | No | No | No |
| enrollments.withdraw | Yes | Yes | No | Yes | No | No | No | No |
| files.upload | Yes | Yes | No | No | No | Yes | No | No |
| files.read | Yes | Yes | Yes | Yes | Yes | Yes | Linked only | Yes |
| files.archive | Yes | Yes | No | No | No | No | No | No |
| audit_logs.read | Yes | Yes | Yes | No | No | No | No | Yes |

## Important Notes

- `SUPER_ADMIN` may receive all permissions.
- `PARENT_GUARDIAN` permissions must always be constrained to linked students only.
- `CLASS_TEACHER` access must later be constrained to assigned classroom students.
- Permission keys are the source of access control, not role names.
