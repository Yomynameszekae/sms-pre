import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  bucket: process.env.S3_BUCKET || 'ghana-sms-dev',
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
}));
