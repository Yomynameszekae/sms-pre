import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { NotificationStatus, NotificationTrigger } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryNotificationsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @IsEnum(NotificationTrigger)
  trigger?: NotificationTrigger;

  @IsOptional()
  @IsUUID()
  guardianId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
