import { normaliseGhanaPhone } from './notifications.phone';

/**
 * Normalisation happens at SEND time and never rewrites `Guardian.phonePrimary`.
 * These tests pin both halves: that every shape staff actually type resolves,
 * and that a bad one fails loudly with a reason rather than producing a
 * plausible-looking number nobody will answer.
 */
const ok = (raw: string) => {
  const r = normaliseGhanaPhone(raw);
  if (r.ok !== true) throw new Error(`expected ok, got ${r.reason}: ${r.detail}`);
  return r.e164;
};

describe('every shape a Ghanaian number is actually typed in', () => {
  it('local, leading zero', () => expect(ok('0244123456')).toBe('+233244123456'));
  it('E.164', () => expect(ok('+233244123456')).toBe('+233244123456'));
  it('country code, no plus', () => expect(ok('233244123456')).toBe('+233244123456'));
  it('bare national significant number', () => expect(ok('244123456')).toBe('+233244123456'));
  it('spaces and dashes', () => expect(ok('024 412-3456')).toBe('+233244123456'));
  it('brackets and stray punctuation', () => expect(ok('(024) 412 3456.')).toBe('+233244123456'));
  it('a 05x number', () => expect(ok('0554208916')).toBe('+233554208916'));
  it('a 02x number', () => expect(ok('0209917553')).toBe('+233209917553'));

  it('every shape of the SAME number produces one identical result', () => {
    const forms = ['0244123456', '+233244123456', '233244123456', '244123456', '024 412 3456'];
    const results = new Set(forms.map(ok));
    // This is the whole point: the gateway needs exactly one form.
    expect(results.size).toBe(1);
  });
});

describe('unusable numbers fail loudly, with a reason', () => {
  const fails = (raw: string | null | undefined, reason: string) => {
    const r = normaliseGhanaPhone(raw);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe(reason);
  };

  it('empty', () => fails('', 'empty'));
  it('null', () => fails(null, 'empty'));
  it('whitespace only', () => fails('   ', 'empty'));
  it('letters only', () => fails('not a phone', 'not_a_number'));
  it('too short', () => fails('024412', 'wrong_length'));
  it('too long', () => fails('02441234567890', 'wrong_length'));
  it('a non-Ghanaian mobile prefix', () => fails('0144123456', 'not_a_ghana_number'));

  it('the failure carries the original input, so a clerk can find the record', () => {
    const r = normaliseGhanaPhone('024412');
    if (r.ok === false) expect(r.detail).toContain('024412');
  });
});

describe('what normalisation deliberately does NOT do', () => {
  it('is pure — the same input always gives the same output', () => {
    expect(normaliseGhanaPhone('0244123456')).toEqual(normaliseGhanaPhone('0244123456'));
  });

  it('never mutates its input', () => {
    const raw = '024 412 3456';
    normaliseGhanaPhone(raw);
    // Back-filling Guardian.phonePrimary would be a migration on a uniquely
    // indexed column where normalisation can collide two previously-distinct
    // rows. That is not a notification feature's job.
    expect(raw).toBe('024 412 3456');
  });
});
