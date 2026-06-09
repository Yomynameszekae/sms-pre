import { IsOptional, IsEnum, IsString } from 'class-validator';
import { EnrollmentStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryStudentsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
