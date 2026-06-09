import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CurriculumCode } from '@prisma/client';

export class EnrollAdmissionDto {
  @IsUUID()
  classroomId: string;

  @IsUUID()
  academicYearId: string;

  @IsEnum(CurriculumCode)
  curriculumTrack: CurriculumCode;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
