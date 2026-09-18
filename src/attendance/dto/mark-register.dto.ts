import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

export class AfternoonMarkDto {
  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  /** Free-text note about the AFTERNOON specifically. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class RegisterMarkDto {
  @IsUUID()
  enrollmentId: string;

  /** The MORNING session's status. */
  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  /** Free-text note about the MORNING, most useful on `excused` and `absent`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  /**
   * The afternoon session. OMITTED MEANS "MIRROR THE MORNING" — on create and
   * on amend alike.
   *
   * ⚠️ THE FOOTGUN, STATED HERE RATHER THAN ONLY IN THE DESIGN DOC, because
   * this is where a client author will be reading.
   *
   * "Omitted means mirror" is consistent, but it means a client that corrects
   * only the morning and omits an afternoon it had previously set will
   * SILENTLY RESET that afternoon back to the morning's value. If you are
   * writing a client: send the complete effective state of every row. Do not
   * send a partial patch and expect the unsent half to be preserved.
   *
   * Three things make this the right trade rather than a trap:
   *
   *  1. The shipped frontend already submits complete rows — `_register.tsx`
   *     composes a sparse edit overlay over the server's rows and sends all of
   *     them — so it is correct here without changing its submit logic.
   *  2. The alternative, "omitted means preserve", is worse: the endpoint's
   *     meaning would then depend on whether the row already exists, and a
   *     payload would no longer describe a register state on its own. A
   *     declarative endpoint that cannot be read without knowing the current
   *     database state is not declarative.
   *  3. The response reports `amendedCount`, so an unintended reset shows up
   *     in the same request rather than at term end.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AfternoonMarkDto)
  afternoon?: AfternoonMarkDto;
}

/**
 * One endpoint for both marking and amending, and for both sessions — a
 * register is used that way. The whole payload is upserted in a single
 * transaction, so re-sending an unchanged register is a no-op rather than a
 * duplicate.
 *
 * Deliberately NOT a second `PATCH /attendance/register/afternoon`. A narrower
 * endpoint would add a second write path into the same rows, with its own
 * authorisation check, its own audit branch and its own term-lock check —
 * three things that must not drift from the ones here, and eventually will.
 * One declarative endpoint keeps a single place where a register write is
 * validated.
 */
export class MarkRegisterDto {
  @IsUUID()
  classroomId: string;

  /** YYYY-MM-DD. Must not be in the future; see AttendanceService. */
  @IsDateString()
  date: string;

  @IsArray()
  @ArrayMinSize(1)
  // A register is one classroom's roster for one day. A payload larger than
  // any real classroom is a client bug, and the cap keeps one request from
  // holding a transaction open across thousands of upserts.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RegisterMarkDto)
  marks: RegisterMarkDto[];
}
