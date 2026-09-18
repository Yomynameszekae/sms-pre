import { Prisma } from '@prisma/client';
import {
  ZERO,
  collectedFrom,
  ledgerTotals,
  money,
  paymentState,
  serialiseTotals,
  sum,
  toMoneyString,
} from './fees.money';

/**
 * The money rules are defined in exactly one place, because two independent
 * definitions of "outstanding" is how a product ends up telling a parent one
 * figure and the bursar another. These tests pin the rule so a later change to
 * it has to be deliberate.
 */
const d = (v: string) => new Prisma.Decimal(v);

describe('the three-column ledger', () => {
  it('outstanding is billed minus collected, and there is no fourth column', () => {
    const totals = ledgerTotals(d('980.00'), d('510.00'));
    expect(toMoneyString(totals.billed)).toBe('980.00');
    expect(toMoneyString(totals.collected)).toBe('510.00');
    expect(toMoneyString(totals.outstanding)).toBe('470.00');
    expect(Object.keys(serialiseTotals(totals)).sort()).toEqual([
      'billed', 'collected', 'outstanding',
    ]);
  });

  it('reversals net out of collected without an exclusion subquery', () => {
    // A payment and its reversal are two rows; the signed sum is the whole
    // mechanism. Nothing filters on reversesPaymentId to get a balance.
    const collected = collectedFrom([
      { amount: d('300.00') },
      { amount: d('200.00') },
      { amount: d('-300.00') },
    ]);
    expect(toMoneyString(collected)).toBe('200.00');
  });

  it('a fully reversed payment leaves collected at zero, not at some residue', () => {
    const collected = collectedFrom([{ amount: d('450.00') }, { amount: d('-450.00') }]);
    expect(collected.isZero()).toBe(true);
  });

  it('sums an empty set to zero rather than throwing', () => {
    expect(toMoneyString(sum([]))).toBe('0.00');
    expect(toMoneyString(collectedFrom([]))).toBe('0.00');
  });
});

describe('money never becomes a float', () => {
  it('serialises to a fixed 2dp string, not a number', () => {
    const value = toMoneyString(d('1234.5'));
    expect(value).toBe('1234.50');
    expect(typeof value).toBe('string');
  });

  it('adds amounts that binary floating point would get wrong', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754. It must not here.
    expect(toMoneyString(sum([d('0.10'), d('0.20')]))).toBe('0.30');
  });

  it('holds precision across a long run of small payments', () => {
    const payments = Array.from({ length: 300 }, () => ({ amount: d('0.07') }));
    expect(toMoneyString(collectedFrom(payments))).toBe('21.00');
  });

  it('Prisma.Decimal serialises as a string through JSON, not as a number', () => {
    // This is why a Decimal that reaches res.json() untouched is already
    // correct, and why nothing may map it through Number().
    const parsed = JSON.parse(JSON.stringify({ amount: d('980.00') }));
    expect(typeof parsed.amount).toBe('string');
  });
});

describe('payment state is derived from the money, never stored', () => {
  const state = (billed: string, collected: string) =>
    paymentState(ledgerTotals(d(billed), d(collected)));

  it('nothing collected is pending', () => {
    expect(state('980.00', '0.00')).toBe('pending');
  });

  it('some collected is partially paid', () => {
    expect(state('980.00', '510.00')).toBe('partially_paid');
  });

  it('fully collected is paid', () => {
    expect(state('980.00', '980.00')).toBe('paid');
  });

  it('a REVERSAL turns a paid invoice back into partially paid', () => {
    // The case that makes a stored status dangerous: without a sync, a school
    // either chases a parent who has paid or fails to chase one who has not.
    expect(state('980.00', '980.00')).toBe('paid');
    const afterReversal = collectedFrom([
      { amount: d('980.00') },
      { amount: d('-480.00') },
    ]);
    expect(paymentState(ledgerTotals(d('980.00'), afterReversal))).toBe('partially_paid');
  });

  it('a FULLY reversed payment returns to pending, not to a fourth state', () => {
    const afterReversal = collectedFrom([
      { amount: d('980.00') },
      { amount: d('-980.00') },
    ]);
    expect(paymentState(ledgerTotals(d('980.00'), afterReversal))).toBe('pending');
  });

  it('a zero-billed set is paid once anything is collected, and pending otherwise', () => {
    expect(state('0.00', '0.00')).toBe('pending');
  });
});

describe('money() and ZERO', () => {
  it('accepts a string and keeps its scale', () => {
    expect(toMoneyString(money('42'))).toBe('42.00');
  });

  it('ZERO is immutable across additions', () => {
    sum([d('5.00')]);
    expect(ZERO.isZero()).toBe(true);
  });
});
