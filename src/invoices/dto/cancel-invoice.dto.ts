import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Cancelling a document a parent is holding is a rare, audited exception —
 * the same guarded-reversal shape as the attendance term reopen and the
 * payment reversal.
 */
export class CancelInvoiceDto {
  @IsString()
  @MinLength(10, {
    message: 'A reason of at least 10 characters is required to cancel an invoice',
  })
  @MaxLength(500)
  reason: string;
}
