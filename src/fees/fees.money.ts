import { Prisma } from '@prisma/client';

/**
 * THE money rules. One definition, used everywhere.
 *
 * This file is to fees what attendance.reporting.ts is to attendance: if a
 * second query ever computes "outstanding" or "is this paid" independently,
 * the product will have two answers to the same question about money. That is
 * the benchmarked product's defect D12 (an "Income" and a "Balance" column
 * that were always identical and that nobody could define) and its D34 (two
 * definitions of "current" giving different counts). Everything that needs a
 * balance comes through here.
 *
 * THE LEDGER IS THREE COLUMNS. There is no fourth, and nothing named
 * "Balance" that duplicates one of them:
 *
 *   Billed       Σ FeeAssignment.amountDue
 *   Collected    Σ FeePayment.amount   — SIGNED, so reversals net out
 *   Outstanding  Billed − Collected
 *
 * Reversals are negative rows (enforced by chk_fee_payment_amount_sign), which
 * is why every sum here is a plain SUM with no exclusion subquery.
 */

export type Money = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function money(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value);
}

/**
 * Amounts cross the API boundary as STRINGS, never as JavaScript numbers.
 *
 * `Prisma.Decimal.toJSON()` already yields a string, so a Decimal that reaches
 * `res.json()` untouched serialises correctly on its own. This helper exists
 * for the computed figures that never were a column — do not "simplify" any of
 * them to Number(), which silently introduces float error into money.
 */
export function toMoneyString(value: Money): string {
  return value.toFixed(2);
}

export function sum(values: Money[]): Money {
  return values.reduce((acc: Money, v) => acc.add(v), ZERO);
}

/** Signed sum of payments: reversals are negative and net themselves out. */
export function collectedFrom(payments: { amount: Money }[]): Money {
  return sum(payments.map((p) => p.amount));
}

export interface LedgerTotals {
  billed: Money;
  collected: Money;
  outstanding: Money;
}

export function ledgerTotals(billed: Money, collected: Money): LedgerTotals {
  return { billed, collected, outstanding: billed.sub(collected) };
}

/** Serialised form of the three columns — the shape every read returns. */
export function serialiseTotals(totals: LedgerTotals) {
  return {
    billed: toMoneyString(totals.billed),
    collected: toMoneyString(totals.collected),
    outstanding: toMoneyString(totals.outstanding),
  };
}

/**
 * The payment state of anything with a billed and a collected figure — one
 * assignment, one invoice, or a whole term.
 *
 * DERIVED, never stored. An invoice does not carry this column: storing it
 * would need a sync on every payment AND every reversal, and a reversal
 * turning a `paid` invoice back into `partially_paid` is precisely the sync a
 * school would feel when it either chases a parent who has paid or fails to
 * chase one who has not.
 *
 * `collected <= 0` rather than `=== 0` so that a payment fully reversed reads
 * as pending again rather than as some fourth state.
 */
export type PaymentState = 'pending' | 'partially_paid' | 'paid';

export function paymentState(totals: LedgerTotals): PaymentState {
  if (totals.collected.lte(ZERO)) return 'pending';
  if (totals.outstanding.lte(ZERO)) return 'paid';
  return 'partially_paid';
}

/**
 * Mobile-money networks. A constant list, NOT an enum type, so a rebrand is a
 * one-line edit rather than a migration — see the note on FeePaymentMethod.
 */
export const MOMO_PROVIDER_CODES = ['MTN', 'TELECEL', 'AIRTELTIGO'] as const;
export type MomoProviderCode = (typeof MOMO_PROVIDER_CODES)[number];
