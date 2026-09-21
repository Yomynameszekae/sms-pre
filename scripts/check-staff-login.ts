/**
 * Reports whether a staff member has a login account, and what that account
 * can do.
 *
 * WHY THIS EXISTS. Staff and User are separate records joined by a soft
 * reference — `users.linked_entity_type` + `users.linked_entity_id`, with no
 * foreign key and no relation declared in the schema. There is no way to see
 * from a Staff row alone whether somebody can sign in as that person, and a
 * staff member with no login simply does not appear on the User Accounts
 * screen at all. That absence is the expected state for a staff member nobody
 * has provisioned, not a fault — but it is indistinguishable from a fault
 * without looking, which is what this does.
 *
 * READ-ONLY. It issues SELECTs and nothing else, so it is safe to run against
 * production. It never invokes prisma migrate in any form.
 *
 *   npm run staff:login-check -- "Benjamin Opoku"
 *   npm run staff:login-check -- benjamin@school.com
 *   npm run staff:login-check -- 7f3c1e02-....-....
 *   npm run staff:login-check -- --unlinked      (every staff member with no login)
 *
 * On the deployed server, through the app container:
 *
 *   docker exec -it <container> npm run staff:login-check -- "Benjamin Opoku"
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2).filter((a) => a !== '--');
const LIST_UNLINKED = args.includes('--unlinked');
const term = args.filter((a) => !a.startsWith('--')).join(' ').trim();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function staffWhere(value: string): Prisma.StaffWhereInput {
  if (UUID.test(value)) return { id: value };
  if (value.includes('@')) return { email: { equals: value, mode: 'insensitive' } };

  // A name: match first, last, "first last", or the staff number.
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      AND: [
        { firstName: { contains: parts[0], mode: 'insensitive' } },
        { lastName: { contains: parts[parts.length - 1], mode: 'insensitive' } },
      ],
    };
  }
  return {
    OR: [
      { firstName: { contains: value, mode: 'insensitive' } },
      { lastName: { contains: value, mode: 'insensitive' } },
      { staffNumber: { contains: value, mode: 'insensitive' } },
    ],
  };
}

async function describe(staff: {
  id: string; schoolId: string; staffNumber: string;
  firstName: string; lastName: string; email: string | null;
  status: string; roleCategory: string;
}) {
  console.log(`\n${staff.firstName} ${staff.lastName}  (${staff.staffNumber})`);
  console.log(`  staff id      ${staff.id}`);
  console.log(`  staff email   ${staff.email ?? '(none on the staff record)'}`);
  console.log(`  staff status  ${staff.status}`);
  console.log(`  HR category   ${staff.roleCategory}   <- not a permission; filtering only`);

  // The soft join. There is no FK, so this is the only way to find the login.
  const users = await prisma.user.findMany({
    where: {
      schoolId: staff.schoolId,
      linkedEntityType: 'staff',
      linkedEntityId: staff.id,
    },
    select: {
      id: true, email: true, phone: true, isActive: true,
      mustChangePassword: true, lastLoginAt: true, createdAt: true,
      roles: { select: { role: { select: { code: true, name: true } } } },
    },
  });

  if (!users.length) {
    console.log('\n  LOGIN: none.');
    console.log('  This staff member has no user account, so they cannot sign in and');
    console.log('  will not appear on the User Accounts screen. Expected for anyone');
    console.log('  nobody has provisioned a login for.');
    return;
  }

  // uq_users_school_linked_entity makes more than one impossible; if this ever
  // prints a second row, that index is missing on this database.
  if (users.length > 1) {
    console.log(`\n  WARNING: ${users.length} logins point at this staff member.`);
    console.log('  uq_users_school_linked_entity should make that impossible — check');
    console.log('  that the raw-SQL index set has been applied to this database.');
  }

  for (const u of users) {
    console.log('\n  LOGIN: yes');
    console.log(`    user id          ${u.id}`);
    console.log(`    email            ${u.email ?? '(none)'}`);
    console.log(`    phone            ${u.phone ?? '(none)'}`);
    console.log(`    active           ${u.isActive}`);
    console.log(`    must change pw   ${u.mustChangePassword}`);
    console.log(`    last login       ${u.lastLoginAt?.toISOString() ?? 'never'}`);
    const codes = u.roles.map((r) => r.role.code).sort();
    console.log(`    roles            ${codes.length ? codes.join(', ') : 'NONE'}`);
    if (!codes.length) {
      console.log('      This account can sign in but will be refused everywhere.');
      console.log('      Assign a role on the User Accounts screen.');
    }
  }
}

async function main() {
  if (LIST_UNLINKED) {
    const staff = await prisma.staff.findMany({
      where: { archivedAt: null },
      select: { id: true, schoolId: true, staffNumber: true, firstName: true, lastName: true, status: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const linked = new Set(
      (await prisma.user.findMany({
        where: { linkedEntityType: 'staff' },
        select: { linkedEntityId: true },
      })).map((u) => u.linkedEntityId),
    );
    const without = staff.filter((s) => !linked.has(s.id));
    console.log(`Staff without a login: ${without.length} of ${staff.length}\n`);
    for (const s of without) {
      console.log(`  ${s.staffNumber.padEnd(12)} ${s.firstName} ${s.lastName}  (${s.status})`);
    }
    if (!without.length) console.log('  every staff member has a login');
    return;
  }

  if (!term) {
    console.log('Usage: npm run staff:login-check -- "<name | email | staff id>"');
    console.log('       npm run staff:login-check -- --unlinked');
    process.exitCode = 1;
    return;
  }

  const matches = await prisma.staff.findMany({
    where: staffWhere(term),
    select: {
      id: true, schoolId: true, staffNumber: true, firstName: true,
      lastName: true, email: true, status: true, roleCategory: true,
    },
    take: 25,
  });

  if (!matches.length) {
    console.log(`No staff record matches "${term}".`);
    console.log('Try the staff number, the email on the staff record, or the staff id.');
    process.exitCode = 1;
    return;
  }

  console.log(`${matches.length} staff record(s) matching "${term}":`);
  for (const s of matches) await describe(s);
}

main()
  .catch((e) => { console.error('Check failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
