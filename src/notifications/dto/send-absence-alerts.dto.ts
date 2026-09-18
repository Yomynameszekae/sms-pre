import { IsDateString, IsUUID } from 'class-validator';

export class SendAbsenceAlertsDto {
  @IsUUID()
  classroomId: string;

  /** YYYY-MM-DD. Alerts go to students the register has as `absent` on it. */
  @IsDateString()
  date: string;
}
