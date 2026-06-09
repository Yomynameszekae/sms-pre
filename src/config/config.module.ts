import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import authConfig from './auth.config';
import databaseConfig from './database.config';
import storageConfig from './storage.config';

@Module({
  imports: [
    ConfigModule.forFeature(appConfig),
    ConfigModule.forFeature(authConfig),
    ConfigModule.forFeature(databaseConfig),
    ConfigModule.forFeature(storageConfig),
  ],
})
export class AppConfigModule {}
