import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ANY_PERMISSION_KEY } from '../decorators/require-permissions.decorator';
import { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const anyOf = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const hasAllOf = required && required.length > 0;
    const hasAnyOf = anyOf && anyOf.length > 0;

    if (!hasAllOf && !hasAnyOf) return true;

    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user || !user.permissions) {
      throw new ForbiddenException('No permissions found on token');
    }

    if (hasAllOf) {
      const missing = required.filter((p) => !user.permissions.includes(p));
      if (missing.length) {
        throw new ForbiddenException(
          `Missing required permission(s): ${missing.join(', ')}`,
        );
      }
    }

    // Both may be present: all-of narrows, any-of widens. A handler using
    // both must satisfy each independently.
    if (hasAnyOf && !anyOf.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException(
        `Requires one of the following permission(s): ${anyOf.join(', ')}`,
      );
    }

    return true;
  }
}
