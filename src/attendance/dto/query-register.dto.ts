import { IsDateString, IsUUID } from 'class-validator';

export class QueryRegisterDto {
  @IsUUID()
  classroomId: string;

  /** YYYY-MM-DD. */
  @IsDateString()
  date: string;
}
