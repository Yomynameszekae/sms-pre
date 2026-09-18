import { NotificationTrigger } from '@prisma/client';

/**
 * Message templates.
 *
 * These live in `SchoolSetting` (keys `notifications.template.<trigger>`) so a
 * school can edit its own wording on day one without a CRUD module and without
 * a deploy. The constants below are the DEFAULTS used when a school has not
 * set one — they are not the storage.
 *
 * TWO RULES for anything added here.
 *
 * 1. GSM-7 ONLY. No curly quotes, no en dashes, no ellipsis character. One
 *    non-GSM-7 character drops the segment limit from 160 to 70 and can triple
 *    the cost of every message a school sends. `degradeToGsm7` catches the
 *    common cases at render time, but a template should not need rescuing.
 *
 * 2. NEVER append "reply STOP to opt out". Nothing handles inbound SMS —
 *    there is no webhook, no short code, no keyword parser. Printing an
 *    instruction the system cannot honour is worse than printing none, because
 *    a parent who replies STOP and keeps receiving messages has been actively
 *    misled. Opt-out is staff-recorded until an inbound path exists.
 */
export const DEFAULT_TEMPLATES: Record<NotificationTrigger, string> = {
  fee_receipt:
    '{{school}}: Payment of GHS {{amount}} received for {{student}} ({{feeName}}). ' +
    'Receipt {{receipt}}. Balance GHS {{outstanding}}. Thank you.',

  fee_reminder:
    '{{school}}: Fees for {{student}} are outstanding. Amount due GHS {{outstanding}} ' +
    'for {{term}}. Please settle at the school office. Thank you.',

  // `{{sessions}}` carries a PHRASE, not a session list: 'all day',
  // 'for the morning' or 'for the afternoon'. It reads mid-sentence on
  // purpose. An earlier version put the qualifier in a trailing parenthetical
  // — "was marked absent from Basic 3B on 2026-09-17 (afternoon only)" — which
  // leaves the unqualified claim "was marked absent" as the part a parent
  // skimming an SMS actually reads, with the correction stranded after the
  // full stop. Whatever is doing the qualifying has to be inside the sentence.
  //
  // A school that has overridden this template keeps its own wording; a
  // missing placeholder renders empty, so an override written against any
  // earlier default still sends.
  //
  // SEGMENT BUDGET, measured rather than asserted. Fixed text is 79 chars,
  // the date is always 10, and the longest phrase is 'for the afternoon' at
  // 17 — leaving 54 GSM-7 characters for school + student + classroom before
  // this tips into 2 SMS segments and DOUBLES the cost of every send. The
  // longest real combination in the seed data uses 48 of those 54 ('Ohemaa
  // Agyapong' / 'Basic 6A' / 'Adom International School'), so the margin is
  // six characters. A school with a longer name than that pays twice per
  // absence alert. That thinness is real and is NOT solved here — see the
  // open question in the Part B report.
  attendance_absence:
    '{{school}}: {{student}} was marked absent {{sessions}} at {{classroom}} ' +
    'on {{date}}. Please contact the school if this is unexpected.',

  password_reset:
    '{{school}}: Your password reset code is {{token}}. It expires in ' +
    '{{expiresInMinutes}} minutes. If you did not request this, ignore this message.',

  account_setup:
    '{{school}}: Your account setup code is {{token}}. It expires in ' +
    '{{expiresInHours}} hours.',

  announcement: '{{school}}: {{message}}',
};

// RESERVED — see the note on `enum NotificationTrigger` in schema.prisma.
// `account_setup` and `announcement` have templates above but no caller yet,
// deliberately. They go through the same consent-gated enqueue path as
// everything else the day they are wired; the templates exist now so that
// wiring is a controller change and nothing else. Not dead code.

/** The SchoolSetting key a school overrides a template at. */
export function templateSettingKey(trigger: NotificationTrigger): string {
  return `notifications.template.${trigger}`;
}

/**
 * Fills `{{placeholders}}`. Any placeholder with no value is replaced with an
 * empty string rather than left as literal `{{x}}` — a parent receiving
 * "Amount due GHS {{outstanding}}" is worse than one receiving an awkward
 * sentence, and it is a paid message either way.
 */
export function renderTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = values[key];
      return value === null || value === undefined ? '' : String(value);
    })
    .replace(/\s+/g, ' ')
    .trim();
}
