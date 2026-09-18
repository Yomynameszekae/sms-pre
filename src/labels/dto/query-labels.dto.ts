import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { LabelCategory } from '@prisma/client';

export class QueryLabelsDto {
  @IsOptional()
  @IsEnum(LabelCategory)
  category?: LabelCategory;

  /**
   * Archived (isActive=false) labels are hidden by default; pass true to
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
