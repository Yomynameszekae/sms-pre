import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CurriculumScope } from '@prisma/client';

export class CreateTermDto {
  @IsUUID()
  academicYearId: string;

  @IsInt()
  @Min(1)
  @Max(4)
  termNumber: number;

  @IsString()
  label: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsDateString()
  examStartDate?: string;

  @IsOptional()
  @IsDateString()
  examEndDate?: string;

  @IsOptional()
  @IsEnum(CurriculumScope)
  curriculumScope?: CurriculumScope;
}
