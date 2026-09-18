import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Reversing a receipt a parent is holding is a materially different act from
 * recording a payment, so it has its own permission and a mandatory reason —
 * the same guarded-reversal shape as the attendance term reopen.
 */
export class ReversePaymentDto {
  @IsString()
  @MinLength(10, {
    message: 'A reason of at least 10 characters is required to reverse a payment',
  })
  @MaxLength(255)
  reason: string;
}
