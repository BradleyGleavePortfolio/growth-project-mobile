/**
 * Which sign-in methods the signed-in account has, read from the stored
 * Supabase access token's `app_metadata` (`providers`, or the legacy single
 * `provider`). Used to offer the matching re-auth option. Returns null when
 * it cannot tell; callers then offer every option the platform supports.
 */
import { secureStorage } from '../services/secureStorage';

export type SignInProvider = 'email' | 'apple' | 'google';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64url → UTF-8 string without relying on atob/Buffer (Hermes-safe). */
export function decodeBase64Url(input: string): string | null {
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = BASE64.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return null;
  }
}

export function providersFromAccessToken(token: string | null): SignInProvider[] | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  const json = decodeBase64Url(payload);
  if (!json) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null) return null;
  const meta: unknown = Reflect.get(claims, 'app_metadata');
  if (typeof meta !== 'object' || meta === null) return null;
  const list: unknown = Reflect.get(meta, 'providers');
  const single: unknown = Reflect.get(meta, 'provider');
  const raw = Array.isArray(list) ? list : typeof single === 'string' ? [single] : [];
  const known = raw.filter(
    (p): p is SignInProvider => p === 'email' || p === 'apple' || p === 'google',
  );
  return known.length > 0 ? known : null;
}

export async function getSignInProviders(): Promise<SignInProvider[] | null> {
  return providersFromAccessToken(await secureStorage.getItem('supabase_token'));
}
