// Settings > Change password: a refused change is told in plain words, never
// the provider's raw text (CF-SETTINGS-128, FW-ACCOUNT U7).
import * as fs from 'fs';
import * as path from 'path';

const mockUpdateUser = jest.fn();
const mockSetSession = jest.fn(async () => ({ error: null }));
let mockTokens: Record<string, string | null> = {};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { setSession: mockSetSession, updateUser: mockUpdateUser } })),
}));
jest.mock('../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async (key: string) => mockTokens[key] ?? null) },
}));
jest.mock('../../config/env', () => ({
  env: { SUPABASE_URL: 'https://project.example.test', SUPABASE_ANON_KEY: 'anon-test-key' },
}));

import { passwordChangeFailureCopy, updateSupabasePassword } from '../supabaseAuth';

beforeEach(() => {
  jest.clearAllMocks();
  mockTokens = { supabase_token: 'access-test', supabase_refresh_token: 'refresh-test' };
});

describe('passwordChangeFailureCopy', () => {
  it.each([
    [{ code: 'same_password', status: 422 }, 'Choose a password different from your current one.'],
    [{ code: 'weak_password', status: 422 },
      'Choose a stronger password: at least 8 characters, with an uppercase letter, a number and a special character.'],
    [{ code: 'reauthentication_needed', status: 400 }, 'For your security, sign out, sign in again, then change your password.'],
    [{ status: 429 }, 'Too many attempts. Wait a few minutes, then try again.'],
    [{ status: 401, message: 'invalid JWT' }, 'Your sign-in has expired. Sign out, sign in again, then change your password.'],
    [{ message: 'Network request failed' },
      'The app could not reach the server, so your password was not changed. Check your connection, then try again.'],
    [{ status: 500, message: 'AuthApiError: unexpected_failure at /user' }, 'Your password was not changed. Try again in a moment.'],
  ])('%j -> plain copy', (error, copy) => {
    expect(passwordChangeFailureCopy(error)).toBe(copy);
  });
});

describe('updateSupabasePassword', () => {
  it('asks for a fresh sign-in when no session is stored, without calling the provider', async () => {
    mockTokens = {};
    await expect(updateSupabasePassword('Test-passw0rd')).resolves.toEqual({
      ok: false, message: 'Your sign-in has expired. Sign out, sign in again, then change your password.',
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  // The supabase-js import is dynamic (kept off the cold start), which Jest
  // here cannot load, so the provider paths are pinned in the source.
  it('passes every refusal and thrown failure through the plain copy, never the provider text', () => {
    const src = fs.readFileSync(path.join(__dirname, '../supabaseAuth.ts'), 'utf8');
    expect(src).toContain('return { ok: false, message: passwordChangeFailureCopy(error) };');
    expect(src).toContain("return { ok: false, message: passwordChangeFailureCopy({ message: errorMessage(err, '') }) };");
    expect(src).not.toMatch(/message: error\.message/);
    expect(src).not.toContain('Password update failed');
  });
});
