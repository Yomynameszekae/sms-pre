import { IsOptional, IsString } from 'class-validator';

/** Body for reject / withdraw — an optional note explaining the outcome. */
export class TransitionNotesDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
