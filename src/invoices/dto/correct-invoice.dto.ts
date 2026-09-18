import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Cancel-and-reissue as ONE act. The corrected set may differ from the
 * original — that is usually the point — and omitting it reissues the same
 * set, which is the "the amount was wrong, not the list" case.
 */
export class CorrectInvoiceDto {
  @IsString()
  @MinLength(10, {
    message: 'A reason of at least 10 characters is required to correct an invoice',
  })
  @MaxLength(500)
  reason: string;

  /** Omitted → reissue over the same assignments as the original. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  feeAssignmentIds?: string[];

  @IsOptional()
  @IsDateString()
  dueOn?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
