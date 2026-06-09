import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CurriculumCode } from '@prisma/client';

export class CreateEnrollmentDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  classroomId: string;

  @IsUUID()
  academicYearId: string;

  @IsEnum(CurriculumCode)
  curriculumTrack: CurriculumCode;

  @IsOptional()
  @IsDateString()
  enrollmentDate?: string;
}
