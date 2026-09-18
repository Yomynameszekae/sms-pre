import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSION_KEY = 'anyPermission';

/** Caller must hold EVERY listed permission. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Caller must hold AT LEAST ONE of the listed permissions.
 *
 * Added for the attendance module, where an operation is reachable by two
 * different grants: `attendance.read` (your own classrooms) and
 * `attendance.read_any` (every classroom). A Headteacher holds only the
 * second and a Class Teacher only the first, so neither a single key nor
 * `RequirePermissions`' all-of semantics can express "may call this at all".
 *
 * This decorator answers ONLY "may this caller reach the endpoint". WHICH
 * classrooms they then see is a row-level question the service answers — see
 * AttendanceService.assertClassroomAccess. Keeping the two apart is why
 * PermissionsGuard stays a pure key check and never learns about resources.
 */
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);
