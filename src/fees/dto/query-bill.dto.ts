import { IsUUID } from 'class-validator';

export class QueryBillDto {
  @IsUUID()
  termId: string;
}
