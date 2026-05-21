// Lane 4 / P3-4: source-level guards for the AuthCallback landing.
//
// The full screen mounts a navigation hook and AsyncStorage; mounting
// it under jest needs the AuthNavigator + ThemeProvider + secureStorage
// fakes. The contracts we actually need to defend are small (the
// screen exists, redirects, and the linking config knows the path), so
// we read the sources directly. Mirrors the pattern in
// ResetPasswordScreen.test.ts.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'auth', 'AuthCallbackScreen.tsx'),
  'utf8',
);
const ROOT_NAV_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'RootNavigator.tsx'),
  'utf8',
);

describe('AuthCallbackScreen', () => {
  it('exists as a React component default export', () => {
    expect(SCREEN_SRC).toMatch(/export default function AuthCallbackScreen/);
  });

  it('inspects the auth token and dispatches on mount', () => {
    // Must check whether the user has a session before redirecting so
    // the landing is idempotent (Home if signed in, Login if not).
    expect(SCREEN_SRC).toMatch(/secureStorage\.getItem\(\s*['"]supabase_token['"]/);
    expect(SCREEN_SRC).toMatch(/navigation\.reset/);
    expect(SCREEN_SRC).toMatch(/['"]Home['"]/);
    expect(SCREEN_SRC).toMatch(/['"]Login['"]/);
  });

  it('runs the redirect inside a useEffect', () => {
    expect(SCREEN_SRC).toMatch(/useEffect\(/);
  });
});

describe('RootNavigator linking config wires auth/callback', () => {
  it('declares the AuthCallback path so tgp://auth/callback is routable', () => {
    expect(ROOT_NAV_SRC).toMatch(/AuthCallback:\s*['"]auth\/callback['"]/);
  });
});
