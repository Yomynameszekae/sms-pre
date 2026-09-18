import { IsNumberString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Deliberately NOT `PartialType(CreateSchoolFeeDto)`: the level, year, term and
 * fee type form this fee's identity and its unique key. Changing one would
 * silently re-target every assignment already created from it. Those are
 * archive-and-recreate, not edit.
 *
 * Editing `amount` affects only FUTURE assignments — existing FeeAssignment
 * rows keep the amount frozen at assignment time.
 */
export class UpdateSchoolFeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: false })
  amount?: string;
}
