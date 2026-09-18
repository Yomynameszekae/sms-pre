import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Reopening a closed term's register is a rare, audited exception, not a
 * routine action — so the reason is mandatory and goes into the audit trail
 * verbatim. Same shape of guarded reversal as the Phase 1B
 * revert-enrollment transition.
 */
export class ReopenTermDto {
  @IsString()
  @MinLength(10, {
    message: 'A reason of at least 10 characters is required to reopen a term register',
  })
  @MaxLength(500)
  reason: string;
}
