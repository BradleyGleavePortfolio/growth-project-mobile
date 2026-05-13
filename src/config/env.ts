// Centralized config for URLs / keys that used to be hardcoded in source.
// Security: hardcoded Supabase anon key + URL in multiple files was a rotation
// footgun and violated least-duplication. Values are now read from
// EXPO_PUBLIC_* env vars injected at build time (see eas.json / .env.example).
//
// Release builds fail FAST at import time if any required var is missing —
// preferred over a silent runtime fallback that ships a broken binary. EAS env
// commands to provision the required vars are documented in .env.example and
// the top-level README.

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const API_URL_FROM_ENV = process.env.EXPO_PUBLIC_API_URL;
const HELP_URL_FROM_ENV = process.env.EXPO_PUBLIC_HELP_BASE_URL;

const isDev =
  process.env.NODE_ENV !== 'production' &&
  !!(globalThis as { __DEV__?: boolean }).__DEV__;

// Aggregate every missing-required-env into a single error so release
// engineers see all problems at once instead of fixing one var at a time.
const missing: string[] = [];
if (!SUPABASE_URL) missing.push('EXPO_PUBLIC_SUPABASE_URL');
if (!SUPABASE_ANON_KEY) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
if (!API_URL_FROM_ENV && !isDev) missing.push('EXPO_PUBLIC_API_URL');

if (missing.length > 0) {
  throw new Error(
    `Missing required env var(s): ${missing.join(', ')}. ` +
      `Set them via \`eas env:create --environment <env> --name <NAME> --value <value>\` ` +
      `(see .env.example for shapes and README for the full list).`,
  );
}

// Backend API URL: env is required in production. In development the former
// Fly.io URL stays as the default so local RN dev without a .env still boots.
const DEV_API_FALLBACK = 'https://backend-spring-lake-3890.fly.dev/api';

const resolvedApiUrl: string = API_URL_FROM_ENV ?? DEV_API_FALLBACK;

// Help center base URL. Optional; defaults to the public help host on the
// universal-link domain so an unconfigured build still has a working entry
// point for coaches and clients. Override with EXPO_PUBLIC_HELP_BASE_URL when
// the help site moves (e.g. a separate `help.trygrowthproject.com` host).
const DEFAULT_HELP_BASE_URL = 'https://app.trygrowthproject.com/help';
const resolvedHelpBaseUrl = (HELP_URL_FROM_ENV || DEFAULT_HELP_BASE_URL).replace(/\/+$/, '');

export const env = {
  // The throw above guarantees these are defined; the non-null assertion is
  // just for the type checker.
  SUPABASE_URL: SUPABASE_URL!,
  SUPABASE_ANON_KEY: SUPABASE_ANON_KEY!,
  API_URL: resolvedApiUrl,
  HELP_BASE_URL: resolvedHelpBaseUrl,
};

export function helpUrl(pathname?: string): string {
  if (!pathname) return resolvedHelpBaseUrl;
  const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${resolvedHelpBaseUrl}${suffix}`;
}
