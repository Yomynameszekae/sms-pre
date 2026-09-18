import { IsNumberString } from 'class-validator';

/**
 * Only `amountDue` is editable, and only while the assignment is not on a live
 * invoice. Everything else about an assignment is its identity.
 */
export class UpdateAssignmentDto {
  @IsNumberString({ no_symbols: false })
  amountDue: string;
}
