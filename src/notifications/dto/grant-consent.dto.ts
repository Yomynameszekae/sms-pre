import { IsIn, IsString } from 'class-validator';

/**
 * Recording consent is a deliberate act with a method attached, not a checkbox.
 *
 * The method matters because it is the thing a school would have to produce if
 * anyone ever asked how consent was obtained. A boolean alone answers "are we
 * allowed to message them" but not "on what basis", and the second question is
 * the one that matters under Act 843.
 */
export const SMS_CONSENT_METHODS = [
  'verbal_at_enrollment',
  'written_form',
  'verbal_in_person',
  'verbal_by_phone',
  'sms_reply',
] as const;

export class GrantConsentDto {
  @IsString()
  @IsIn(SMS_CONSENT_METHODS as unknown as string[], {
    message: `smsConsentMethod must be one of: ${SMS_CONSENT_METHODS.join(', ')}`,
  })
  smsConsentMethod: string;
}
