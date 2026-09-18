import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsTriggers } from '../notifications/notifications.triggers';
import * as hashUtil from '../common/utils/hash.util';
import * as tokenUtil from '../common/utils/token.util';

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  userSession: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  authToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-access-token'),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, any> = {
      'auth.cookieName': 'refresh_token',
      'auth.refreshTokenExpiresInDays': 14,
      'auth.cookieSecure': false,
      'auth.cookieSameSite': 'lax',
      'auth.cookieDomain': 'localhost',
    };
    return config[key];
  }),
};

const mockAuditLogs = { create: jest.fn() };

const mockReq: any = {
  ip: '127.0.0.1',
  headers: { 'user-agent': 'jest' },
  cookies: {},
};

const mockRes: any = {
  cookie: jest.fn(),
  clearCookie: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuditLogsService, useValue: mockAuditLogs },
        // AuthService now delivers the password-reset token through the
        // notification layer instead of returning it over HTTP.
        { provide: NotificationsTriggers, useValue: { passwordReset: jest.fn() } },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('throws BadRequestException when neither email nor phone provided', async () => {
      await expect(service.login({ password: 'pass' }, mockReq, mockRes)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.login({ email: 'x@x.com', password: 'pass' }, mockReq, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        schoolId: 's1',
        passwordHash: 'hash',
        isActive: true,
        roles: [],
      });
      jest.spyOn(hashUtil, 'verifyPassword').mockResolvedValue(false);
      await expect(
        service.login({ email: 'x@x.com', password: 'wrong' }, mockReq, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns access token and sets cookie on success', async () => {
      const mockUser = {
        id: 'u1',
        schoolId: 's1',
        email: 'a@a.com',
        phone: null,
        passwordHash: 'hash',
        isActive: true,
        mustChangePassword: false,
        roles: [],
      };
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      jest.spyOn(hashUtil, 'verifyPassword').mockResolvedValue(true);
      jest.spyOn(tokenUtil, 'generateSecureToken').mockReturnValue('raw-token');
      jest.spyOn(hashUtil, 'hashToken').mockReturnValue('hashed-token');
      mockPrisma.userSession.create.mockResolvedValue({
        id: 'sess1',
        schoolId: 's1',
        userId: 'u1',
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.update.mockResolvedValue(mockUser);

      const result = await service.login({ email: 'a@a.com', password: 'pass' }, mockReq, mockRes);

      expect(result.accessToken).toBe('mock-access-token');
      expect(mockRes.cookie).toHaveBeenCalledWith('refresh_token', 'raw-token', expect.any(Object));
      expect(mockAuditLogs.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login' }));
    });
  });

  describe('logout', () => {
    it('revokes session and clears cookie', async () => {
      mockPrisma.userSession.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({ schoolId: 's1' });

      const result = await service.logout('u1', 'sess1', mockReq, mockRes);

      expect(mockPrisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: { revokedAt: expect.any(Date), revokedReason: 'logout' },
      });
      expect(mockRes.clearCookie).toHaveBeenCalled();
      expect(result.message).toContain('Logged out');
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException when no cookie', async () => {
      await expect(service.refresh({ ...mockReq, cookies: {} }, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when session not found', async () => {
      mockPrisma.userSession.findFirst.mockResolvedValue(null);
      jest.spyOn(hashUtil, 'hashToken').mockReturnValue('hashed');
      const req = { ...mockReq, cookies: { refresh_token: 'raw' } };
      await expect(service.refresh(req, mockRes)).rejects.toThrow(UnauthorizedException);
    });

    it('revokes old session and creates new one on success', async () => {
      const mockSession = {
        id: 'sess1',
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: 'u1',
          schoolId: 's1',
          isActive: true,
          email: 'a@a.com',
          roles: [],
        },
      };
      jest.spyOn(hashUtil, 'hashToken').mockReturnValue('hashed');
      jest.spyOn(tokenUtil, 'generateSecureToken').mockReturnValue('new-raw-token');
      mockPrisma.userSession.findFirst.mockResolvedValue(mockSession);
      mockPrisma.userSession.update.mockResolvedValue({});
      mockPrisma.userSession.create.mockResolvedValue({
        id: 'sess2',
        schoolId: 's1',
        userId: 'u1',
        expiresAt: new Date(Date.now() + 86400000),
      });

      const req = { ...mockReq, cookies: { refresh_token: 'old-raw' } };
      const result = await service.refresh(req, mockRes);

      expect(mockPrisma.userSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ revokedReason: 'rotated' }) }),
      );
      expect(result.accessToken).toBe('mock-access-token');
      expect(mockRes.cookie).toHaveBeenCalledWith('refresh_token', 'new-raw-token', expect.any(Object));
    });
  });

  describe('changePassword', () => {
    it('throws UnauthorizedException for wrong current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'old-hash' });
      jest.spyOn(hashUtil, 'verifyPassword').mockResolvedValue(false);
      await expect(
        service.changePassword('u1', 'sess1', { currentPassword: 'wrong', newPassword: 'new123' }, mockReq),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('updates password and revokes other sessions on success', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', schoolId: 's1', passwordHash: 'old-hash' });
      jest.spyOn(hashUtil, 'verifyPassword').mockResolvedValue(true);
      jest.spyOn(hashUtil, 'hashPassword').mockResolvedValue('new-hash');
      mockPrisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.changePassword(
        'u1',
        'sess1',
        { currentPassword: 'correct', newPassword: 'new-secure-pass' },
        mockReq,
      );

      expect(result.message).toContain('changed');
    });
  });
});
