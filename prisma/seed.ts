import { PrismaClient, DocumentSequenceType, AuthTokenChannel, AuthTokenType } from '@prisma/client';
import { createHmac } from 'crypto';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

function hashToken(token: string): string {
  const secret = process.env.TOKEN_HASH_SECRET || 'default-token-secret';
  return createHmac('sha256', secret).update(token).digest('hex');
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

const PERMISSIONS = [
  { key: 'auth.login', module: 'auth' },
  { key: 'auth.refresh', module: 'auth' },
  { key: 'auth.logout', module: 'auth' },
  { key: 'auth.change_password', module: 'auth' },
  { key: 'users.create', module: 'users' },
  { key: 'users.read', module: 'users' },
  { key: 'users.update', module: 'users' },
  { key: 'users.deactivate', module: 'users' },
  { key: 'users.manage_roles', module: 'users' },
  { key: 'roles.create', module: 'roles' },
  { key: 'roles.read', module: 'roles' },
  { key: 'roles.update', module: 'roles' },
  { key: 'roles.assign_permissions', module: 'roles' },
  { key: 'permissions.read', module: 'permissions' },
  { key: 'school.read', module: 'school' },
  { key: 'school.update', module: 'school' },
  { key: 'school_settings.read', module: 'school_settings' },
  { key: 'school_settings.update', module: 'school_settings' },
  { key: 'document_sequences.read', module: 'document_sequences' },
  { key: 'document_sequences.update', module: 'document_sequences' },
  { key: 'document_sequences.generate', module: 'document_sequences' },
  { key: 'academic_years.create', module: 'academic_years' },
  { key: 'academic_years.read', module: 'academic_years' },
  { key: 'academic_years.update', module: 'academic_years' },
  { key: 'academic_years.activate', module: 'academic_years' },
  { key: 'academic_years.close', module: 'academic_years' },
  { key: 'terms.create', module: 'terms' },
  { key: 'terms.read', module: 'terms' },
  { key: 'terms.update', module: 'terms' },
  { key: 'terms.activate', module: 'terms' },
  { key: 'terms.close', module: 'terms' },
  { key: 'levels.create', module: 'levels' },
  { key: 'levels.read', module: 'levels' },
  { key: 'levels.update', module: 'levels' },
  { key: 'levels.archive', module: 'levels' },
  { key: 'classrooms.create', module: 'classrooms' },
  { key: 'classrooms.read', module: 'classrooms' },
  { key: 'classrooms.update', module: 'classrooms' },
  { key: 'classrooms.assign_teacher', module: 'classrooms' },
  { key: 'classrooms.archive', module: 'classrooms' },
  { key: 'staff.create', module: 'staff' },
  { key: 'staff.read', module: 'staff' },
  { key: 'staff.update', module: 'staff' },
  { key: 'staff.archive', module: 'staff' },
  { key: 'students.create', module: 'students' },
  { key: 'students.read', module: 'students' },
  { key: 'students.update', module: 'students' },
  { key: 'students.archive', module: 'students' },
  { key: 'guardians.create', module: 'guardians' },
  { key: 'guardians.read', module: 'guardians' },
  { key: 'guardians.update', module: 'guardians' },
  { key: 'guardians.archive', module: 'guardians' },
  { key: 'student_guardians.manage', module: 'student_guardians' },
  { key: 'admissions.create', module: 'admissions' },
  { key: 'admissions.read', module: 'admissions' },
  { key: 'admissions.update', module: 'admissions' },
  { key: 'admissions.approve', module: 'admissions' },
  { key: 'admissions.enroll', module: 'admissions' },
  { key: 'enrollments.create', module: 'enrollments' },
  { key: 'enrollments.read', module: 'enrollments' },
  { key: 'enrollments.update', module: 'enrollments' },
  { key: 'enrollments.withdraw', module: 'enrollments' },
  { key: 'files.upload', module: 'files' },
  { key: 'files.read', module: 'files' },
  { key: 'files.archive', module: 'files' },
  { key: 'audit_logs.read', module: 'audit_logs' },
];

const ROLES = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full system access' },
  { code: 'SCHOOL_ADMIN', name: 'School Admin', description: 'Full school operational access' },
  { code: 'HEADTEACHER', name: 'Headteacher', description: 'School leadership read access' },
  { code: 'ACADEMIC_COORDINATOR', name: 'Academic Coordinator', description: 'Academic management access' },
  { code: 'CLASS_TEACHER', name: 'Class Teacher', description: 'Classroom-level access' },
  { code: 'ADMISSIONS_OFFICER', name: 'Admissions Officer', description: 'Admissions and enrollment access' },
  { code: 'PARENT_GUARDIAN', name: 'Parent/Guardian', description: 'Limited read access to linked students' },
  { code: 'COMPLIANCE_OFFICER', name: 'Compliance Officer', description: 'Audit and compliance read access' },
];

// Permissions per role based on PERMISSIONS_MATRIX_PHASE_1.md
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key),
  SCHOOL_ADMIN: PERMISSIONS.map((p) => p.key),
  HEADTEACHER: [
    'school.read', 'academic_years.read', 'terms.read', 'levels.read', 'classrooms.read',
    'staff.read', 'students.read', 'guardians.read', 'admissions.read', 'admissions.approve',
    'enrollments.read', 'files.read', 'audit_logs.read',
  ],
  ACADEMIC_COORDINATOR: [
    'academic_years.read', 'terms.read', 'levels.create', 'levels.read', 'levels.update', 'levels.archive',
    'classrooms.create', 'classrooms.read', 'classrooms.update', 'classrooms.assign_teacher', 'classrooms.archive',
    'staff.read', 'students.read', 'guardians.read',
    'enrollments.create', 'enrollments.read', 'enrollments.update', 'enrollments.withdraw',
  ],
  CLASS_TEACHER: ['classrooms.read', 'students.read', 'guardians.read', 'enrollments.read', 'files.read'],
  ADMISSIONS_OFFICER: [
    'students.create', 'students.read', 'students.update',
    'guardians.create', 'guardians.read', 'guardians.update',
    'student_guardians.manage',
    'admissions.create', 'admissions.read', 'admissions.update', 'admissions.enroll',
    'document_sequences.generate',
    'enrollments.create', 'enrollments.read',
    'files.upload', 'files.read',
  ],
  PARENT_GUARDIAN: ['students.read', 'guardians.read', 'files.read', 'enrollments.read'],
  COMPLIANCE_OFFICER: ['audit_logs.read', 'students.read', 'guardians.read', 'staff.read', 'files.read'],
};

async function main() {
  console.log('Starting seed...');

  // 1. Seed permissions (idempotent via upsert)
  console.log('Seeding permissions...');
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: { key: perm.key, module: perm.module, description: `${perm.key} permission` },
    });
  }

  // 2. Seed system roles (schoolId = null, upsert by code)
  console.log('Seeding system roles...');
  for (const role of ROLES) {
    const existing = await prisma.role.findFirst({
      where: { code: role.code, schoolId: null },
    });
    if (!existing) {
      await prisma.role.create({
        data: { code: role.code, name: role.name, description: role.description, isSystemRole: true, schoolId: null },
      });
    }
  }

  // 3. Seed role-permission mappings
  console.log('Seeding role-permission mappings...');
  for (const [roleCode, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findFirst({ where: { code: roleCode, schoolId: null } });
    if (!role) continue;
    for (const key of permKeys) {
      const perm = await prisma.permission.findUnique({ where: { key } });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // 4. Seed school
  console.log('Seeding school...');
  const schoolName = process.env.SEED_SCHOOL_NAME || 'Demo Ghana Private School';
  const schoolSlug = process.env.SEED_SCHOOL_SLUG || 'demo-ghana-private-school';
  let school = await prisma.school.findFirst({ where: { slug: schoolSlug } });
  if (!school) {
    school = await prisma.school.create({
      data: {
        name: schoolName,
        slug: schoolSlug,
        phone: '233200000000',
        email: 'admin@example.com',
        address: 'Accra, Ghana',
        isActive: true,
      },
    });
  }

  // 5. Seed school settings
  console.log('Seeding school settings...');
  const settings = [
    { key: 'academic.default_curriculum_scope', value: { value: 'BOTH', type: 'string' }, desc: 'Default curriculum scope' },
    { key: 'academic.primary_calendar', value: { value: 'GES_TERM_STRUCTURE', type: 'string' }, desc: 'Primary calendar structure' },
    { key: 'auth.access_token_minutes', value: { value: 15, type: 'number' }, desc: 'Access token lifetime in minutes' },
    { key: 'auth.refresh_token_days', value: { value: 14, type: 'number' }, desc: 'Refresh token lifetime in days' },
    { key: 'files.default_storage_bucket', value: { value: process.env.S3_BUCKET || 'ghana-sms-dev', type: 'string' }, desc: 'Default storage bucket' },
    { key: 'files.private_by_default', value: { value: true, type: 'boolean' }, desc: 'Files are private by default' },
    { key: 'students.ghana_card_required', value: { value: false, type: 'boolean' }, desc: 'Ghana Card required for students' },
    { key: 'students.student_number_format', value: { value: '{PREFIX}-{YEAR}-{SEQUENCE}', type: 'string' }, desc: 'Student number format' },
    { key: 'admissions.admission_number_format', value: { value: 'ADM-{YEAR}-{SEQUENCE}', type: 'string' }, desc: 'Admission number format' },
    { key: 'staff.staff_number_format', value: { value: 'STF-{YEAR}-{SEQUENCE}', type: 'string' }, desc: 'Staff number format' },
  ];
  for (const s of settings) {
    await prisma.schoolSetting.upsert({
      where: { schoolId_key: { schoolId: school.id, key: s.key } },
      update: {},
      create: { schoolId: school.id, key: s.key, valueJson: s.value, description: s.desc },
    });
  }

  // 6. Seed document sequences
  console.log('Seeding document sequences...');
  const sequences = [
    { type: DocumentSequenceType.student_number, prefix: 'STU', paddingLength: 4 },
    { type: DocumentSequenceType.admission_number, prefix: 'ADM', paddingLength: 4 },
    { type: DocumentSequenceType.staff_number, prefix: 'STF', paddingLength: 4 },
    { type: DocumentSequenceType.invoice_number, prefix: 'INV', paddingLength: 5 },
    { type: DocumentSequenceType.receipt_number, prefix: 'RCT', paddingLength: 5 },
  ];
  for (const seq of sequences) {
    await prisma.documentSequence.upsert({
      where: { schoolId_type: { schoolId: school.id, type: seq.type } },
      update: {},
      create: {
        schoolId: school.id,
        type: seq.type,
        prefix: seq.prefix,
        currentNumber: 0,
        paddingLength: seq.paddingLength,
        resetPolicy: 'yearly',
      },
    });
  }

  // 7. Seed Super Admin staff + user
  console.log('Seeding Super Admin...');
  const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@example.com';
  const adminPhone = process.env.SEED_SUPER_ADMIN_PHONE || '233200000000';
  const adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD || 'ChangeMe123!';

  let superAdminStaff = await prisma.staff.findFirst({
    where: { schoolId: school.id, staffNumber: 'STF-0001' },
  });
  if (!superAdminStaff) {
    superAdminStaff = await prisma.staff.create({
      data: {
        schoolId: school.id,
        staffNumber: 'STF-0001',
        firstName: 'System',
        lastName: 'Administrator',
        email: adminEmail,
        roleCategory: 'admin',
        employmentType: 'full_time',
        status: 'active',
      },
    });
  }

  let superAdminUser = await prisma.user.findFirst({
    where: { schoolId: school.id, email: adminEmail },
  });
  if (!superAdminUser) {
    const passwordHash = await hashPassword(adminPassword);
    superAdminUser = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: adminEmail,
        phone: adminPhone,
        passwordHash,
        linkedEntityType: 'staff',
        linkedEntityId: superAdminStaff.id,
        isActive: true,
        mustChangePassword: true,
      },
    });
  }

  // 8. Assign SUPER_ADMIN role to super admin user
  const superAdminRole = await prisma.role.findFirst({ where: { code: 'SUPER_ADMIN', schoolId: null } });
  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: superAdminUser.id, roleId: superAdminRole.id } },
      update: {},
      create: { userId: superAdminUser.id, roleId: superAdminRole.id },
    });
  }

  // 9. Write seed audit log (idempotent — skip if a seed.completed log already exists for this school)
  const existingSeedLog = await prisma.auditLog.findFirst({
    where: { schoolId: school.id, action: 'seed.completed', actorType: 'seed' },
  });
  if (!existingSeedLog) {
    await prisma.auditLog.create({
      data: {
        schoolId: school.id,
        actorType: 'seed',
        action: 'seed.completed',
        module: 'seed',
        metadata: {
          permissionsCount: PERMISSIONS.length,
          rolesCount: ROLES.length,
          schoolSlug,
        },
      },
    });
  }

  console.log('Seed completed successfully!');
  console.log(`School: ${school.name} (${school.slug})`);
  console.log(`Super Admin email: ${adminEmail}`);
  console.log(`Super Admin user ID: ${superAdminUser.id}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
