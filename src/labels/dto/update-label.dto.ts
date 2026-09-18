import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Deliberately NOT `PartialType(CreateLabelDto)`: that would expose
 * `category`, which is immutable. A mis-categorised label is archived and
 * replaced, not edited across categories.
 */
export class UpdateLabelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
