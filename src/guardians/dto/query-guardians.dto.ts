import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryGuardiansDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  /** Archived guardians are hidden by default; true includes them. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  includeArchived?: boolean;
}
