import { Test } from '@nestjs/testing';
import { NotificationStatus, NotificationTrigger, Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * THE CONSENT GATE.
 *
 * "No guardian receives any message until they have actively said yes" is the
 * one rule in this module that must never have an exception, so these tests
 * are written adversarially: each one tries to get a message out for someone
 * who has not consented, by a different route.
 */
const mockPrisma: any = {
  notificationMessage: { create: jest.fn() },
  schoolSetting: { findFirst: jest.fn() },
  guardian: { findFirst: jest.fn() },
  studentGuardian: { findFirst: jest.fn() },
  user: { findFirst: jest.fn() },
  school: { findUnique: jest.fn() },
};
const mockAuditLogs = { create: jest.fn() };

async function makeService(): Promise<NotificationsService> {
  const module = await Test.createTestingModule({
    providers: [
      NotificationsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AuditLogsService, useValue: mockAuditLogs },
    ],
  }).compile();
  return module.get(NotificationsService);
}

const GUARDIAN = {
  id: 'g1', firstName: 'Akua', lastName: 'Mensah',
  phonePrimary: '0244123456', archivedAt: null, smsConsentGiven: true,
};

function request(over: Partial<any> = {}) {
  return {
    schoolId: 's1',
    trigger: NotificationTrigger.fee_reminder,
    values: { school: 'Adom', student: 'Ama', outstanding: '400.00', term: 'Term 3' },
    ...over,
  } as any;
}

/** Every row the service writes, in order. */
const written = () => mockPrisma.notificationMessage.create.mock.calls.map((c: any) => c[0].data);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.schoolSetting.findFirst.mockResolvedValue(null);
  mockPrisma.notificationMessage.create.mockImplementation((args: any) =>
    Promise.resolve({ id: 'n1', ...args.data }),
  );
});

// ── the gate, by every route in ──────────────────────────────────────────────

describe('no consent, no send — by every addressing route', () => {
  it('a GUARDIAN without consent is suppressed, not queued', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, smsConsentGiven: false });

    const result = await svc.enqueue(request({ guardianId: 'g1' }));

    expect(result.status).toBe('suppressed');
    expect(written()[0].status).toBe(NotificationStatus.suppressed);
    expect(written()[0].lastError).toBe('Guardian has not given SMS consent');
  });

  it('a STUDENT whose primary guardian has not consented is suppressed', async () => {
    const svc = await makeService();
    mockPrisma.studentGuardian.findFirst.mockResolvedValue({
      guardianId: 'g1', canReceiveSms: true,
      guardian: { ...GUARDIAN, smsConsentGiven: false },
    });

    const result = await svc.enqueue(request({ studentId: 'stu1' }));
    expect(result.status).toBe('suppressed');
  });

  it("a guardian's LOGIN without consent is suppressed", async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u1', phone: '0244123456', isActive: true,
      linkedEntityType: 'guardian', linkedEntityId: 'g1',
    });
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, smsConsentGiven: false });

    // Routing a message at a guardian's user account instead of their guardian
    // record must not be a way round the gate.
    const result = await svc.enqueue(request({ userId: 'u1', trigger: NotificationTrigger.announcement }));
    expect(result.status).toBe('suppressed');
  });

  it('consent TRUE but the link flag false is still suppressed — both are required', async () => {
    const svc = await makeService();
    mockPrisma.studentGuardian.findFirst.mockResolvedValue({
      guardianId: 'g1', canReceiveSms: false, guardian: GUARDIAN,
    });

    const result = await svc.enqueue(request({ studentId: 'stu1' }));
    expect(result.status).toBe('suppressed');
    expect(written()[0].lastError).toMatch(/not set to receive SMS for this student/);
  });

  it('an ARCHIVED guardian is suppressed even with consent on record', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, archivedAt: new Date() });

    expect((await svc.enqueue(request({ guardianId: 'g1' }))).status).toBe('suppressed');
  });

  it('a request naming NO recipient is suppressed, never silently dropped', async () => {
    const svc = await makeService();
    const result = await svc.enqueue(request());
    expect(result.status).toBe('suppressed');
    expect(written()[0].lastError).toBe('No recipient specified');
  });

  it('EVERY suppressed row has status suppressed and a blank phone — never queued', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, smsConsentGiven: false });
    mockPrisma.studentGuardian.findFirst.mockResolvedValue({
      guardianId: 'g1', canReceiveSms: true, guardian: { ...GUARDIAN, smsConsentGiven: false },
    });
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u1', phone: '0244123456', isActive: true,
      linkedEntityType: 'guardian', linkedEntityId: 'g1',
    });

    await svc.enqueue(request({ guardianId: 'g1' }));
    await svc.enqueue(request({ studentId: 'stu1' }));
    await svc.enqueue(request({ userId: 'u1' }));

    // The gate's output is always a recorded refusal with no destination —
    // a row that could not be sent even if the poller tried.
    for (const row of written()) {
      expect(row.status).toBe(NotificationStatus.suppressed);
      expect(row.toPhone).toBe('');
    }
  });

  it('a suppressed row is never given a nextAttemptAt, so the poller cannot pick it up', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, smsConsentGiven: false });

    await svc.enqueue(request({ guardianId: 'g1' }));
    expect(written()[0].nextAttemptAt).toBeUndefined();
  });
});

// ── the gate lets the right things through ───────────────────────────────────

describe('with consent, a message is queued', () => {
  it('queues for a consented guardian, with a normalised number', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    const result = await svc.enqueue(request({ guardianId: 'g1' }));

    expect(result.status).toBe('queued');
    expect(written()[0].status).toBe(NotificationStatus.queued);
    expect(written()[0].toPhone).toBe('+233244123456');
  });

  it('queues for a student when consent AND the link flag are both set', async () => {
    const svc = await makeService();
    mockPrisma.studentGuardian.findFirst.mockResolvedValue({
      guardianId: 'g1', canReceiveSms: true, guardian: GUARDIAN,
    });

    expect((await svc.enqueue(request({ studentId: 'stu1' }))).status).toBe('queued');
  });

  it('addresses the PRIMARY guardian only — one paid message, not several', async () => {
    const svc = await makeService();
    mockPrisma.studentGuardian.findFirst.mockResolvedValue({
      guardianId: 'g1', canReceiveSms: true, guardian: GUARDIAN,
    });

    await svc.enqueue(request({ studentId: 'stu1' }));
    expect(mockPrisma.studentGuardian.findFirst.mock.calls[0][0].where).toMatchObject({
      isPrimary: true,
    });
  });

  it('a STAFF login is not consent-gated — it is a security message to the account holder', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u1', phone: '0244123456', isActive: true,
      linkedEntityType: 'staff', linkedEntityId: 'st1',
    });

    const result = await svc.enqueue(
      request({ userId: 'u1', trigger: NotificationTrigger.password_reset }),
    );
    expect(result.status).toBe('queued');
    // Consent is a guardian concept; a staff member resetting their own
    // password has asked for the message by definition.
    expect(mockPrisma.guardian.findFirst).not.toHaveBeenCalled();
  });

  it('a DEACTIVATED user is suppressed even though staff are not consent-gated', async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u1', phone: '0244123456', isActive: false,
      linkedEntityType: 'staff', linkedEntityId: 'st1',
    });

    expect(
      (await svc.enqueue(request({ userId: 'u1', trigger: NotificationTrigger.password_reset })))
        .status,
    ).toBe('suppressed');
  });
});

// ── frozen at queue time ─────────────────────────────────────────────────────

describe('the row freezes what was actually sent', () => {
  it('stores the rendered body, not the template', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    await svc.enqueue(request({ guardianId: 'g1' }));

    expect(written()[0].body).toContain('400.00');
    expect(written()[0].body).not.toContain('{{');
  });

  it('computes and stores segmentCount at queue time', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    await svc.enqueue(request({ guardianId: 'g1' }));
    expect(written()[0].segmentCount).toBeGreaterThanOrEqual(1);
  });

  it('a school template from SchoolSetting overrides the default', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);
    mockPrisma.schoolSetting.findFirst.mockResolvedValue({
      valueJson: { value: 'Custom: {{student}} owes {{outstanding}}' },
    });

    await svc.enqueue(request({ guardianId: 'g1' }));
    expect(written()[0].body).toBe('Custom: Ama owes 400.00');
  });

  it('never emits "reply STOP" — nothing handles inbound SMS', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    for (const trigger of Object.values(NotificationTrigger)) {
      mockPrisma.notificationMessage.create.mockClear();
      await svc.enqueue(request({ guardianId: 'g1', trigger }));
      // Printing an instruction the system cannot honour is worse than
      // printing none: a parent who replies STOP and keeps receiving messages
      // has been actively misled.
      expect(written()[0].body.toUpperCase()).not.toContain('STOP');
    }
  });
});

// ── unusable numbers, and idempotency ────────────────────────────────────────

describe('an unusable number is a recorded refusal, not a failed send', () => {
  it('suppresses rather than asking the gateway to charge for it', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, phonePrimary: 'not a number' });

    const result = await svc.enqueue(request({ guardianId: 'g1' }));
    expect(result.status).toBe('suppressed');
    expect(written()[0].lastError).toContain('not a number');
  });
});

describe('idempotency', () => {
  it('a duplicate dedupeKey is reported, not raised', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);
    mockPrisma.notificationMessage.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002', clientVersion: '5.14.0', meta: { target: ['dedupe_key'] },
      }),
    );

    // A double-clicked "Send reminders" costs one duplicate-key error, not
    // 300 duplicate messages at full price.
    const result = await svc.enqueue(request({ guardianId: 'g1', dedupeKey: 'k' }));
    expect(result.status).toBe('duplicate');
  });

  it('rethrows anything that is not a duplicate', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);
    const boom = new Error('connection reset');
    mockPrisma.notificationMessage.create.mockRejectedValue(boom);

    await expect(svc.enqueue(request({ guardianId: 'g1', dedupeKey: 'k' }))).rejects.toBe(boom);
  });
});

// ── batch dispatch and the audit decision record ─────────────────────────────

describe('dispatchBatch writes ONE audit entry for the decision', () => {
  it('records who sent what to how many, with the suppression reasons', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.id === 'g1' ? GUARDIAN : { ...GUARDIAN, id: where.id, smsConsentGiven: false },
      ),
    );

    const result = await svc.dispatchBatch(
      [request({ guardianId: 'g1' }), request({ guardianId: 'g2' })],
      { schoolId: 's1', actorUserId: 'u1', trigger: NotificationTrigger.fee_reminder, description: 'Term 3 reminders' },
    );

    expect(result.queued).toBe(1);
    expect(result.suppressed).toBe(1);

    // One entry per DISPATCH, not one per message per attempt — audit_logs'
    // whole value is that it stays readable.
    expect(mockAuditLogs.create).toHaveBeenCalledTimes(1);
    const entry = mockAuditLogs.create.mock.calls[0][0];
    expect(entry.action).toBe('notifications.dispatched');
    expect(entry.metadata.queued).toBe(1);
    expect(entry.metadata.suppressedReasons).toContain('Guardian has not given SMS consent');
  });

  it('tags every message in the batch with one batchId', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    await svc.dispatchBatch(
      [request({ guardianId: 'g1' }), request({ guardianId: 'g1' })],
      { schoolId: 's1', actorUserId: 'u1', trigger: NotificationTrigger.fee_reminder, description: 'x' },
    );

    const ids = new Set(written().map((r: any) => r.batchId));
    expect(ids.size).toBe(1);
  });
});

// ── the gate has no bypass, structurally ─────────────────────────────────────

describe('the consent gate cannot be bypassed', () => {
  const read = (rel: string) =>
    require('fs').readFileSync(require('path').join(__dirname, rel), 'utf8');

  const sourceFiles = (): { path: string; code: string }[] => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const out: { path: string; code: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          out.push({ path: full, code: fs.readFileSync(full, 'utf8') });
        }
      }
    };
    walk(root);
    return out;
  };

  it('ONLY notifications.service.ts writes to the outbox', () => {
    // This is the invariant everything else rests on: if a trigger could
    // insert its own row, the consent check would be advisory rather than
    // structural. A new trigger that reaches for prisma.notificationMessage
    // directly fails here.
    const writers = sourceFiles()
      .filter(({ code }) => /notificationMessage\s*\.\s*(create|createMany|upsert)/.test(code))
      .map(({ path }) => path.split('/src/')[1]);

    expect(writers).toEqual(['notifications/notifications.service.ts']);
  });

  it('nothing outside the poller and the revoke path updates outbox status', () => {
    const updaters = sourceFiles()
      .filter(({ code }) => /notificationMessage\s*\.\s*(update|updateMany)/.test(code))
      .map(({ path }) => path.split('/src/')[1])
      .sort();

    expect(updaters).toEqual([
      // Withdrawal cancels anything still in flight.
      'guardians/guardians.service.ts',
      // The poller moves rows through sending → sent/failed/queued.
      'notifications/notifications.dispatcher.ts',
    ]);
  });

  it('the poller only ever claims rows that are already `queued`', () => {
    // The one thing that stops a suppressed row being picked up: a suppressed
    // row is never `queued`, so the claim cannot see it.
    const dispatcher = read('./notifications.dispatcher.ts');
    const claimSql = dispatcher.slice(dispatcher.indexOf('SELECT id FROM notification_messages'));
    expect(claimSql).toMatch(/WHERE status = 'queued'/);
  });

  it('every recipient route in resolveRecipient consults consent', () => {
    const service = read('./notifications.service.ts');
    const resolve = service.slice(
      service.indexOf('private async resolveRecipient'),
      service.indexOf('async enqueue('),
    );

    // Three guardian-bearing routes — direct, via student, via a guardian's
    // login — and each one must check the flag.
    const consentChecks = resolve.match(/smsConsentGiven/g) ?? [];
    expect(consentChecks.length).toBeGreaterThanOrEqual(3);

    // And the fall-through refuses rather than returning a recipient.
    expect(resolve).toMatch(/return \{ suppressed: 'No recipient specified' \}/);
  });

  it('enqueue writes a queued row only after resolveRecipient succeeds', () => {
    const service = read('./notifications.service.ts');
    const enqueue = service.slice(
      service.indexOf('async enqueue('),
      service.indexOf('private async writeSuppressed'),
    );

    // Order matters: resolve, then bail on suppression, then create.
    const resolveAt = enqueue.indexOf('resolveRecipient(request)');
    const bailAt = enqueue.indexOf("'suppressed' in resolved");
    const createAt = enqueue.indexOf('notificationMessage.create');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(bailAt).toBeGreaterThan(resolveAt);
    expect(createAt).toBeGreaterThan(bailAt);
  });
});

// ── a refusal must still say WHO it was refused for ─────────────────────────
//
// Resolution can fail after the guardian has been identified — "has not given
// SMS consent" names a specific person. Dropping them leaves a row saying a
// message was refused without saying for whom, which makes the notification
// log unable to answer the one question it exists for: why did THIS parent
// not get their message.
//
// The row is addressed by studentId for fee and attendance triggers, so
// guardian_id is the ONLY place the guardian appears. Nothing recovers it
// later.
describe('a suppressed row records the guardian it was suppressed for', () => {
  it('consent withheld, reached through a student', async () => {
    const svc = await makeService();
    mockPrisma.studentGuardian.findFirst.mockResolvedValue({
      guardianId: 'g1', canReceiveSms: true,
      guardian: { ...GUARDIAN, smsConsentGiven: false },
    });

    await svc.enqueue(request({ studentId: 'stu1' }));

    const [row] = written();
    expect(row.status).toBe(NotificationStatus.suppressed);
    expect(row.lastError).toBe('Guardian has not given SMS consent');
    expect(row.guardianId).toBe('g1');
    expect(row.studentId).toBe('stu1');
  });

  it('the per-student link is switched off', async () => {
    const svc = await makeService();
    mockPrisma.studentGuardian.findFirst.mockResolvedValue({
      guardianId: 'g1', canReceiveSms: false, guardian: GUARDIAN,
    });

    await svc.enqueue(request({ studentId: 'stu1' }));

    const [row] = written();
    expect(row.lastError).toBe('Guardian is not set to receive SMS for this student');
    expect(row.guardianId).toBe('g1');
  });

  it('the guardian record is archived', async () => {
    const svc = await makeService();
    mockPrisma.studentGuardian.findFirst.mockResolvedValue({
      guardianId: 'g1', canReceiveSms: true,
      guardian: { ...GUARDIAN, archivedAt: new Date() },
    });

    await svc.enqueue(request({ studentId: 'stu1' }));

    const [row] = written();
    expect(row.lastError).toBe('Guardian record is archived');
    expect(row.guardianId).toBe('g1');
  });

  it('consent withheld, addressed to the guardian directly', async () => {
    const svc = await makeService();
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, smsConsentGiven: false });

    await svc.enqueue(request({ guardianId: 'g1' }));

    const [row] = written();
    expect(row.guardianId).toBe('g1');
  });

  it("consent withheld, reached through a guardian's own login", async () => {
    const svc = await makeService();
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u1', phone: '0244000000', isActive: true,
      linkedEntityType: 'guardian', linkedEntityId: 'g1',
    });
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, smsConsentGiven: false });

    await svc.enqueue(request({ userId: 'u1', trigger: NotificationTrigger.password_reset }));

    const [row] = written();
    expect(row.guardianId).toBe('g1');
    expect(row.userId).toBe('u1');
  });

  it('but NOT when there was no guardian to identify', async () => {
    // "Student has no primary guardian" names nobody, so guardian_id stays
    // null. Inventing one here would be worse than leaving it empty.
    const svc = await makeService();
    mockPrisma.studentGuardian.findFirst.mockResolvedValue(null);

    await svc.enqueue(request({ studentId: 'stu1' }));

    const [row] = written();
    expect(row.lastError).toBe('Student has no primary guardian');
    expect(row.guardianId).toBeNull();
    expect(row.studentId).toBe('stu1');
  });
});
