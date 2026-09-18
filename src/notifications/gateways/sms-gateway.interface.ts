/**
 * The interface BRITE owns. A vendor implements it; nothing outside this
 * folder knows which vendor.
 *
 * Three properties matter more than the shape:
 *
 * 1. `send` returns a PER-MESSAGE result, not a boolean. A batch of 300 partly
 *    succeeds, and a design that cannot express that loses messages silently.
 *
 * 2. The ADAPTER classifies failures as retryable or terminal. "Gateway
 *    timeout" is retryable; "invalid MSISDN" is not, and retrying it three
 *    times buys three failures at full price. Only the adapter knows its
 *    vendor's error taxonomy, so the classification belongs there and nowhere
 *    else — the poller must never pattern-match on error strings.
 *
 * 3. `fetchStatus` is OPTIONAL. Some gateways push delivery receipts to a
 *    webhook, some require polling, some report nothing beyond acceptance.
 *    The interface must not assume one.
 */

export interface OutboundSms {
  /** Our row id, so results can be matched back without relying on order. */
  id: string;
  /** E.164. */
  to: string;
  body: string;
}

export type SendOutcome =
  /** The gateway took it. NOT a delivery confirmation. */
  | { id: string; status: 'accepted'; providerMessageId?: string }
  /** Try again later — timeout, 5xx, rate limit, transient credit issue. */
  | { id: string; status: 'retryable_failure'; error: string }
  /** Never going to work — invalid number, blocked content, unroutable. */
  | { id: string; status: 'terminal_failure'; error: string };

export type DeliveryStatus =
  | { providerMessageId: string; status: 'delivered'; at?: Date }
  | { providerMessageId: string; status: 'failed'; error: string }
  | { providerMessageId: string; status: 'unknown' };

export interface SmsGateway {
  /** Stored on the row, so a message can be traced to the gateway that took it. */
  readonly code: string;

  send(messages: OutboundSms[]): Promise<SendOutcome[]>;

  /** Present only on gateways that can report beyond acceptance. */
  fetchStatus?(providerMessageIds: string[]): Promise<DeliveryStatus[]>;
}

/** DI token — the module binds exactly one implementation to it. */
export const SMS_GATEWAY = Symbol('SMS_GATEWAY');
