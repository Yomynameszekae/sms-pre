import { IsOptional, IsEnum, IsString } from 'class-validator';
import { StaffStatus, StaffRoleCategory } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryStaffDto extends PaginationDto {
  /** Partial, case-insensitive match on first name, last name, staff number. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(StaffStatus)
  status?: StaffStatus;

  @IsOptional()
  @IsEnum(StaffRoleCategory)
  roleCategory?: StaffRoleCategory;
}
