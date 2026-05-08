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

import { signInWithApple } from '../appleAuth';
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
    expect(mockApiPost).toHaveBeenCalledWith(
      '/auth/apple',
      expect.objectContaining({
        identity_token: 'apple-id-token',
        authorization_code: 'auth-code',
        email: 'me@example.com',
        full_name: { given_name: 'Ada', family_name: 'Lovelace' },
        invite_code: 'INV-123',
      }),
    );
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
