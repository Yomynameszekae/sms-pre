import { IsOptional, IsUUID } from 'class-validator';

export class QueryFeeSummaryDto {
  @IsUUID()
  levelId: string;

  @IsUUID()
  academicYearId: string;

  @IsUUID()
  termId: string;

  @IsOptional()
  @IsUUID()
  feeTypeId?: string;
}
