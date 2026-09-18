import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY, ANY_PERMISSION_KEY } from '../decorators/require-permissions.decorator';

function buildMockContext(permissions: string[], handlerPerms: string[]): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { sub: 'u1', schoolId: 's1', sessionId: 'sess1', permissions } }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  it('returns true when no permissions required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = buildMockContext([], []);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns true when user has required permission', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['students.read']);
    const ctx = buildMockContext(['students.read', 'students.create'], ['students.read']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user lacks permission', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['students.create']);
    const ctx = buildMockContext(['students.read'], ['students.create']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user has no permissions at all', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['school.update']);
    const ctx = buildMockContext([], ['school.update']);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user is missing even one required permission', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['students.create', 'students.read']);
    const ctx = buildMockContext(['students.read'], []);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('uses permission keys not role names', () => {
    // Guard checks user.permissions array — role names never appear there
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['school.update']);
    const userWithRoleName = {
      sub: 'u1', schoolId: 's1', sessionId: 'sess1',
      permissions: ['SUPER_ADMIN'], // role name, not permission key
    };
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => ({ user: userWithRoleName }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

describe('PermissionsGuard — RequireAnyPermission', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  /**
   * The attendance module needs "may reach this endpoint at all" to be
   * satisfiable two different ways: a Class Teacher holds `attendance.read`
   * and a Headteacher holds `attendance.read_any`, and neither holds both.
   * All-of semantics cannot express that, hence any-of.
   */
  function mockMetadata({ allOf, anyOf }: { allOf?: string[]; anyOf?: string[] }) {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === PERMISSIONS_KEY) return allOf;
      if (key === ANY_PERMISSION_KEY) return anyOf;
      return undefined;
    });
  }

  it('passes when the caller holds the first of the alternatives', () => {
    mockMetadata({ anyOf: ['attendance.read', 'attendance.read_any'] });
    expect(guard.canActivate(buildMockContext(['attendance.read'], []))).toBe(true);
  });

  it('passes when the caller holds the second of the alternatives', () => {
    mockMetadata({ anyOf: ['attendance.read', 'attendance.read_any'] });
    expect(guard.canActivate(buildMockContext(['attendance.read_any'], []))).toBe(true);
  });

  it('throws when the caller holds neither', () => {
    mockMetadata({ anyOf: ['attendance.read', 'attendance.read_any'] });
    expect(() => guard.canActivate(buildMockContext(['students.read'], []))).toThrow(
      ForbiddenException,
    );
  });

  it('all-of and any-of must BOTH be satisfied when both are present', () => {
    mockMetadata({ allOf: ['students.read'], anyOf: ['attendance.read', 'attendance.read_any'] });
    // has the any-of, missing the all-of
    expect(() => guard.canActivate(buildMockContext(['attendance.read'], []))).toThrow(
      ForbiddenException,
    );
    // has both
    expect(
      guard.canActivate(buildMockContext(['attendance.read', 'students.read'], [])),
    ).toBe(true);
  });

  it('existing all-of behaviour is unchanged when no any-of is declared', () => {
    mockMetadata({ allOf: ['students.create', 'students.read'] });
    expect(() => guard.canActivate(buildMockContext(['students.read'], []))).toThrow(
      ForbiddenException,
    );
    expect(
      guard.canActivate(buildMockContext(['students.read', 'students.create'], [])),
    ).toBe(true);
  });
});
