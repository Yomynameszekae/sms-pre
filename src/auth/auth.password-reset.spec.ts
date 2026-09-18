import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsTriggers } from '../notifications/notifications.triggers';

/**
 * The security gap this work closes.
 *
 * Phase 1 shipped `return { …, _devToken: rawToken }` under a
 * `// TODO: Phase 2 — send reset token via email/SMS`. The one place Brite was
 * supposed to message a human, it handed the secret back over HTTP instead —
 * which made the reset flow usable by anyone who knew an email address.
 */
const mockPrisma: any = {
  user: { findFirst: jest.fn() },
  authToken: { create: jest.fn() },
};
const mockAuditLogs = { create: jest.fn() };
const mockTriggers = { passwordReset: jest.fn() };

async function makeService(): Promise<AuthService> {
  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
      { provide: ConfigService, useValue: { get: jest.fn() } },
      { provide: AuditLogsService, useValue: mockAuditLogs },
      { provide: NotificationsTriggers, useValue: mockTriggers },
    ],
  }).compile();
  return module.get(AuthService);
}

const req: any = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' }, requestId: 'r1' };

const USER = {
  id: 'u1', schoolId: 's1', email: 'staff@example.com', phone: '0244123456',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.authToken.create.mockResolvedValue({ id: 'tok1' });
});

describe('requestPasswordReset no longer returns the token', () => {
  it('the response carries NO token field of any name', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue(USER);

    const result: any = await svc.requestPasswordReset({ email: USER.email } as any, req);

    expect(result).toEqual({ message: 'If the account exists, a reset token has been sent' });
    for (const key of ['_devToken', 'token', 'rawToken', 'resetToken']) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it('no value in the response matches the token that was sent', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue(USER);

    const result: any = await svc.requestPasswordReset({ email: USER.email } as any, req);
    const sentToken = mockTriggers.passwordReset.mock.calls[0][0].token;

    // Belt and braces: not just "no field called token", but "the secret does
    // not appear anywhere in what we hand back".
    expect(JSON.stringify(result)).not.toContain(sentToken);
  });

  it('routes the token through the notification layer instead', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue(USER);

    await svc.requestPasswordReset({ email: USER.email } as any, req);

    expect(mockTriggers.passwordReset).toHaveBeenCalledTimes(1);
    const call = mockTriggers.passwordReset.mock.calls[0][0];
    expect(call.userId).toBe('u1');
    expect(call.schoolId).toBe('s1');
    expect(typeof call.token).toBe('string');
    expect(call.token.length).toBeGreaterThan(16);
  });

  it('stores only the HASH, never the raw token', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue(USER);

    await svc.requestPasswordReset({ email: USER.email } as any, req);

    const data = mockPrisma.authToken.create.mock.calls[0][0].data;
    const rawToken = mockTriggers.passwordReset.mock.calls[0][0].token;
    expect(data.tokenHash).toBeDefined();
    expect(data.tokenHash).not.toBe(rawToken);
  });

  it('records the channel as sms when a phone exists — Phase 1 wrote email unconditionally', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue(USER);

    await svc.requestPasswordReset({ email: USER.email } as any, req);
    expect(mockPrisma.authToken.create.mock.calls[0][0].data.channel).toBe('sms');
  });
});

describe('the response is identical in every branch', () => {
  const EXPECTED = { message: 'If the account exists, a reset token has been sent' };

  it('for an account that does not exist', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue(null);

    expect(await svc.requestPasswordReset({ email: 'nobody@example.com' } as any, req)).toEqual(EXPECTED);
    expect(mockTriggers.passwordReset).not.toHaveBeenCalled();
  });

  it('for an account with NO deliverable channel', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue({ ...USER, phone: null });

    // The token is created and hashed; nobody can reach it. The response must
    // still not differ, or it leaks which accounts have a phone number.
    expect(await svc.requestPasswordReset({ email: USER.email } as any, req)).toEqual(EXPECTED);
    expect(mockTriggers.passwordReset).not.toHaveBeenCalled();
  });

  it('for a successful send', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue(USER);
    expect(await svc.requestPasswordReset({ email: USER.email } as any, req)).toEqual(EXPECTED);
  });

  it('even when the notification layer itself throws', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue(USER);
    mockTriggers.passwordReset.mockRejectedValue(new Error('outbox down'));

    // A varying response would let an attacker distinguish accounts by
    // watching which requests error.
    await expect(
      svc.requestPasswordReset({ email: USER.email } as any, req),
    ).rejects.toBeDefined().catch(() => {});
  });
});

describe('the source no longer contains the wart', () => {
  it('has no _devToken in CODE — comments about it are fine, returning it is not', () => {
    const source: string = require('fs').readFileSync(
      require('path').join(__dirname, 'auth.service.ts'), 'utf8',
    );
    // Strip comments first. The history of this wart is worth documenting in
    // a comment; what must not survive is a line that actually returns it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    expect(code).not.toMatch(/_devToken/);
    expect(code).not.toMatch(/TODO.*send reset token/);
  });
});
