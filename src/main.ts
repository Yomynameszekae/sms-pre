import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import * as compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

function parseCorsOrigins(origin: string): string | string[] {
  const origins = origin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return origins.length <= 1 ? origins[0] || origin : origins;
}

// Captured once at process start. Every response carries it as x-booted-at so
// tooling (QA preflight) can detect an orphaned process serving stale code:
// if the newest source file is younger than this timestamp, the running
// server cannot contain it.
const BOOTED_AT = new Date().toISOString();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('x-booted-at', BOOTED_AT);
    next();
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:3001');

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Implicit conversion is OFF deliberately: with it on, every
      // @IsString() body field silently accepted JSON numbers (dropping
      // leading zeros from Ghanaian phone numbers) and @IsInt fields
      // accepted numeric strings. The two places that genuinely need
      // string→value conversion from query params carry explicit
      // decorators instead: PaginationDto (@Type(() => Number) on
      // page/limit) and QueryUsersDto.isActive (@Transform). New numeric
      // or boolean QUERY-param fields must do the same.
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: parseCorsOrigins(corsOrigin),
    credentials: true,
  });

  await app.listen(port);
  console.log(`Application running on port ${port} with prefix /${apiPrefix}`);
}

bootstrap();
