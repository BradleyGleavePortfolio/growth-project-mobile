// Centralized config for URLs / keys that used to be hardcoded in source.
// Security: hardcoded Supabase anon key + URL in multiple files was a rotation
// footgun and violated least-duplication. Values are now read from
// EXPO_PUBLIC_* env vars injected at build time (see eas.json / .env.example).

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const API_URL_FROM_ENV = process.env.EXPO_PUBLIC_API_URL;

// Fail loudly at module-load if Supabase env is missing. These MUST be set in
// EAS build env for the app to function — silently falling back to a default
// would repeat the original security issue.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set these in .env (dev) or eas.json build env (prod/preview).',
  );
}

// Backend API URL: env is required in production. In development the former
// Fly.io URL stays as the default so local RN dev without a .env still boots.
const DEV_API_FALLBACK = 'https://backend-spring-lake-3890.fly.dev/api';
const isDev =
  process.env.NODE_ENV !== 'production' && !!(globalThis as any).__DEV__;

let resolvedApiUrl: string;
if (API_URL_FROM_ENV) {
  resolvedApiUrl = API_URL_FROM_ENV;
} else if (isDev) {
  resolvedApiUrl = DEV_API_FALLBACK;
} else {
  throw new Error(
    'Missing EXPO_PUBLIC_API_URL in a non-dev build. Set it in eas.json build env.',
  );
}

export const env = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  API_URL: resolvedApiUrl,
};
