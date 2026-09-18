import { IsDateString, IsOptional, IsString } from 'class-validator';

export class WithdrawEnrollmentDto {
  @IsDateString()
  exitDate: string;

  // Optional: the UI documents exit reason as optional and no business rule
  // requires one. Without @IsOptional() a blank reason failed validation.
  @IsOptional()
  @IsString()
  exitReason?: string;
}
