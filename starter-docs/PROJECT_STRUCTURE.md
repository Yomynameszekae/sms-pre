# Recommended NestJS Project Structure — Phase 1

```txt
src/
  main.ts
  app.module.ts

  common/
    decorators/
      current-user.decorator.ts
      require-permissions.decorator.ts
    guards/
      jwt-auth.guard.ts
      permissions.guard.ts
    interceptors/
      audit.interceptor.ts
      request-id.interceptor.ts
    filters/
      http-exception.filter.ts
    dto/
      pagination.dto.ts
    utils/
      hash.util.ts
      token.util.ts
      pagination.util.ts

  config/
    env.validation.ts
    app.config.ts
    database.config.ts
    auth.config.ts
    storage.config.ts

  prisma/
    prisma.module.ts
    prisma.service.ts

  auth/
    auth.module.ts
    auth.controller.ts
    auth.service.ts
    dto/
    strategies/

  users/
    users.module.ts
    users.controller.ts
    users.service.ts
    dto/

  roles/
    roles.module.ts
    roles.controller.ts
    roles.service.ts
    permissions.controller.ts
    dto/

  school/
    school.module.ts
    school.controller.ts
    school.service.ts
    dto/

  school-settings/
    school-settings.module.ts
    school-settings.controller.ts
    school-settings.service.ts
    dto/

  document-sequences/
    document-sequences.module.ts
    document-sequences.controller.ts
    document-sequences.service.ts
    dto/

  academic-years/
    academic-years.module.ts
    academic-years.controller.ts
    academic-years.service.ts
    dto/

  terms/
    terms.module.ts
    terms.controller.ts
    terms.service.ts
    dto/

  levels/
    levels.module.ts
    levels.controller.ts
    levels.service.ts
    dto/

  classrooms/
    classrooms.module.ts
    classrooms.controller.ts
    classrooms.service.ts
    dto/

  staff/
    staff.module.ts
    staff.controller.ts
    staff.service.ts
    dto/

  students/
    students.module.ts
    students.controller.ts
    students.service.ts
    dto/

  guardians/
    guardians.module.ts
    guardians.controller.ts
    guardians.service.ts
    dto/

  student-guardians/
    student-guardians.module.ts
    student-guardians.controller.ts
    student-guardians.service.ts
    dto/

  admissions/
    admissions.module.ts
    admissions.controller.ts
    admissions.service.ts
    dto/

  enrollments/
    enrollments.module.ts
    enrollments.controller.ts
    enrollments.service.ts
    dto/

  files/
    files.module.ts
    files.controller.ts
    files.service.ts
    dto/

  audit-logs/
    audit-logs.module.ts
    audit-logs.controller.ts
    audit-logs.service.ts
    dto/

prisma/
  schema.prisma
  seed.ts
  migrations/
```

## Notes

- Keep controllers thin.
- Put business rules in services.
- Use DTOs with validation.
- Use guards for auth and permissions.
- Use service-level tenant checks.
- Use audit service for sensitive actions.
- Do not build Phase 2 modules yet.
