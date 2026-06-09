import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { hashPassword, verifyPassword, hashToken, verifyTokenHash } from '../common/utils/hash.util';
import { generateSecureToken } from '../common/utils/token.util';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordResetRequestDto, PasswordResetConfirmDto } from './dto/password-reset.dto';
import { AccountSetupConfirmDto } from './dto/account-setup.dto';
import { AuthTokenType, AuthTokenChannel } from '@prisma/client';
import { Response, Request } from 'express';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditLogs: AuditLogsService,
  ) {}

  private get cookieName(): string {
    return this.configService.get<string>('auth.cookieName') || 'refresh_token';
  }

  private get refreshTokenDays(): number {
    return this.configService.get<number>('auth.refreshTokenExpiresInDays') || 14;
  }

  private buildCookieOptions(maxAge?: number) {
    const sameSite = (this.configService.get<string>('auth.cookieSameSite') || 'lax') as
      | 'lax'
      | 'strict'
      | 'none';
    return {
      httpOnly: true as const,
      secure: this.configService.get<boolean>('auth.cookieSecure') || false,
      sameSite,
      domain: this.configService.get<string>('auth.cookieDomain') || 'localhost',
      maxAge: maxAge ?? this.refreshTokenDays * 24 * 60 * 60 * 1000,
      path: '/',
    };
  }

  async login(dto: LoginDto, req: Request, res: Response) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone is required');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          dto.email ? { email: { equals: dto.email, mode: 'insensitive' as const } } : undefined,
          dto.phone ? { phone: dto.phone } : undefined,
        ].filter(Boolean),
        isActive: true,
      },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      await this.auditLogs.create({
        action: 'auth.login.failed',
        module: 'auth',
        metadata: { reason: 'user_not_found', identifier: dto.email || dto.phone },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        actorType: 'user',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await verifyPassword(user.passwordHash, dto.password);
    if (!passwordValid) {
      await this.auditLogs.create({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'auth.login.failed',
        module: 'auth',
        metadata: { reason: 'wrong_password' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        actorType: 'user',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const permissions = this.extractPermissions(user.roles);
    const { accessToken, session } = await this.createSession(user, permissions, req);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.auditLogs.create({
      schoolId: user.schoolId,
      userId: user.id,
      action: 'auth.login',
      module: 'auth',
      entityType: 'user_session',
      entityId: session.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      actorType: 'user',
    });

    const rawRefreshToken = session['_rawToken'];
    res.cookie(this.cookieName, rawRefreshToken, this.buildCookieOptions());

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        mustChangePassword: user.mustChangePassword,
        schoolId: user.schoolId,
      },
    };
  }

  async refresh(req: Request, res: Response) {
    const rawToken = req.cookies?.[this.cookieName];
    if (!rawToken) throw new UnauthorizedException('Refresh token not found');

    const tokenHash = hashToken(rawToken);
    const session = await this.prisma.userSession.findFirst({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    permissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session || session.expiresAt < new Date()) {
      res.clearCookie(this.cookieName, this.buildCookieOptions(0));
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    // Revoke old session (rotation)
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        revokedReason: 'rotated',
      },
    });

    const permissions = this.extractPermissions(session.user.roles);
    const { accessToken, session: newSession } = await this.createSession(
      session.user,
      permissions,
      req,
      session.id,
    );

    const rawRefreshToken = newSession['_rawToken'];
    res.cookie(this.cookieName, rawRefreshToken, this.buildCookieOptions());

    return { accessToken };
  }

  async logout(userId: string, sessionId: string, req: Request, res: Response) {
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });

    res.clearCookie(this.cookieName, this.buildCookieOptions(0));

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    await this.auditLogs.create({
      schoolId: user?.schoolId,
      userId,
      action: 'auth.logout',
      module: 'auth',
      entityType: 'user_session',
      entityId: sessionId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      actorType: 'user',
    });

    return { message: 'Logged out successfully' };
  }

  async changePassword(
    userId: string,
    sessionId: string,
    dto: ChangePasswordDto,
    req: Request,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const passwordValid = await verifyPassword(user.passwordHash, dto.currentPassword);
    if (!passwordValid) throw new UnauthorizedException('Current password is incorrect');

    const newHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
        },
      }),
      // Revoke all sessions except the current one
      this.prisma.userSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          NOT: { id: sessionId },
        },
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
      }),
    ]);

    await this.auditLogs.create({
      schoolId: user.schoolId,
      userId,
      action: 'auth.password_changed',
      module: 'auth',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      actorType: 'user',
    });

    return { message: 'Password changed successfully' };
  }

  async requestPasswordReset(dto: PasswordResetRequestDto, req: Request) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone is required');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          dto.email ? { email: { equals: dto.email, mode: 'insensitive' as const } } : undefined,
          dto.phone ? { phone: dto.phone } : undefined,
        ].filter(Boolean),
      },
    });

    if (!user) {
      // Return success anyway to avoid user enumeration
      return { message: 'If the account exists, a reset token has been sent' };
    }

    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.authToken.create({
      data: {
        schoolId: user.schoolId,
        userId: user.id,
        type: AuthTokenType.password_reset,
        channel: AuthTokenChannel.email,
        email: dto.email || user.email,
        phone: dto.phone || user.phone,
        tokenHash,
        expiresAt,
      },
    });

    await this.auditLogs.create({
      schoolId: user.schoolId,
      userId: user.id,
      action: 'auth.password_reset_requested',
      module: 'auth',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      actorType: 'user',
    });

    // TODO: Phase 2 — send reset token via email/SMS
    return { message: 'If the account exists, a reset token has been sent', _devToken: rawToken };
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto, req: Request) {
    const tokenHash = hashToken(dto.token);

    const authToken = await this.prisma.authToken.findFirst({
      where: {
        tokenHash,
        type: AuthTokenType.password_reset,
        usedAt: null,
        revokedAt: null,
      },
    });

    if (!authToken || authToken.expiresAt < new Date()) {
      throw new BadRequestException('Token is invalid or expired');
    }

    const newHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.authToken.update({
        where: { id: authToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: authToken.userId },
        data: {
          passwordHash: newHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
        },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: authToken.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_reset' },
      }),
    ]);

    await this.auditLogs.create({
      schoolId: authToken.schoolId,
      userId: authToken.userId,
      action: 'auth.password_reset_confirmed',
      module: 'auth',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      actorType: 'user',
    });

    return { message: 'Password reset successfully' };
  }

  async confirmAccountSetup(dto: AccountSetupConfirmDto, req: Request) {
    const tokenHash = hashToken(dto.token);

    const authToken = await this.prisma.authToken.findFirst({
      where: {
        tokenHash,
        type: AuthTokenType.account_setup,
        usedAt: null,
        revokedAt: null,
      },
    });

    if (!authToken || authToken.expiresAt < new Date()) {
      throw new BadRequestException('Setup token is invalid or expired');
    }

    const newHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.authToken.update({
        where: { id: authToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: authToken.userId },
        data: {
          passwordHash: newHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          isActive: true,
        },
      }),
    ]);

    await this.auditLogs.create({
      schoolId: authToken.schoolId,
      userId: authToken.userId,
      action: 'auth.account_setup_completed',
      module: 'auth',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      actorType: 'user',
    });

    return { message: 'Account setup completed' };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      schoolId: user.schoolId,
      mustChangePassword: user.mustChangePassword,
      linkedEntityType: user.linkedEntityType,
      linkedEntityId: user.linkedEntityId,
      roles: user.roles.map((ur) => ({
        id: ur.role.id,
        code: ur.role.code,
        name: ur.role.name,
      })),
      permissions: this.extractPermissions(user.roles),
    };
  }

  private extractPermissions(roles: any[]): string[] {
    const perms = new Set<string>();
    for (const ur of roles) {
      for (const rp of ur.role.permissions) {
        perms.add(rp.permission.key);
      }
    }
    return Array.from(perms);
  }

  private async createSession(
    user: any,
    permissions: string[],
    req: Request,
    replacedSessionId?: string,
  ) {
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + this.refreshTokenDays * 24 * 60 * 60 * 1000);

    const session = await this.prisma.userSession.create({
      data: {
        schoolId: user.schoolId,
        userId: user.id,
        refreshTokenHash: tokenHash,
        userAgent: req.headers['user-agent'] || null,
        ipAddress: req.ip || null,
        expiresAt,
        lastUsedAt: new Date(),
      },
    });

    if (replacedSessionId) {
      await this.prisma.userSession.update({
        where: { id: replacedSessionId },
        data: { replacedBySessionId: session.id },
      });
    }

    const payload = {
      sub: user.id,
      schoolId: user.schoolId,
      sessionId: session.id,
      permissions,
    };

    const accessToken = this.jwtService.sign(payload);

    return { accessToken, session: { ...session, _rawToken: rawToken } };
  }
}
