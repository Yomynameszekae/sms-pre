import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CurriculumScope } from '@prisma/client';

export class CreateAdmissionDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  intendedLevelId?: string;

  @IsOptional()
  @IsEnum(CurriculumScope)
  curriculumInterest?: CurriculumScope;

  @IsOptional()
  @IsString()
  enquirySource?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
