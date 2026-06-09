import { IsEnum, IsOptional } from 'class-validator';
import { AdmissionStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryAdmissionsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(AdmissionStatus)
  status?: AdmissionStatus;
}
