import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SMS_GATEWAY,
  SmsGateway,
  OutboundSms,
  SendOutcome,
} from './gateways/sms-gateway.interface';

/**
 * How many messages one tick claims. Small enough that a tick stays short and
 * a crash loses little work; large enough that a 300-message reminder round
 * clears in about a minute at the interval below.
 */
export const CLAIM_BATCH_SIZE = 50;

/** The poll interval. Nothing here is latency-critical; a receipt arriving 15s later is fine. */
export const POLL_INTERVAL_MS = 15_000;

/**
 * Maximum THREE attempts, then `failed` permanently.
 *
 * Three, not more: each attempt is a paid message on some gateways, and a
 * failure that survives three attempts spread over ~15 minutes is almost
 * always a bad number or a gateway problem that more attempts will not fix.
 * Unbounded retry on a cost-bearing side effect is how a bug becomes a bill.
 */
export const MAX_ATTEMPTS = 3;

/**
 * Backoff before attempts 2 and 3: 1 minute, then 5.
 *
 * Exponential in shape but deliberately SHORT, because the thing being
 * retried is usually a transient gateway blip and the message has a useful
 * life measured in minutes — an absence alert that arrives at 4pm has missed
 * its purpose. The upper bound (~6 minutes to exhaust all three attempts)
 * is chosen so a bursar watching the log sees a final answer while they are
 * still at their desk.
 */
export const BACKOFF_MS = [60_000, 300_000];

/**
 * The outbox poller.
 *
 * Claims rows with `SELECT … FOR UPDATE SKIP LOCKED`, which is what makes this
 * correct if a second instance is ever run: two pollers cannot claim the same
 * row, so nobody is charged twice for one message. That costs one SQL clause
 * today and avoids a silent double-send later.
 *
 * It rests on one assumption, stated so it can be checked: the API is a
 * LONG-LIVED PROCESS. The deployment guide confirms that (PM2 / Docker /
 * systemd running `node dist/main`). On a serverless host this design would be
 * wrong and the outbox would need an external trigger.
 */
@Injectable()
export class NotificationsDispatcher {
  private readonly logger = new Logger(NotificationsDispatcher.name);

  /** Guards against a slow tick overlapping the next one in this process. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGateway,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drainOnce();
    } catch (err) {
      // A poller that dies takes the whole outbox with it silently.
      this.logger.error(`Dispatch tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * One claim-and-send cycle. Exposed (rather than private) so tests can drive
   * it deterministically instead of waiting on a timer.
   */
  async drainOnce(): Promise<{ claimed: number; sent: number; failed: number; retrying: number }> {
    const claimed = await this.claim();
    if (!claimed.length) return { claimed: 0, sent: 0, failed: 0, retrying: 0 };

    const outbound: OutboundSms[] = claimed.map((m) => ({
      id: m.id,
      to: m.toPhone,
      body: m.body,
    }));

    let outcomes: SendOutcome[];
    try {
      outcomes = await this.gateway.send(outbound);
    } catch (err) {
      // The gateway threw rather than returning outcomes — treat the whole
      // batch as retryable, because we cannot tell what it did or did not
      // accept. Assuming failure is the safe side: worst case a parent gets
      // one message twice, versus a payment receipt nobody ever sends.
      await this.recordBatchRetryable(claimed, (err as Error).message);
      return { claimed: claimed.length, sent: 0, failed: 0, retrying: claimed.length };
    }

    const byId = new Map(outcomes.map((o) => [o.id, o]));
    let sent = 0;
    let failed = 0;
    let retrying = 0;

    for (const message of claimed) {
      const outcome = byId.get(message.id);

      if (!outcome) {
        // The gateway did not report on this one. Same reasoning as above.
        await this.markRetryable(message, 'Gateway returned no result for this message');
        retrying += 1;
        continue;
      }

      if (outcome.status === 'accepted') {
        await this.prisma.notificationMessage.update({
          where: { id: message.id },
          data: {
            status: NotificationStatus.sent,
            sentAt: new Date(),
            providerCode: this.gateway.code,
            providerMessageId: outcome.providerMessageId ?? null,
            lastError: null,
            nextAttemptAt: null,
          },
        });
        sent += 1;
        continue;
      }

      if (outcome.status === 'terminal_failure') {
        // NOT retried. The ADAPTER decided this is terminal — retrying an
        // invalid MSISDN three times buys three failures at full price.
        await this.prisma.notificationMessage.update({
          where: { id: message.id },
          data: {
            status: NotificationStatus.failed,
            failedAt: new Date(),
            providerCode: this.gateway.code,
            lastError: outcome.error.slice(0, 255),
            nextAttemptAt: null,
          },
        });
        failed += 1;
        continue;
      }

      const result = await this.markRetryable(message, outcome.error);
      if (result === 'failed') failed += 1;
      else retrying += 1;
    }

    return { claimed: claimed.length, sent, failed, retrying };
  }

  /**
   * Claim due rows and flip them to `sending` in ONE transaction.
   *
   * `FOR UPDATE SKIP LOCKED` is the whole mechanism: a concurrent poller skips
   * rows this one holds rather than blocking on them or, worse, reading them
   * and sending the same message again.
   */
  private async claim() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM notification_messages
        WHERE status = 'queued'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY queued_at ASC
        LIMIT ${CLAIM_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;
      if (!rows.length) return [];

      const ids = rows.map((r) => r.id);
      await tx.notificationMessage.updateMany({
        where: { id: { in: ids } },
        data: { status: NotificationStatus.sending, attemptCount: { increment: 1 } },
      });

      return tx.notificationMessage.findMany({ where: { id: { in: ids } } });
    });
  }

  /**
   * A retryable failure: back to `queued` with a backoff, or `failed` once the
   * attempt budget is spent.
   */
  private async markRetryable(
    message: { id: string; attemptCount: number },
    error: string,
  ): Promise<'retrying' | 'failed'> {
    // `claim()` already incremented attemptCount, so this IS the number of
    // attempts spent — adding one more would burn the budget a whole attempt
    // early and skip the first backoff entirely.
    const attemptsUsed = message.attemptCount;

    if (attemptsUsed >= MAX_ATTEMPTS) {
      await this.prisma.notificationMessage.update({
        where: { id: message.id },
        data: {
          status: NotificationStatus.failed,
          failedAt: new Date(),
          providerCode: this.gateway.code,
          lastError: `${error} (gave up after ${attemptsUsed} attempts)`.slice(0, 255),
          nextAttemptAt: null,
        },
      });
      return 'failed';
    }

    const backoff = BACKOFF_MS[Math.min(attemptsUsed - 1, BACKOFF_MS.length - 1)];
    await this.prisma.notificationMessage.update({
      where: { id: message.id },
      data: {
        status: NotificationStatus.queued,
        providerCode: this.gateway.code,
        lastError: error.slice(0, 255),
        nextAttemptAt: new Date(Date.now() + backoff),
      },
    });
    return 'retrying';
  }

  private async recordBatchRetryable(
    messages: { id: string; attemptCount: number }[],
    error: string,
  ) {
    for (const message of messages) {
      await this.markRetryable(message, error);
    }
  }
}
