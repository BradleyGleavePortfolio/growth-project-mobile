// Audit fix CR-1: source-level guard for the password-reset screen.
//
// The full screen is heavy to mount in jest (TextInput keyboard,
// theme provider, dynamic supabase-js import). The contracts we
// actually care about are small and stable, so we assert them by
// reading the source. This fails loud if a future edit drops the
// token-pair gate, the supabase.auth.setSession call, or the
// post-success sign-out + redirect, which together are the wire that
// makes the recovery deep link work end to end.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'auth', 'ResetPasswordScreen.tsx'),
  'utf8',
);
const NAV_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'AuthNavigator.tsx'),
  'utf8',
);

describe('ResetPasswordScreen', () => {
  it('reads access_token + refresh_token from route.params', () => {
    expect(SRC).toMatch(/route\.params\?\.access_token/);
    expect(SRC).toMatch(/route\.params\?\.refresh_token/);
  });

  it('primes the Supabase session with setSession', () => {
    expect(SRC).toMatch(/supabase\.auth\.setSession/);
  });

  it('calls updateUser to change the password', () => {
    expect(SRC).toMatch(/supabase\.auth\.updateUser\(\s*\{\s*password\s*\}/);
  });

  it('signs the user out after a successful update', () => {
    expect(SRC).toMatch(/supabase\.auth\.signOut/);
  });

  it('renders the expired-link copy when tokens are missing', () => {
    expect(SRC).toMatch(/invalid or has expired/i);
  });

  it('enforces the same password policy as the backend', () => {
    expect(SRC).toMatch(/length < 8/);
    expect(SRC).toMatch(/\[A-Z\]/);
    expect(SRC).toMatch(/\[0-9\]/);
    expect(SRC).toMatch(/\[\^A-Za-z0-9\]/);
  });
});

describe('AuthNavigator wires ResetPassword', () => {
  it('imports the ResetPassword screen', () => {
    expect(NAV_SRC).toMatch(/import\s+ResetPasswordScreen\b/);
  });

  it('registers the ResetPassword route in the param list', () => {
    expect(NAV_SRC).toMatch(
      /ResetPassword:\s*\{\s*access_token\?:\s*string;\s*refresh_token\?:\s*string\s*\}/,
    );
  });

  it('mounts the ResetPassword screen on the stack', () => {
    expect(NAV_SRC).toMatch(
      /<Stack\.Screen\s+name="ResetPassword"\s+component=\{ResetPasswordScreen\}/,
    );
  });
});
