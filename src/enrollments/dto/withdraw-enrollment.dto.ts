import { IsDateString, IsString } from 'class-validator';

export class WithdrawEnrollmentDto {
  @IsDateString()
  exitDate: string;

  @IsString()
  exitReason: string;
}
