import * as argon2 from 'argon2';
import { createHmac } from 'crypto';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: parseInt(process.env.ARGON2_MEMORY_COST, 10) || 19456,
    timeCost: parseInt(process.env.ARGON2_TIME_COST, 10) || 2,
    parallelism: parseInt(process.env.ARGON2_PARALLELISM, 10) || 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function hashToken(token: string): string {
  const secret = process.env.TOKEN_HASH_SECRET || 'default-token-secret';
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function verifyTokenHash(token: string, hash: string): boolean {
  return hashToken(token) === hash;
}
