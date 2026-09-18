import { IsOptional, IsUUID } from 'class-validator';

export class QueryLedgerDto {
  @IsUUID()
  academicYearId: string;

  @IsOptional()
  @IsUUID()
  termId?: string;
}
