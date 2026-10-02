// Google re-auth for account deletion (B-313-1): fresh Supabase Google OAuth
// session token, nothing stored, cancel and provider errors surfaced.

jest.mock('expo-auth-session', () => ({ makeRedirectUri: jest.fn(() => 'tgp://auth/callback') }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('../../config/env', () => ({ env: { SUPABASE_URL: 'https://abc.supabase.co' } }));
jest.mock('../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

import * as WebBrowser from 'expo-web-browser';
import { reauthenticateWithGoogle, parseOAuthRedirect } from '../googleReauth';
import { providersFromAccessToken } from '../authProviders';
import { secureStorage } from '../../services/secureStorage';

const openAuth = WebBrowser.openAuthSessionAsync as jest.Mock;

function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'ES256' })}.${enc(claims)}.sig`;
}

describe('reauthenticateWithGoogle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the fresh session access token without storing anything', async () => {
    openAuth.mockResolvedValue({
      type: 'success',
      url: 'tgp://auth/callback#access_token=fresh-tok&refresh_token=r&expires_in=3600',
    });
    await expect(reauthenticateWithGoogle()).resolves.toEqual({ success: true, accessToken: 'fresh-tok' });
    const [url, redirect] = openAuth.mock.calls[0];
    expect(url).toContain('https://abc.supabase.co/auth/v1/authorize?provider=google');
    expect(url).toContain('prompt=select_account');
    expect(redirect).toBe('tgp://auth/callback');
    expect(secureStorage.setItem).not.toHaveBeenCalled();
  });

  it('reports a cancelled browser as cancelled, not as an error', async () => {
    openAuth.mockResolvedValue({ type: 'cancel' });
    await expect(reauthenticateWithGoogle()).resolves.toEqual({ success: false, cancelled: true });
  });

  it('surfaces a provider error from the redirect', async () => {
    openAuth.mockResolvedValue({
      type: 'success',
      url: 'tgp://auth/callback?error=access_denied&error_description=Signups+not+allowed',
    });
    const res = await reauthenticateWithGoogle();
    expect(res.success).toBe(false);
    expect(res.error).toBe('access_denied: Signups not allowed');
  });

  it('fails when no token comes back, or the browser throws', async () => {
    openAuth.mockResolvedValueOnce({ type: 'success', url: 'tgp://auth/callback' });
    expect((await reauthenticateWithGoogle()).error).toBe('No access token received');
    openAuth.mockRejectedValueOnce(new Error('browser unavailable'));
    expect((await reauthenticateWithGoogle()).error).toBe('browser unavailable');
  });

  it('parses tokens only from the hash', () => {
    expect(parseOAuthRedirect('x://cb?access_token=leak')).toEqual({ error: 'No access token received' });
    expect(parseOAuthRedirect('x://cb#access_token=t')).toEqual({ accessToken: 't' });
  });
});

describe('providersFromAccessToken', () => {
  it('reads app_metadata.providers, then the single provider', () => {
    expect(providersFromAccessToken(jwt({ app_metadata: { providers: ['google'] } }))).toEqual(['google']);
    expect(providersFromAccessToken(jwt({ app_metadata: { provider: 'email' } }))).toEqual(['email']);
    expect(providersFromAccessToken(jwt({ app_metadata: { providers: ['email', 'apple'] } }))).toEqual([
      'email',
      'apple',
    ]);
  });

  it('returns null when it cannot tell', () => {
    expect(providersFromAccessToken(null)).toBeNull();
    expect(providersFromAccessToken('garbage')).toBeNull();
    expect(providersFromAccessToken(jwt({ app_metadata: { providers: ['github'] } }))).toBeNull();
    expect(providersFromAccessToken(jwt({ sub: 'x' }))).toBeNull();
  });

  it('decodes non-ASCII claims', () => {
    expect(
      providersFromAccessToken(jwt({ name: 'Zoë', app_metadata: { providers: ['google'] } })),
    ).toEqual(['google']);
  });
});
