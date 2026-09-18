import { IsNumberString, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSchoolFeeDto {
  @IsUUID()
  feeTypeId: string;

  /**
   * A fee binds to a LEVEL, never a classroom: it is priced for Basic 3 and
   * every child in Basic 3A and Basic 3B pays it.
   */
  @IsUUID()
  levelId: string;

  @IsUUID()
  academicYearId: string;

  @IsUUID()
  termId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  /**
   * A STRING, not a number. Money never crosses this boundary as a JavaScript
   * float; the service parses it into a Decimal. Validated for shape here and
   * for sign/scale in the service.
   */
  @IsNumberString({ no_symbols: false })
  amount: string;
}
