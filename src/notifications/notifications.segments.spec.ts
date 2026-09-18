import { analyseSms, degradeToGsm7 } from './notifications.segments';

/**
 * Segment counting decides what a message COSTS. The trap it exists to catch:
 * ONE character outside GSM-7 drops the limit from 160 to 70 and can triple
 * the price of every message a school sends, silently.
 */
describe('GSM-7 messages', () => {
  it('an empty body still bills as one segment', () => {
    expect(analyseSms('').segments).toBe(1);
  });

  it('160 characters is one segment', () => {
    const info = analyseSms('a'.repeat(160));
    expect(info.encoding).toBe('GSM7');
    expect(info.segments).toBe(1);
  });

  it('161 characters becomes TWO, because concatenation costs 7 characters a part', () => {
    expect(analyseSms('a'.repeat(161)).segments).toBe(2);
  });

  it('306 characters is two segments, 307 is three', () => {
    expect(analyseSms('a'.repeat(306)).segments).toBe(2);
    expect(analyseSms('a'.repeat(307)).segments).toBe(3);
  });

  it('extended characters cost two each', () => {
    // '€' is a GSM-7 escape sequence: one character, two units.
    expect(analyseSms('€'.repeat(80)).encoding).toBe('GSM7');
    expect(analyseSms('€'.repeat(80)).length).toBe(160);
    expect(analyseSms('€'.repeat(81)).segments).toBe(2);
  });
});

describe('one non-GSM-7 character changes the bill', () => {
  it('a curly apostrophe forces UCS-2 and drops the limit to 70', () => {
    const plain = 'a'.repeat(100);
    const curly = `${'a'.repeat(99)}’`;
    expect(analyseSms(plain).segments).toBe(1);
    expect(analyseSms(curly).encoding).toBe('UCS2');
    expect(analyseSms(curly).segments).toBe(2);
  });

  it('names the character responsible, so a UI can warn about it', () => {
    expect(analyseSms('Fees due’').forcedUcs2By).toBe('’');
  });

  it('a 165-character message with one smart quote costs three segments', () => {
    // The concrete example from the cost analysis.
    const body = `${'a'.repeat(164)}’`;
    expect(analyseSms(body).segments).toBe(3);
  });

  it('an emoji counts as two UTF-16 units', () => {
    expect(analyseSms('\u{1F600}').length).toBe(2);
  });
});

describe('degradeToGsm7 rescues the common paste-from-Word cases', () => {
  it('converts curly quotes, dashes and ellipsis', () => {
    const body = degradeToGsm7('Fees ’ “due” — now…');
    expect(analyseSms(body).encoding).toBe('GSM7');
  });

  it('turns a three-segment message back into one', () => {
    const body = `${'a'.repeat(140)}’`;
    expect(analyseSms(body).segments).toBe(3);
    expect(analyseSms(degradeToGsm7(body)).segments).toBe(1);
  });

  it('NEVER transliterates letters — a name stays a name', () => {
    // Paying for a segment beats mangling a child's name.
    expect(degradeToGsm7('Ama Nyarkoa Osei')).toBe('Ama Nyarkoa Osei');
    expect(degradeToGsm7('José')).toBe('José');
  });
});
