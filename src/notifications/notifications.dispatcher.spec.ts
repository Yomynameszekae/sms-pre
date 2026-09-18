import { Test } from '@nestjs/testing';
import { NotificationStatus } from '@prisma/client';
import {
  NotificationsDispatcher, MAX_ATTEMPTS, BACKOFF_MS, CLAIM_BATCH_SIZE,
} from './notifications.dispatcher';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_GATEWAY, SmsGateway } from './gateways/sms-gateway.interface';

const mockPrisma: any = {
  notificationMessage: { updateMany: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
};

const gateway: jest.Mocked<SmsGateway> = {
  code: 'test',
  send: jest.fn(),
} as any;

async function makeDispatcher(): Promise<NotificationsDispatcher> {
  const module = await Test.createTestingModule({
    providers: [
      NotificationsDispatcher,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: SMS_GATEWAY, useValue: gateway },
    ],
  }).compile();
  return module.get(NotificationsDispatcher);
}

/** A row as the claim returns it — attemptCount already incremented. */
function claimed(id: string, attemptCount = 1) {
  return { id, toPhone: '+233244123456', body: 'hello', attemptCount };
}

function arrangeClaim(rows: any[]) {
  mockPrisma.$queryRaw.mockResolvedValue(rows.map((r) => ({ id: r.id })));
  mockPrisma.notificationMessage.updateMany.mockResolvedValue({ count: rows.length });
  mockPrisma.notificationMessage.findMany.mockResolvedValue(rows);
  mockPrisma.notificationMessage.update.mockResolvedValue({});
}

const updateFor = (id: string) =>
  mockPrisma.notificationMessage.update.mock.calls.find((c: any) => c[0].where.id === id)?.[0].data;

beforeEach(() => jest.clearAllMocks());

describe('claiming', () => {
  it('uses FOR UPDATE SKIP LOCKED, so two pollers cannot claim the same row', async () => {
    const d = await makeDispatcher();
    arrangeClaim([]);
    await d.drainOnce();

    // Without SKIP LOCKED a second instance either blocks or — far worse —
    // sends the same message again, and the school pays twice.
    const sql = mockPrisma.$queryRaw.mock.calls[0][0].join('');
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/status = 'queued'/);
  });

  it('only claims rows whose backoff has elapsed', async () => {
    const d = await makeDispatcher();
    arrangeClaim([]);
    await d.drainOnce();
    expect(mockPrisma.$queryRaw.mock.calls[0][0].join('')).toMatch(/next_attempt_at <= now\(\)/);
  });

  it('flips claimed rows to `sending` and increments the attempt count', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1')]);
    gateway.send.mockResolvedValue([{ id: 'n1', status: 'accepted', providerMessageId: 'p1' }]);

    await d.drainOnce();

    expect(mockPrisma.notificationMessage.updateMany.mock.calls[0][0].data).toEqual({
      status: NotificationStatus.sending,
      attemptCount: { increment: 1 },
    });
  });

  it('does nothing and calls no gateway when the outbox is empty', async () => {
    const d = await makeDispatcher();
    arrangeClaim([]);
    expect(await d.drainOnce()).toEqual({ claimed: 0, sent: 0, failed: 0, retrying: 0 });
    expect(gateway.send).not.toHaveBeenCalled();
  });

  it('claims a bounded batch, so one tick stays short', async () => {
    const d = await makeDispatcher();
    arrangeClaim([]);
    await d.drainOnce();
    expect(mockPrisma.$queryRaw.mock.calls[0].flat()).toContain(CLAIM_BATCH_SIZE);
  });
});

describe('outcomes', () => {
  it('accepted → sent, with the provider id recorded', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1')]);
    gateway.send.mockResolvedValue([{ id: 'n1', status: 'accepted', providerMessageId: 'p1' }]);

    const result = await d.drainOnce();

    expect(result.sent).toBe(1);
    expect(updateFor('n1')).toMatchObject({
      status: NotificationStatus.sent,
      providerCode: 'test',
      providerMessageId: 'p1',
      nextAttemptAt: null,
    });
  });

  it('`sent` is NOT `delivered` — acceptance is not confirmation', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1')]);
    gateway.send.mockResolvedValue([{ id: 'n1', status: 'accepted' }]);

    await d.drainOnce();
    expect(updateFor('n1').status).toBe(NotificationStatus.sent);
    expect(updateFor('n1').deliveredAt).toBeUndefined();
  });

  it('a TERMINAL failure is never retried', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1')]);
    gateway.send.mockResolvedValue([
      { id: 'n1', status: 'terminal_failure', error: 'Invalid MSISDN' },
    ]);

    const result = await d.drainOnce();

    // Retrying an invalid number three times buys three failures at full price.
    expect(result.failed).toBe(1);
    expect(updateFor('n1')).toMatchObject({
      status: NotificationStatus.failed,
      nextAttemptAt: null,
    });
  });

  it('the ADAPTER decides terminal vs retryable — the poller never reads the message', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1'), claimed('n2')]);
    // Identical error text, opposite classifications. Only the adapter knows
    // its vendor's taxonomy.
    gateway.send.mockResolvedValue([
      { id: 'n1', status: 'terminal_failure', error: 'rejected' },
      { id: 'n2', status: 'retryable_failure', error: 'rejected' },
    ]);

    await d.drainOnce();

    expect(updateFor('n1').status).toBe(NotificationStatus.failed);
    expect(updateFor('n2').status).toBe(NotificationStatus.queued);
  });
});

describe('retry bounds and backoff', () => {
  it('a retryable failure goes back to queued with the first backoff', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1', 1)]);
    gateway.send.mockResolvedValue([{ id: 'n1', status: 'retryable_failure', error: 'timeout' }]);

    const before = Date.now();
    const result = await d.drainOnce();

    expect(result.retrying).toBe(1);
    const data = updateFor('n1');
    expect(data.status).toBe(NotificationStatus.queued);
    // The EXACT first backoff, not merely "at least" it — a loose bound here
    // hid an off-by-one that skipped the first backoff and spent the attempt
    // budget a whole attempt early.
    const delay = data.nextAttemptAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(BACKOFF_MS[0]);
    expect(delay).toBeLessThan(BACKOFF_MS[1]);
  });

  it('the second retry waits longer than the first', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1', 2)]);
    gateway.send.mockResolvedValue([{ id: 'n1', status: 'retryable_failure', error: 'timeout' }]);

    const before = Date.now();
    await d.drainOnce();
    const delay = updateFor('n1').nextAttemptAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(BACKOFF_MS[1]);
  });

  it(`gives up permanently at ${MAX_ATTEMPTS} attempts`, async () => {
    const d = await makeDispatcher();
    // The claim has already incremented, so attemptCount IS attempts spent.
    arrangeClaim([claimed('n1', MAX_ATTEMPTS)]);
    gateway.send.mockResolvedValue([{ id: 'n1', status: 'retryable_failure', error: 'timeout' }]);

    const result = await d.drainOnce();

    // Unbounded retry on a cost-bearing side effect is how a bug becomes a bill.
    expect(result.failed).toBe(1);
    expect(updateFor('n1')).toMatchObject({
      status: NotificationStatus.failed,
      nextAttemptAt: null,
    });
    expect(updateFor('n1').lastError).toContain(`gave up after ${MAX_ATTEMPTS} attempts`);
  });

  it('never schedules an attempt beyond the budget', async () => {
    const d = await makeDispatcher();
    for (let used = MAX_ATTEMPTS; used < MAX_ATTEMPTS + 3; used++) {
      jest.clearAllMocks();
      arrangeClaim([claimed('n1', used)]);
      gateway.send.mockResolvedValue([{ id: 'n1', status: 'retryable_failure', error: 'x' }]);
      await d.drainOnce();
      expect(updateFor('n1').status).toBe(NotificationStatus.failed);
    }
  });

  it(`uses all ${MAX_ATTEMPTS} attempts — two retries, then failure`, async () => {
    const d = await makeDispatcher();
    const statuses: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      jest.clearAllMocks();
      arrangeClaim([claimed('n1', attempt)]);
      gateway.send.mockResolvedValue([{ id: 'n1', status: 'retryable_failure', error: 'x' }]);
      await d.drainOnce();
      statuses.push(updateFor('n1').status);
    }
    expect(statuses).toEqual([
      NotificationStatus.queued,
      NotificationStatus.queued,
      NotificationStatus.failed,
    ]);
  });

  it('the backoff schedule is bounded and short by design', async () => {
    // ~6 minutes to exhaust all three attempts: an absence alert that arrives
    // at 4pm has missed its purpose, and a bursar should get a final answer
    // while still at their desk.
    const total = BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(BACKOFF_MS.length).toBe(MAX_ATTEMPTS - 1);
    expect(total).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe('when the gateway itself misbehaves', () => {
  it('a thrown gateway retries the whole batch rather than losing it', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1'), claimed('n2')]);
    gateway.send.mockRejectedValue(new Error('ECONNRESET'));

    const result = await d.drainOnce();

    // We cannot tell what it did or did not accept; assuming failure risks one
    // duplicate, assuming success risks a receipt nobody ever sends.
    expect(result.retrying).toBe(2);
    expect(updateFor('n1').status).toBe(NotificationStatus.queued);
  });

  it('a message the gateway did not report on is retried, not silently dropped', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1'), claimed('n2')]);
    gateway.send.mockResolvedValue([{ id: 'n1', status: 'accepted' }]);

    const result = await d.drainOnce();

    expect(result.sent).toBe(1);
    expect(result.retrying).toBe(1);
    expect(updateFor('n2').lastError).toMatch(/no result/i);
  });

  it('a partly-failing batch is handled per message', async () => {
    const d = await makeDispatcher();
    arrangeClaim([claimed('n1'), claimed('n2'), claimed('n3')]);
    gateway.send.mockResolvedValue([
      { id: 'n1', status: 'accepted' },
      { id: 'n2', status: 'terminal_failure', error: 'bad number' },
      { id: 'n3', status: 'retryable_failure', error: 'timeout' },
    ]);

    // A design that could not express partial success would lose messages.
    expect(await d.drainOnce()).toEqual({ claimed: 3, sent: 1, failed: 1, retrying: 1 });
  });

  it('a tick that throws does not kill the poller', async () => {
    const d = await makeDispatcher();
    mockPrisma.$transaction.mockRejectedValueOnce(new Error('db gone'));
    await expect(d.tick()).resolves.toBeUndefined();
  });

  it('overlapping ticks are skipped, not run concurrently', async () => {
    const d = await makeDispatcher();
    arrangeClaim([]);
    let release: () => void;
    mockPrisma.$transaction.mockImplementationOnce(
      () => new Promise((r) => { release = () => r([]); }),
    );

    const first = d.tick();
    await d.tick();                       // must return immediately
    release!();
    await first;

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
