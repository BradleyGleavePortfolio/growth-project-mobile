/**
 * Verifies the auth error mapper produces quiet, safe copy for every raw
 * upstream string we'd reasonably encounter (Supabase, Google OAuth,
 * fetch / axios network failures, our own backend). Failures here usually
 * mean a new upstream wording needs to be folded into the pattern table.
 */

import { toFriendlyAuthError } from '../authErrorMessage';

describe('toFriendlyAuthError', () => {
  it('treats explicit cancellation as silent (cancelled = true)', () => {
    const cases = [
      'Sign-in was cancelled',
      'User cancelled the sign-in',
      'access_denied: The user denied the request',
      'popup_closed_by_user',
    ];
    for (const raw of cases) {
      const r = toFriendlyAuthError(raw);
      expect(r.cancelled).toBe(true);
      expect(r.category).toBe('cancelled');
    }
  });

  it('maps Supabase invalid login string to safe copy', () => {
    const r = toFriendlyAuthError('Invalid login credentials');
    expect(r.category).toBe('invalid_credentials');
    expect(r.cancelled).toBe(false);
    expect(r.message).not.toMatch(/credentials/i);
    expect(r.message).not.toMatch(/invalid/i);
  });

  it('maps unconfirmed-email errors to a polite confirm-your-email line', () => {
    const r = toFriendlyAuthError('AuthApiError: Email not confirmed');
    expect(r.category).toBe('email_unconfirmed');
    expect(r.message.toLowerCase()).toContain('confirm');
  });

  it('maps rate limiting to a calm "try again" line', () => {
    const r = toFriendlyAuthError('429 Too Many Requests');
    expect(r.category).toBe('rate_limited');
  });

  it('maps network-shaped errors to a network line', () => {
    const r = toFriendlyAuthError('Network Error');
    expect(r.category).toBe('network');
    expect(r.message.toLowerCase()).toContain('connection');
  });

  it('maps OAuth misconfiguration without leaking protocol jargon', () => {
    const r = toFriendlyAuthError('redirect_uri_mismatch');
    expect(r.category).toBe('oauth_misconfigured');
    expect(r.message).not.toMatch(/redirect_uri/i);
    expect(r.message).not.toMatch(/oauth/i);
  });

  it('falls back to a generic non-blaming line for unknown errors', () => {
    const r = toFriendlyAuthError('Floob 500: assert(noses < 3) failed');
    expect(r.category).toBe('unknown');
    expect(r.cancelled).toBe(false);
    // The generic line never echoes the raw upstream string.
    expect(r.message).not.toContain('Floob');
    expect(r.message).not.toContain('assert');
  });

  it('handles Error objects, not just strings', () => {
    const r = toFriendlyAuthError(new Error('Invalid login credentials'));
    expect(r.category).toBe('invalid_credentials');
  });

  it('handles undefined / null gracefully', () => {
    expect(toFriendlyAuthError(undefined).category).toBe('unknown');
    expect(toFriendlyAuthError(null).category).toBe('unknown');
  });
});
