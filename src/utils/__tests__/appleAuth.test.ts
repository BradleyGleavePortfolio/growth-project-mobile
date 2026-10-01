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

import { buildAppleAuthBody, reauthenticateWithApple, signInWithApple } from '../appleAuth';
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
    expect(result.success).toBe(true);
    expect(result.is_new_user).toBe(true);
    expect(await secureStorage.getItem('supabase_token')).toBe('access-jwt');
    expect(await secureStorage.getItem('supabase_refresh_token')).toBe('refresh-jwt');
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
