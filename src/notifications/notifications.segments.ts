/**
 * SMS segment counting — the thing that decides what a message COSTS.
 *
 * Billing is per segment, not per message, and the rule has a trap in it:
 *
 *   GSM-7 alphabet   → 160 characters per single segment, 153 when concatenated
 *   anything else    → 70 characters per single segment, 67 when concatenated
 *
 * ONE character outside GSM-7 drops the whole message to the 70-character
 * limit. A curly apostrophe pasted from a Word document, or an accented vowel
 * in a student's name, turns a one-segment reminder into three — at triple the
 * price, silently. That is why this is computed and STORED at queue time
 * rather than estimated in a UI.
 */

/** The GSM 03.38 basic character set. */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** These cost TWO GSM-7 characters each — they are escape sequences. */
const GSM7_EXTENDED = '^{}\\[~]|€';

const GSM7_SET = new Set([...GSM7_BASIC]);
const GSM7_EXT_SET = new Set([...GSM7_EXTENDED]);

export type SmsEncoding = 'GSM7' | 'UCS2';

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** Billable units — what the gateway charges for. */
  segments: number;
  /** GSM-7 characters (extended chars count 2) or UTF-16 code units. */
  length: number;
  /** The character that forced UCS-2, when one did. Useful in a UI warning. */
  forcedUcs2By?: string;
}

export function analyseSms(body: string): SegmentInfo {
  let gsmLength = 0;
  let forcedUcs2By: string | undefined;

  for (const char of body) {
    if (GSM7_SET.has(char)) {
      gsmLength += 1;
    } else if (GSM7_EXT_SET.has(char)) {
      gsmLength += 2;
    } else {
      forcedUcs2By ??= char;
    }
  }

  if (forcedUcs2By !== undefined) {
    // UCS-2 counts UTF-16 code units, so an emoji (a surrogate pair) is 2.
    const length = [...body].reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0);
    const segments = length === 0 ? 1 : length <= 70 ? 1 : Math.ceil(length / 67);
    return { encoding: 'UCS2', segments, length, forcedUcs2By };
  }

  const segments = gsmLength === 0 ? 1 : gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153);
  return { encoding: 'GSM7', segments, length: gsmLength };
}

/**
 * Replaces the commonest characters that silently force UCS-2, so a template
 * pasted from a word processor does not triple the bill for no benefit.
 *
 * Applied to the rendered body BEFORE counting. It is deliberately
 * conservative — it touches punctuation only, never letters, because
 * transliterating a student's name is worse than paying for a segment.
 */
export function degradeToGsm7(body: string): string {
  return body
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ');
}
