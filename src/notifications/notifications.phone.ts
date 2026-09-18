/**
 * Phone normalisation to E.164, for Ghana.
 *
 * A PURE FUNCTION, and it never rewrites stored data. `Guardian.phonePrimary`
 * stays exactly as a member of staff typed it; normalisation happens here, in
 * the send path, every time.
 *
 * That is a deliberate choice over back-filling the column. `phonePrimary`
 * carries `@@unique([schoolId, phonePrimary])`, so normalising it in place can
 * collide two rows that were previously distinct — `0244123456` and
 * `+233244123456` are two rows today and one row after. That is a real
 * migration with a real conflict-resolution problem, and it must not ride
 * along inside a notification feature. Normalising at send time means a
 * malformed number fails loudly on that one message, as a `suppressed` row
 * naming the reason, rather than silently destroying a record.
 */

/** Ghana. The only country Brite serves, per the currency decision. */
const COUNTRY_CODE = '233';

/**
 * Ghanaian mobile numbers are 9 digits after the country code, beginning with
 * 2, 5 or 0 (02x, 05x local). Landlines are out of scope: an SMS to one is a
 * paid message that cannot arrive.
 */
const NATIONAL_SIGNIFICANT_LENGTH = 9;

export type PhoneNormalisationFailure =
  | 'empty'
  | 'not_a_number'
  | 'wrong_length'
  | 'not_a_ghana_number';

export type PhoneNormalisationResult =
  | { ok: true; e164: string }
  | { ok: false; reason: PhoneNormalisationFailure; detail: string };

/**
 * Accepts every shape a Ghanaian number is actually typed in:
 *
 *   0244123456        local, leading zero
 *   +233244123456     E.164
 *   233244123456      country code, no plus
 *   024 412 3456      spaces, dashes, brackets
 *
 * and returns `+233244123456` for all of them.
 */
export function normaliseGhanaPhone(raw: string | null | undefined): PhoneNormalisationResult {
  if (!raw || !raw.trim()) {
    return { ok: false, reason: 'empty', detail: 'No phone number on record' };
  }

  // Strip everything that is not a digit, keeping a leading + only as a hint
  // we have already handled by looking at the country code below.
  const digits = raw.replace(/\D/g, '');

  if (!digits) {
    return { ok: false, reason: 'not_a_number', detail: `'${raw}' contains no digits` };
  }

  let national: string;
  if (digits.startsWith(COUNTRY_CODE) && digits.length === COUNTRY_CODE.length + NATIONAL_SIGNIFICANT_LENGTH) {
    national = digits.slice(COUNTRY_CODE.length);
  } else if (digits.startsWith('0') && digits.length === NATIONAL_SIGNIFICANT_LENGTH + 1) {
    national = digits.slice(1);
  } else if (digits.length === NATIONAL_SIGNIFICANT_LENGTH) {
    national = digits;
  } else {
    return {
      ok: false,
      reason: 'wrong_length',
      detail: `'${raw}' is not a 9-digit Ghanaian number (got ${digits.length} digits)`,
    };
  }

  // A Ghanaian mobile's national number starts 2 or 5 (024…, 054…, 020…).
  if (!/^[25]/.test(national)) {
    return {
      ok: false,
      reason: 'not_a_ghana_number',
      detail: `'${raw}' does not look like a Ghanaian mobile number`,
    };
  }

  return { ok: true, e164: `+${COUNTRY_CODE}${national}` };
}
