import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { FeePaymentMethod } from '@prisma/client';
import { MOMO_PROVIDER_CODES } from '../fees.money';

export class CreatePaymentDto {
  @IsUUID()
  feeAssignmentId: string;

  /** String, not number — see CreateSchoolFeeDto.amount. */
  @IsNumberString({ no_symbols: false })
  amount: string;

  @IsEnum(FeePaymentMethod)
  method: FeePaymentMethod;

  /**
   * The mobile-money network. Required for `mobile_money` and forbidden for
   * everything else — enforced in the service AND by
   * chk_fee_payment_provider, so a direct SQL insert cannot get it wrong
   * either.
   */
  @IsOptional()
  @IsIn(MOMO_PROVIDER_CODES as unknown as string[])
  providerCode?: string;

  /**
   * The MoMo transaction ID, cheque number or bank reference. This IS the
   * reconciliation — Stage 1b records payments, it does not collect them.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsDateString()
  paidOn: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
