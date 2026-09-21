/**
 * Backfills the permission catalogue into an already-migrated database.
 *
 * WHY THIS EXISTS. `prisma migrate deploy` ships SCHEMA. Permissions are
 * DATA — rows in `permissions` and `role_permissions` — so a server that has
 * every migration applied can still be missing a permission added in a later
 * phase. The symptom is a 403 on a feature that works locally, with nothing
 * wrong in the migration history to explain it.
 *
 * WHY NOT JUST RE-RUN THE SEED. `prisma:seed` is idempotent for permissions,
 * but it also creates a demo school, settings, document sequences and a super
 * admin. Pointing it at production to fix a permission row does far more than
 * asked. This script touches `permissions` and `role_permissions` and nothing
 * else.
 *
 * WHY NOT AD-HOC SQL. A hand-written INSERT is correct once and then rots:
 * the next phase adds permissions and somebody has to remember to write
 * another one. This reads the same catalogue the seed reads, so it is correct
 * for every future phase without being edited.
 *
 * SAFETY. Read-only by default — it reports drift and exits. It only writes
 * with --apply, and then only ever INSERTS: no row is updated or deleted, so
 * a permission a school deliberately revoked from a role stays revoked unless
 * --restore-defaults is given.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/sync-permissions.ts
 *   npx ts-node -r tsconfig-paths/register scripts/sync-permissions.ts --apply
 *
 * This never runs `prisma migrate` in any form.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from '../prisma/permissions.catalog';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
// Off by default: re-adding a grant an administrator intentionally removed is
// a surprise. Only relevant for roles that already exist.
const RESTORE_DEFAULTS = process.argv.includes('--restore-defaults');

async function main() {
  const mode = APPLY ? 'APPLY' : 'DRY RUN (read-only)';
  console.log(`Permission sync — ${mode}\n`);

  // ── 1. permissions that the catalogue defines but the database lacks ─────
  const existing = await prisma.permission.findMany({ select: { id: true, key: true } });
  const byKey = new Map(existing.map((p) => [p.key, p.id]));
  const missingPerms = PERMISSIONS.filter((p) => !byKey.has(p.key));

  console.log(`permissions: ${existing.length} in database, ${PERMISSIONS.length} in catalogue`);
  if (missingPerms.length) {
    console.log(`  MISSING (${missingPerms.length}):`);
    for (const p of missingPerms) console.log(`    ${p.key}`);
  } else {
    console.log('  all present');
  }

  if (APPLY && missingPerms.length) {
    for (const p of missingPerms) {
      const created = await prisma.permission.upsert({
        where: { key: p.key },
        update: {},
        create: { key: p.key, module: p.module, description: `${p.key} permission` },
      });
      byKey.set(created.key, created.id);
    }
    console.log(`  created ${missingPerms.length}`);
  }

  // ── 2. roles the catalogue defines but the database lacks ────────────────
  const dbRoles = await prisma.role.findMany({
    where: { schoolId: null },
    select: { id: true, code: true },
  });
  const roleByCode = new Map(dbRoles.map((r) => [r.code, r.id]));
  const missingRoles = ROLES.filter((r) => !roleByCode.has(r.code));

  console.log(`\nsystem roles: ${dbRoles.length} in database, ${ROLES.length} in catalogue`);
  if (missingRoles.length) {
    console.log(`  MISSING: ${missingRoles.map((r) => r.code).join(', ')}`);
    if (APPLY) {
      for (const r of missingRoles) {
        const created = await prisma.role.create({
          data: {
            code: r.code, name: r.name, description: r.description,
            isSystemRole: true, schoolId: null,
          },
        });
        roleByCode.set(created.code, created.id);
      }
      console.log(`  created ${missingRoles.length}`);
    }
  } else {
    console.log('  all present');
  }

  // ── 3. default grants that are absent ────────────────────────────────────
  //
  // A grant is only reported as missing when the permission was ALSO missing,
  // unless --restore-defaults is given. Otherwise this script would undo a
  // deliberate revocation every time it ran.
  const newlyCreated = new Set(missingPerms.map((p) => p.key));
  let grantsMissing = 0;
  let grantsCreated = 0;

  console.log('\nrole grants:');
  for (const [roleCode, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleByCode.get(roleCode);
    if (!roleId) {
      console.log(`  ${roleCode}: role absent, skipped`);
      continue;
    }
    const held = new Set(
      (await prisma.rolePermission.findMany({
        where: { roleId }, select: { permission: { select: { key: true } } },
      })).map((rp) => rp.permission.key),
    );

    const candidates = keys.filter((k) => !held.has(k));
    const actionable = RESTORE_DEFAULTS ? candidates : candidates.filter((k) => newlyCreated.has(k));
    const deliberate = candidates.length - actionable.length;

    if (candidates.length) {
      grantsMissing += actionable.length;
      console.log(
        `  ${roleCode}: ${actionable.length} to grant` +
        (deliberate ? `, ${deliberate} previously revoked (left alone)` : ''),
      );
      for (const k of actionable) console.log(`      + ${k}`);
    }

    if (APPLY) {
      for (const key of actionable) {
        const permissionId = byKey.get(key);
        if (!permissionId) continue;
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId } },
          update: {},
          create: { roleId, permissionId },
        });
        grantsCreated++;
      }
    }
  }
  if (!grantsMissing) console.log('  nothing to grant');

  console.log('\n──────────────');
  if (APPLY) {
    console.log(`applied: ${missingPerms.length} permission(s), ${missingRoles.length} role(s), ${grantsCreated} grant(s)`);
    console.log('Users must sign out and back in — permissions are carried in the access token.');
  } else {
    const drift = missingPerms.length + missingRoles.length + grantsMissing;
    console.log(drift ? `${drift} change(s) pending. Re-run with --apply to write them.` : 'Database is in sync.');
  }
}

main()
  .catch((e) => { console.error('Permission sync failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
