/**
 * #306 fix round 7: mapper and marker rules.
 *  - Opus C-306-8: provider "email not verified" copy names the provider.
 *  - Provider configuration faults carry a reference and are reported.
 *  - Native error codes survive in the sanitised detail.
 *  - A refused invite code on a provider signup gets the invite copy.
 *  - Sol C-306-5 residual: identity-free markers bind to nobody identified.
 */
const mockCaptureError = jest.fn();
jest.mock('../../services/sentry', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { toAuthErrorDetail } from '../authErrorDetail';
import { describeSignInFailure, describeSignupFailure } from '../authFailure';
import { SIGNUP_INVITE_INVALID_MESSAGE } from '../authErrorMessage';
import {
  hasUnconfirmedCoachSignup,
  mayHaveUnconfirmedCoachSignup,
  reconcileCoachAttempt,
  rememberUnconfirmedCoachSignup,
  resolveUnconfirmedCoachSignup,
} from '../../lib/coachSignupAttempt';

function httpError(status: number, message: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { message } },
  });
}

beforeEach(async () => {
  mockCaptureError.mockClear();
  await AsyncStorage.clear();
});

describe('Opus C-306-8', () => {
  it('Google: says to verify with Google, never "the link we sent"', () => {
    const f = describeSignInFailure(httpError(401, 'Google auth failed — email address is not verified'), { provider: 'google' });
    expect(f.kind).toBe('email_unconfirmed');
    expect(f.message).toBe('Your Google account’s email is not verified. Verify it with Google, or sign up with email.');
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('Apple: names Apple; email sign-in keeps the link copy', () => {
    expect(describeSignInFailure(httpError(401, 'Email not verified'), { provider: 'apple' }).message).toMatch(/Verify it with Apple/);
    expect(describeSignInFailure(httpError(401, 'Email not confirmed.')).message).toMatch(/Open the link in that email/);
  });
});

describe('provider failures that are ours carry a reference', () => {
  it('a configuration fault (no HTTP status) is reported with a reference', () => {
    const f = describeSignInFailure('invalid_client: bad', { provider: 'google' });
    expect(f.kind).toBe('provider_unavailable');
    expect(f.reference).toMatch(/^[A-Z0-9]{8}$/);
    expect(f.message).toContain(`quote reference ${f.reference}`);
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
  });

  it('a native error code is kept in the detail and the report', () => {
    const native = Object.assign(new Error('The operation couldn’t be completed.'), { code: 'ERR_REQUEST_FAILED' });
    expect(toAuthErrorDetail(native).code).toBe('ERR_REQUEST_FAILED');
    describeSignInFailure(toAuthErrorDetail(native), { provider: 'apple' });
    expect(mockCaptureError.mock.calls[0][1]).toMatchObject({ code: 'ERR_REQUEST_FAILED', status: null });
  });

  it('a refused invite code on a provider signup is the invite copy (detail or raw)', () => {
    const err = httpError(400, 'Invalid invite code');
    expect(describeSignupFailure(toAuthErrorDetail(err), 'google').message).toBe(SIGNUP_INVITE_INVALID_MESSAGE);
    expect(describeSignupFailure(err, 'apple').kind).toBe('invite_invalid');
    expect(mockCaptureError).not.toHaveBeenCalled();
  });
});

describe('Sol C-306-5 residual: identity-free markers', () => {
  it('the probe: a marker with no identity neither matches nor is consumed by a different person', async () => {
    await rememberUnconfirmedCoachSignup('apple');
    const other = { email: 'different-person@example.com', subject: 'subject-B' };
    expect(await hasUnconfirmedCoachSignup('apple', other)).toBe(false);
    expect(await resolveUnconfirmedCoachSignup('apple', other)).toBe(false);
    expect(await reconcileCoachAttempt('apple', { role: 'student', email: other.email }, { providerSubject: 'subject-B' })).toBeNull();
    // Still there, for device-level caution only.
    expect(await mayHaveUnconfirmedCoachSignup('apple', other)).toBe(true);
  });

  it('caution never covers a provably different identity', async () => {
    await rememberUnconfirmedCoachSignup('apple', { subject: 'subject-A' });
    expect(await mayHaveUnconfirmedCoachSignup('apple', { subject: 'subject-B' })).toBe(false);
    expect(await mayHaveUnconfirmedCoachSignup('apple', { subject: 'subject-A' })).toBe(true);
    expect(await mayHaveUnconfirmedCoachSignup('google', { subject: 'subject-A' })).toBe(false);
  });

  it('an identified marker is not bound to an unidentified sign-in either (caution only)', async () => {
    await rememberUnconfirmedCoachSignup('google', { email: 'pat@example.com', subject: 'supa-A' });
    expect(await hasUnconfirmedCoachSignup('google')).toBe(false);
    expect(await resolveUnconfirmedCoachSignup('google')).toBe(false);
    expect(await mayHaveUnconfirmedCoachSignup('google')).toBe(true);
  });

  it('two unidentified sides still pair (nothing proves them different)', async () => {
    await rememberUnconfirmedCoachSignup('apple');
    expect(await hasUnconfirmedCoachSignup('apple')).toBe(true);
    expect(await resolveUnconfirmedCoachSignup('apple')).toBe(true);
  });
});
