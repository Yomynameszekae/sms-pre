import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Term-scoping needs no `termId` on Enrollment: attendance rows are dated and
 * a Term is a date range, so a term summary is a date-range filter.
 */
export class QuerySummaryDto {
  @IsUUID()
  termId: string;

  /**
   * Declared so the global whitelist validation lets it through; the actual
   * value is resolved against the export registry in the controller, which
   * 400s on an unknown one NAMING the valid formats. Validating the set here
   * would put a second list of formats beside the registry.
   */
  @IsOptional()
  @IsString()
  format?: string;
}
