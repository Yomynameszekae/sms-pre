import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * The printable register grid. `from`/`to` narrow the term to a printable
 * range — a whole term of dates does not fit on a sheet of paper, and the
 * page layout is a fortnight per page.
 */
export class QueryRegisterGridDto {
  @IsUUID()
  classroomId: string;

  @IsUUID()
  termId: string;

  /** YYYY-MM-DD. Defaults to the term start. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** YYYY-MM-DD. Defaults to the term end. */
  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * Declared so the global whitelist validation lets it through; resolved
   * against the export registry in the controller, which 400s on an unknown
   * one NAMING the valid formats. Omitted entirely means "give me the JSON".
   */
  @IsOptional()
  @IsString()
  format?: string;
}
