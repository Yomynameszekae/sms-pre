import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'change-me-in-production',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshTokenExpiresInDays: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS, 10) || 14,
  cookieName: process.env.COOKIE_NAME || 'refresh_token',
  cookieDomain: process.env.COOKIE_DOMAIN || 'localhost',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  cookieHttpOnly: process.env.COOKIE_HTTP_ONLY !== 'false',
  cookieSameSite: (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax',
  passwordHashAlgorithm: process.env.PASSWORD_HASH_ALGORITHM || 'argon2',
  argon2MemoryCost: parseInt(process.env.ARGON2_MEMORY_COST, 10) || 19456,
  argon2TimeCost: parseInt(process.env.ARGON2_TIME_COST, 10) || 2,
  argon2Parallelism: parseInt(process.env.ARGON2_PARALLELISM, 10) || 1,
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,
  tokenHashSecret: process.env.TOKEN_HASH_SECRET || 'change-token-hash-secret',
}));
