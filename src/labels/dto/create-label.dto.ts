import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LabelCategory } from '@prisma/client';

export class CreateLabelDto {
  /**
   * Immutable after creation — see LabelsService.update. Changing a label's
   * category would move every fee under it from one side of a future profit
   * and loss to the other, and would have to re-validate uniqueness against a
   * different namespace.
   */
  @IsEnum(LabelCategory)
  category: LabelCategory;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
