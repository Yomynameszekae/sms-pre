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

import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from './permissions.catalog';

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
