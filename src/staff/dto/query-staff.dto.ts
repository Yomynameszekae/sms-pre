import { IsOptional, IsEnum } from 'class-validator';
import { StaffStatus, StaffRoleCategory } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryStaffDto extends PaginationDto {
  @IsOptional()
  @IsEnum(StaffStatus)
  status?: StaffStatus;

  @IsOptional()
  @IsEnum(StaffRoleCategory)
  roleCategory?: StaffRoleCategory;
}
