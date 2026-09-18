import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DeliveryStatus,
  OutboundSms,
  SendOutcome,
  SmsGateway,
} from './sms-gateway.interface';

/**
 * The sandbox gateway. Logs what it WOULD have sent and returns a synthetic
 * provider id. Sends nothing, costs nothing, needs no account.
 *
 * This is not a stub for convenience. It means stakeholder testing exercises
 * the entire path — consent gate, normalisation, segment counting, the outbox,
 * the poller, retry, the log view — without spending money or waiting on a
 * vendor contract and an NCA sender-ID registration. That is the difference
 * between this feature being testable now and not.
 *
 * WHEN A REAL GATEWAY IS CHOSEN, this file is the only thing that changes
 * shape: a new adapter implements the same interface and the module binds that
 * one to SMS_GATEWAY instead. Nothing in the service, the poller, the triggers
 * or the frontend knows the difference.
 *
 * It fails deliberately on two magic numbers so the failure paths are
 * reachable in a demo and in QA without a vendor outage:
 *   +233000000000  → terminal failure (as an invalid MSISDN would)
 *   +233000000001  → retryable failure (as a gateway timeout would)
 */
export const SANDBOX_TERMINAL_FAILURE_NUMBER = '+233000000000';
export const SANDBOX_RETRYABLE_FAILURE_NUMBER = '+233000000001';

@Injectable()
export class LoggingSmsGateway implements SmsGateway {
  readonly code = 'sandbox';

  private readonly logger = new Logger('SMS/sandbox');

  async send(messages: OutboundSms[]): Promise<SendOutcome[]> {
    return messages.map((message) => {
      if (message.to === SANDBOX_TERMINAL_FAILURE_NUMBER) {
        this.logger.warn(`[terminal] ${message.to} — simulated invalid recipient`);
        return {
          id: message.id,
          status: 'terminal_failure' as const,
          error: 'Invalid recipient (sandbox simulation)',
        };
      }

      if (message.to === SANDBOX_RETRYABLE_FAILURE_NUMBER) {
        this.logger.warn(`[retryable] ${message.to} — simulated gateway timeout`);
        return {
          id: message.id,
          status: 'retryable_failure' as const,
          error: 'Gateway timeout (sandbox simulation)',
        };
      }

      // The body is logged in full on purpose: in the sandbox this log IS the
      // delivery, and a stakeholder checking the feature needs to read what a
      // parent would have read.
      this.logger.log(`→ ${message.to}: ${message.body}`);
      return {
        id: message.id,
        status: 'accepted' as const,
        providerMessageId: `sandbox-${randomUUID()}`,
      };
    });
  }

  /**
   * Deliberately NOT implemented as a real capability.
   *
   * The sandbox cannot know whether a handset received anything, so claiming
   * `delivered` would be inventing a fact. Rows stay at `sent`, which is the
   * honest state and exactly what a gateway that reports only acceptance
   * produces. Declared here so the optional-method contract is visibly
   * exercised.
   */
  async fetchStatus(providerMessageIds: string[]): Promise<DeliveryStatus[]> {
    return providerMessageIds.map((providerMessageId) => ({
      providerMessageId,
      status: 'unknown' as const,
    }));
  }
}
