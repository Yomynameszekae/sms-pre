import { randomBytes } from 'crypto';

export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

export function generateOtp(digits = 6): string {
  const max = Math.pow(10, digits);
  const otp = Math.floor(Math.random() * max);
  return otp.toString().padStart(digits, '0');
}
