import { AuthToken } from '../types';

export function mockHash(password: string): string {
  return btoa(password.split('').reverse().join('') + '_gp_salt');
}

export function mockVerify(password: string, hash: string): boolean {
  return mockHash(password) === hash;
}

export function createToken(userId: string, role: 'coach' | 'client'): AuthToken {
  const now = Date.now();
  return {
    userId,
    role,
    issuedAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
  };
}

export function isTokenValid(token: AuthToken): boolean {
  return Date.now() < token.expiresAt;
}
