import { IsOptional, IsUUID } from 'class-validator';

/**
 * Either a whole level or one student. Both omitted would mean "the entire
 * school", which is a lot of paid messages to fire from an unqualified call —
 * the service refuses it rather than guessing.
 */
export class SendFeeRemindersDto {
  @IsUUID()
  termId: string;

  @IsOptional()
  @IsUUID()
  levelId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
