import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryLevelsDto {
  /**
   * Archived (isActive=false) levels are hidden by default; pass true to
   * include them (the restore UI needs to see them). Explicit @Transform
   * because implicit conversion is globally off.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  includeArchived?: boolean;
}
