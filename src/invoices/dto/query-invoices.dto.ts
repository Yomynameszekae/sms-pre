import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';

export class QueryInvoicesDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  enrollmentId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  /**
   * Filtered AFTER aggregation, not in SQL — payment state is derived from
   * payments and is not a column to put in a WHERE clause.
   */
  @IsOptional()
  @IsEnum(['pending', 'partially_paid', 'paid'] as any)
  paymentState?: 'pending' | 'partially_paid' | 'paid';
}
