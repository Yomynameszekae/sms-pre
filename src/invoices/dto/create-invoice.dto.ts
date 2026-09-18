import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateInvoiceDto {
  @IsUUID()
  enrollmentId: string;

  @IsUUID()
  termId: string;

  /**
   * The frozen SET. This is what an invoice adds that a frozen assignment does
   * not already have: "this term's bill" as a query has no memory, so a later
   * reconcile silently changes what yesterday's bill said. Enumerated lines
   * cannot change underneath a number.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  feeAssignmentIds: string[];

  @IsOptional()
  @IsDateString()
  dueOn?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
