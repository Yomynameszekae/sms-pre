import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

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
