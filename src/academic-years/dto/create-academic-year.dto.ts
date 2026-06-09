import { IsDateString, IsString } from 'class-validator';

export class CreateAcademicYearDto {
  @IsString()
  label: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
