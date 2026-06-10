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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
      transformOptions: { enableImplicitConversion: true },
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
