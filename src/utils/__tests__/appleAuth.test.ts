import { Platform } from 'react-native';

const mockSignInAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
const mockApiPost = jest.fn();

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: (...args: unknown[]) => mockSignInAsync(...args),
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
}));

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockApiPost(...args) },
}));

import {
  buildAppleAuthBody,
  emailFromAppleIdentityToken,
  reauthenticateWithApple,
  signInWithApple,
  subjectFromAppleIdentityToken,
} from '../appleAuth';
import { secureStorage } from '../../services/secureStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('signInWithApple', () => {
  beforeEach(async () => {
    Platform.OS = 'ios';
    mockSignInAsync.mockReset();
    mockIsAvailableAsync.mockReset().mockResolvedValue(true);
    mockApiPost.mockReset();
    await AsyncStorage.clear();
    await secureStorage.removeItem('supabase_token');
    await secureStorage.removeItem('supabase_refresh_token');
  });

  it('calls Apple signInAsync, posts identity token to /auth/apple, persists session', async () => {
    mockSignInAsync.mockResolvedValueOnce({
      identityToken: 'apple-id-token',
      authorizationCode: 'auth-code',
      email: 'me@example.com',
      fullName: { givenName: 'Ada', familyName: 'Lovelace' },
    });
    mockApiPost.mockResolvedValueOnce({
      data: {
        access_token: 'access-jwt',
        refresh_token: 'refresh-jwt',
        user: { id: 'u1', email: 'me@example.com', name: 'Ada Lovelace' },
        is_new_user: true,
      },
    });

    const result = await signInWithApple({ inviteCode: 'INV-123' });

    expect(mockSignInAsync).toHaveBeenCalledTimes(1);
    // Exact body: only keys the live AppleAuthDto whitelists
    // (forbidNonWhitelisted rejected identity_token with a 400).
    expect(mockApiPost).toHaveBeenCalledWith('/auth/apple', {
      token: 'apple-id-token',
      full_name: 'Ada Lovelace',
      invite_code: 'INV-123',
    });
    // C13: with an invite code the user is always a client, so the role
    // field is never sent (server default), even if a caller passed one.
    expect(mockApiPost.mock.calls[0][1]).not.toHaveProperty('intended_role');
    expect(result.success).toBe(true);
    expect(result.is_new_user).toBe(true);
    expect(await secureStorage.getItem('supabase_token')).toBe('access-jwt');
    expect(await secureStorage.getItem('supabase_refresh_token')).toBe('refresh-jwt');
  });

  it('C13: an invite code wins over intendedRole (a code always means client)', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token' });
    mockApiPost.mockResolvedValueOnce({ data: { access_token: 'a', user: { id: 'u1' }, is_new_user: true } });
    await signInWithApple({ inviteCode: 'GP-TEST1', intendedRole: 'coach' });
    expect(mockApiPost).toHaveBeenCalledWith('/auth/apple', { token: 'apple-id-token', invite_code: 'GP-TEST1' });
  });

  it('C13: a codeless coach signup sends intended_role coach', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token' });
    mockApiPost.mockResolvedValueOnce({
      data: { access_token: 'a', user: { id: 'c1', role: 'coach' }, is_new_user: true },
    });
    const result = await signInWithApple({ intendedRole: 'coach' });
    expect(mockApiPost).toHaveBeenCalledWith('/auth/apple', { token: 'apple-id-token', intended_role: 'coach' });
    expect(result.success).toBe(true);
    expect(result.user?.role).toBe('coach');
  });

  it('C13: a coach signup the backend refuses (unknown field) is NOT retried as a client; no session is stored', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token' });
    mockApiPost.mockRejectedValueOnce({
      response: { status: 400, data: { message: ['property intended_role should not exist'] } },
    });
    const result = await signInWithApple({ intendedRole: 'coach' });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error_code).toBe('coach_signup_unavailable');
    expect(await secureStorage.getItem('supabase_token')).toBeNull();
  });

  it('#306 r3: a coach signup with no server answer (network) is unconfirmed, not a refusal; no session is stored', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token' });
    mockApiPost.mockRejectedValueOnce(new Error('Cannot reach server'));
    const result = await signInWithApple({ intendedRole: 'coach' });
    expect(result.success).toBe(false);
    expect(result.error_code).toBe('coach_signup_unconfirmed');
    expect(await secureStorage.getItem('supabase_token')).toBeNull();
  });

  it('#306 r4: an unconfirmed coach signup carries the email Apple shared, when it shared one', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token', email: 'x@privaterelay.appleid.com' });
    mockApiPost.mockRejectedValueOnce(new Error('Cannot reach server'));
    const result = await signInWithApple({ intendedRole: 'coach' });
    expect(result.error_code).toBe('coach_signup_unconfirmed');
    expect(result.provider_email).toBe('x@privaterelay.appleid.com');
  });

  it('#306 r3: a coach signup answered with a 5xx is unconfirmed (it may have committed)', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token' });
    mockApiPost.mockRejectedValueOnce({ response: { status: 502, data: { message: 'Bad gateway' } } });
    const result = await signInWithApple({ intendedRole: 'coach' });
    expect(result.error_code).toBe('coach_signup_unconfirmed');
  });

  it('#306 r3: a coach signup answered with a 4xx is an ordinary failure, not unconfirmed; client failures unchanged', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token' });
    mockApiPost.mockRejectedValueOnce({ response: { status: 401, data: { message: 'Invalid Apple token' } } });
    const coach = await signInWithApple({ intendedRole: 'coach' });
    expect(coach.success).toBe(false);
    expect(coach.error_code).toBeUndefined();
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token' });
    mockApiPost.mockRejectedValueOnce(new Error('Cannot reach server'));
    const client = await signInWithApple({ intendedRole: 'client' });
    expect(client.error_code).toBeUndefined();
  });

  it('returns cancelled when user dismisses the native sheet', async () => {
    const err: any = new Error('cancelled');
    err.code = 'ERR_REQUEST_CANCELED';
    mockSignInAsync.mockRejectedValueOnce(err);

    const result = await signInWithApple();

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('surfaces backend errors as a friendly error message', async () => {
    mockSignInAsync.mockResolvedValueOnce({
      identityToken: 'apple-id-token',
    });
    mockApiPost.mockRejectedValueOnce({
      response: { data: { message: 'Apple verification failed' } },
    });

    const result = await signInWithApple();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Apple verification failed');
  });

  it('refuses to run on non-iOS platforms', async () => {
    Platform.OS = 'android';
    const result = await signInWithApple();
    expect(result.success).toBe(false);
    expect(mockSignInAsync).not.toHaveBeenCalled();
  });
});

describe('buildAppleAuthBody (live + fixed backend contract)', () => {
  const LIVE_DTO_KEYS = ['token', 'full_name', 'invite_code', 'raw_nonce'];

  it('never sends a key the live DTO rejects', () => {
    const body = buildAppleAuthBody({
      identityToken: 'jwt', givenName: 'Ada', familyName: 'Lovelace', inviteCode: 'GP-AB12',
    });
    for (const k of Object.keys(body)) expect(LIVE_DTO_KEYS).toContain(k);
    expect(body).not.toHaveProperty('identity_token');
    expect(body).not.toHaveProperty('authorization_code');
    expect(body).not.toHaveProperty('email');
  });

  it('joins the name into one string and omits it when Apple sends none', () => {
    expect(buildAppleAuthBody({ identityToken: 'jwt', givenName: ' Ada ', familyName: null }))
      .toEqual({ token: 'jwt', full_name: 'Ada' });
    expect(buildAppleAuthBody({ identityToken: 'jwt' })).toEqual({ token: 'jwt' });
    expect(buildAppleAuthBody({ identityToken: 'jwt', givenName: 'x'.repeat(300) }).full_name).toHaveLength(200);
  });
});

describe('reauthenticateWithApple (account deletion re-auth)', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
    mockSignInAsync.mockReset();
    mockApiPost.mockReset();
  });

  it('returns the identity token and authorization code without creating a session', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'fresh-id', authorizationCode: 'code-1' });
    const res = await reauthenticateWithApple();
    expect(res).toEqual({ success: true, identityToken: 'fresh-id', authorizationCode: 'code-1' });
    expect(mockSignInAsync).toHaveBeenCalledWith({ requestedScopes: [] });
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('reports a user cancel silently', async () => {
    mockSignInAsync.mockRejectedValueOnce({ code: 'ERR_REQUEST_CANCELED' });
    expect(await reauthenticateWithApple()).toEqual({ success: false, cancelled: true });
  });

  it('fails when Apple returns no identity token', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: null });
    const res = await reauthenticateWithApple();
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/identity token/);
  });

  it('is unavailable off iOS', async () => {
    Platform.OS = 'android';
    const res = await reauthenticateWithApple();
    expect(res.success).toBe(false);
    expect(mockSignInAsync).not.toHaveBeenCalled();
  });
});

// #306 r5 (Opus C-306-1 / Sol B-306-1): Apple shares the email only on the
// first authorisation, but the identity token always carries it, so a
// later attempt's marker and refusal are scoped to the Apple account.
function tokenWith(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${b64}.signature`;
}

describe('emailFromAppleIdentityToken', () => {
  it('reads the email claim and ignores anything malformed', () => {
    expect(emailFromAppleIdentityToken(tokenWith({ email: 'pat@privaterelay.appleid.com', sub: '1' }))).toBe(
      'pat@privaterelay.appleid.com',
    );
    expect(emailFromAppleIdentityToken(tokenWith({ sub: '1' }))).toBeUndefined();
    expect(emailFromAppleIdentityToken(tokenWith({ email: 'not-an-email' }))).toBeUndefined();
    expect(emailFromAppleIdentityToken('apple-id-token')).toBeUndefined();
    expect(emailFromAppleIdentityToken('a.%%%.c')).toBeUndefined();
    expect(emailFromAppleIdentityToken(null)).toBeUndefined();
  });
});

describe('signInWithApple: provider email on coach outcomes (#306 r5)', () => {
  beforeEach(async () => {
    Platform.OS = 'ios';
    mockSignInAsync.mockReset();
    mockIsAvailableAsync.mockReset().mockResolvedValue(true);
    mockApiPost.mockReset();
    await AsyncStorage.clear();
  });

  it('a later attempt (no credential email) takes the email from the identity token', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: tokenWith({ email: 'pat@icloud.com' }) });
    mockApiPost.mockRejectedValueOnce(new Error('Cannot reach server'));
    const result = await signInWithApple({ intendedRole: 'coach' });
    expect(result).toMatchObject({ error_code: 'coach_signup_unconfirmed', provider_email: 'pat@icloud.com' });
  });

  it('the coach refusal returns the email too', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: tokenWith({ email: 'pat@icloud.com' }) });
    mockApiPost.mockRejectedValueOnce({
      response: { status: 400, data: { message: ['property intended_role should not exist'] } },
    });
    const result = await signInWithApple({ intendedRole: 'coach' });
    expect(result).toMatchObject({ error_code: 'coach_signup_unavailable', provider_email: 'pat@icloud.com' });
  });
});

describe('signInWithApple: failure detail and provider subject (#306 r6)', () => {
  const REF = 'feedface-0000-4000-8000-000000000000';
  beforeEach(async () => {
    Platform.OS = 'ios';
    mockSignInAsync.mockReset();
    mockIsAvailableAsync.mockReset().mockResolvedValue(true);
    mockApiPost.mockReset();
    await AsyncStorage.clear();
  });

  it('reads the sub claim as the stable subject', () => {
    expect(subjectFromAppleIdentityToken(tokenWith({ sub: '001234.abc' }))).toBe('001234.abc');
    expect(subjectFromAppleIdentityToken(tokenWith({ email: 'pat@icloud.com' }))).toBeUndefined();
    expect(subjectFromAppleIdentityToken('apple-id-token')).toBeUndefined();
  });

  it('Sol B-306-5: an unknown backend failure keeps status, machine code and the backend reference', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: tokenWith({ sub: 'apple-sub-1' }) });
    mockApiPost.mockRejectedValueOnce({
      message: 'Request failed with status code 500',
      response: { status: 500, data: { message: 'Internal server error', code: 'internal_error', request_id: REF } },
      config: { headers: { Authorization: 'Bearer private-test-token' } },
    });
    const result = await signInWithApple();
    expect(result).toMatchObject({
      success: false,
      error: 'Internal server error',
      error_detail: { status: 500, code: 'internal_error', requestId: REF },
    });
    expect(JSON.stringify(result.error_detail)).not.toMatch(/private-test-token/);
  });

  it('an array message is joined, not dropped', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token' });
    mockApiPost.mockRejectedValueOnce({ response: { status: 400, data: { message: ['token must be a string'] } } });
    const result = await signInWithApple();
    expect(result.error).toBe('token must be a string');
  });

  it('coach outcomes and success carry the Apple user id (credential.user, else the token sub)', async () => {
    mockSignInAsync.mockResolvedValueOnce({ identityToken: tokenWith({ sub: 'apple-sub-1' }) });
    mockApiPost.mockRejectedValueOnce(new Error('Cannot reach server'));
    expect(await signInWithApple({ intendedRole: 'coach' })).toMatchObject({
      error_code: 'coach_signup_unconfirmed',
      provider_subject: 'apple-sub-1',
    });
    mockSignInAsync.mockResolvedValueOnce({ identityToken: 'apple-id-token', user: 'apple-user-2' });
    mockApiPost.mockResolvedValueOnce({ data: { access_token: 'a', user: { id: 'u2', role: 'student' }, is_new_user: false } });
    expect(await signInWithApple()).toMatchObject({ success: true, provider_subject: 'apple-user-2' });
  });
});
