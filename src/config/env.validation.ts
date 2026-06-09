import { plainToClass } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsString()
  DATABASE_URL: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_ACCESS_EXPIRES_IN: string;

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_EXPIRES_IN_DAYS: number;

  @IsString()
  TOKEN_HASH_SECRET: string;

  @IsString()
  COOKIE_NAME: string;

  @IsIn(['true', 'false', true, false])
  COOKIE_SECURE: string | boolean;

  @IsIn(['lax', 'strict', 'none'])
  COOKIE_SAME_SITE: string;

  @IsIn(['argon2', 'bcrypt'])
  PASSWORD_HASH_ALGORITHM: string;

  @IsString()
  S3_BUCKET: string;

  @IsString()
  S3_REGION: string;

  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV?: Environment;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${messages}`);
  }

  return validatedConfig;
}
