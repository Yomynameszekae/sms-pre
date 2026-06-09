import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { FileOwnerType } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryFilesDto extends PaginationDto {
  @IsOptional()
  @IsEnum(FileOwnerType)
  ownerType?: FileOwnerType;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
