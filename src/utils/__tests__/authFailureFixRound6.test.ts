/**
 * #306 fix round 6.
 *  - Sol B-306-4: the specific meaning wins over the status. The backend's
 *    401 "Email not confirmed..." (string or array) is unconfirmed email,
 *    never "email and password don't match"; the 401 "Invalid email or
 *    password" stays wrong credentials.
 *  - Sol B-306-5: a provider helper's sanitised detail keeps the status,
 *    machine code and backend reference for mapping and reporting.
 *  - Opus C-306-5: only an identifier-like code reaches Sentry.
 *  - Opus C-306-6: a provider 401 is not about a password.
 */
const mockCaptureError = jest.fn();
jest.mock('../../services/sentry', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));

import { isAuthErrorDetail, toAuthErrorDetail } from '../authErrorDetail';
import { describeSignInFailure, failureReference, reportAuthFailure } from '../authFailure';

const REF = 'feedface-0000-4000-8000-000000000000';
const UNCONFIRMED = 'Email not confirmed. Please check your inbox and verify your email first.';

function httpError(status: number, data: unknown, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data, headers },
    config: { headers: { Authorization: 'Bearer private-test-token', 'X-Request-Id': 'sent-id-1234' }, data: '{"password":"PrivateTestPassword"}' },
  });
}

beforeEach(() => mockCaptureError.mockClear());

describe('Sol B-306-4: 401 meanings', () => {
  it.each([[UNCONFIRMED], [[UNCONFIRMED]]])('401 %p is unconfirmed email on Login and on the verify step', (message) => {
    const err = httpError(401, { message, statusCode: 401 });
    const signIn = describeSignInFailure(err);
    expect(signIn.kind).toBe('email_unconfirmed');
    expect(signIn.message).not.toMatch(/match/);
    expect(signIn.message).toMatch(/not confirmed yet/);
    const verify = describeSignInFailure(err, { flow: 'verify' });
    expect(verify.kind).toBe('email_unconfirmed');
    expect(verify.message).toMatch(/I verified my email/);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('a machine code alone is enough', () => {
    expect(describeSignInFailure(httpError(401, { code: 'email_not_confirmed', message: 'Unauthorized' })).kind).toBe(
      'email_unconfirmed',
    );
  });

  it('401 "Invalid email or password" stays wrong credentials, on Login and the verify step', () => {
    const err = httpError(401, { message: 'Invalid email or password' });
    expect(describeSignInFailure(err).kind).toBe('invalid_credentials');
    const verify = describeSignInFailure(err, { flow: 'verify' });
    expect(verify.kind).toBe('invalid_credentials');
    expect(verify.message).not.toMatch(/not verified/);
    expect(verify.message).toMatch(/Log in/);
  });

  it('Opus C-306-6: a provider 401 is not "email and password don’t match"', () => {
    const f = describeSignInFailure(httpError(401, { message: 'Invalid Apple token', request_id: REF }), { provider: 'apple' });
    expect(f.kind).toBe('unknown');
    expect(f.message).not.toMatch(/password/);
    expect(f.reference).toBe('FEEDFACE');
  });
});

describe('Sol B-306-5: sanitised failure detail', () => {
  it('keeps status, code, joined message and the backend reference, and nothing from the request', () => {
    const d = toAuthErrorDetail(httpError(500, { message: ['a', 'b'], code: 'internal_error', request_id: REF }));
    expect(d).toEqual({ kind: 'auth_error_detail', status: 500, code: 'internal_error', message: 'a b', requestId: REF });
    expect(JSON.stringify(d)).not.toMatch(/private-test-token|PrivateTestPassword/);
    expect(isAuthErrorDetail(d)).toBe(true);
    expect(toAuthErrorDetail(d)).toBe(d);
  });

  it('falls back to the x-request-id response header, then to the id this app sent', () => {
    expect(toAuthErrorDetail(httpError(500, {}, { 'x-request-id': 'hdr-5678' })).requestId).toBe('hdr-5678');
    expect(toAuthErrorDetail(httpError(500, {})).requestId).toBe('sent-id-1234');
  });

  it('a detail maps and reports exactly like the raw error', () => {
    const raw = httpError(500, { message: 'Internal server error', request_id: REF });
    const fromDetail = describeSignInFailure(toAuthErrorDetail(raw), { provider: 'apple' });
    expect(fromDetail.reference).toBe('FEEDFACE');
    expect(failureReference(toAuthErrorDetail(raw)).full).toBe(REF);
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockCaptureError.mock.calls[0][1]).toEqual({
      flow: 'sign_in',
      provider: 'apple',
      status: 500,
      code: null,
      reference: REF,
    });
  });

  it('an unconfirmed outcome is reported under its own event name and the same reference', () => {
    const ref = reportAuthFailure(httpError(500, { request_id: REF }), 'sign_up', 'email', 'unconfirmed');
    expect(ref.short).toBe('FEEDFACE');
    expect((mockCaptureError.mock.calls[0][0] as Error).message).toBe('auth_sign_up_unconfirmed');
    expect(JSON.stringify(mockCaptureError.mock.calls[0])).not.toMatch(/private-test-token|PrivateTestPassword/);
  });
});

describe('Opus C-306-5: only an identifier-like code is kept', () => {
  it.each([
    [{ error: 'Bad Request' }, null],
    [{ error: 'pat@example.com said no' }, null],
    [{ code: 'x'.repeat(65) }, null],
    [{ code: 'signup_pending' }, 'signup_pending'],
    [{ error: 'Unauthorized' }, 'Unauthorized'],
  ])('%p -> %p', (data, code) => {
    expect(toAuthErrorDetail(httpError(400, data)).code).toBe(code);
  });
});
