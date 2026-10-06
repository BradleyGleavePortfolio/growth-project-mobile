/**
 * #306 fix round 5 (owner rules 13:28 / 13:34): signup and sign-in failures
 * are read from the HTTP status and the backend code/message, never fall to
 * a generic line, and unknown ones carry a reference, a support path and a
 * sanitised Sentry event.
 */
const mockCaptureError = jest.fn();
jest.mock('../../services/sentry', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));

import {
  SIGNUP_EMAIL_EXISTS_MESSAGE,
  SIGNUP_INVITE_INVALID_MESSAGE,
  SIGNUP_PENDING_MESSAGE,
  toFriendlySignupError,
} from '../authErrorMessage';
import {
  describeSignInFailure,
  describeSignupFailure,
  failureReference,
  isNetworkFailure,
  unknownAuthFailure,
} from '../authFailure';

function httpError(status: number, data: unknown, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data, headers: {} },
    ...extra,
  });
}

const GENERIC = /Sign-in didn.t complete|^Please try again\.?$/;

describe('toFriendlySignupError', () => {
  it('409 with code signup_pending is the pending case, not "already exists"', () => {
    const r = toFriendlySignupError(httpError(409, { code: 'signup_pending', message: 'whatever' }));
    expect(r).toEqual({ kind: 'signup_pending', message: SIGNUP_PENDING_MESSAGE });
  });

  it('409 Nest default body ("Email already registered") is email_exists', () => {
    const r = toFriendlySignupError(httpError(409, { statusCode: 409, message: 'Email already registered', error: 'Conflict' }));
    expect(r).toEqual({ kind: 'email_exists', message: SIGNUP_EMAIL_EXISTS_MESSAGE });
  });

  it('400 password rule shows the backend rule text', () => {
    const rule = 'Password must be at least 8 characters with one uppercase letter, one number, and one special character.';
    expect(toFriendlySignupError(httpError(400, { message: rule }))).toEqual({ kind: 'password_rule', message: rule });
  });

  it('400 password rule given as a validation array is still shown, without exclamation marks', () => {
    const r = toFriendlySignupError(httpError(400, { message: ['Password is too weak!'] }));
    expect(r.kind).toBe('password_rule');
    expect(r.message).not.toMatch(/!/);
  });

  it('400 invite code messages map to the invite copy', () => {
    for (const message of ['Invalid or expired invite code', 'Coach invite code is required']) {
      expect(toFriendlySignupError(httpError(400, { message }))).toEqual({
        kind: 'invite_invalid',
        message: SIGNUP_INVITE_INVALID_MESSAGE,
      });
    }
  });

  it('429, network and unknown are distinct', () => {
    expect(toFriendlySignupError(httpError(429, { message: 'Too Many Requests' })).kind).toBe('rate_limited');
    expect(toFriendlySignupError(new Error('Cannot reach server. Please check your connection and try again.')).kind).toBe(
      'network',
    );
    expect(toFriendlySignupError(httpError(500, { message: 'Internal server error' })).kind).toBe('unknown');
  });

  it('never returns the generic sign-in line for a known signup failure', () => {
    const known = [
      httpError(409, { message: 'Email already registered' }),
      httpError(409, { code: 'signup_pending' }),
      httpError(400, { message: 'Password must be at least 8 characters' }),
      httpError(400, { message: 'Invalid or expired invite code' }),
    ];
    for (const e of known) expect(toFriendlySignupError(e).message).not.toMatch(GENERIC);
  });
});

describe('failureReference', () => {
  it('prefers the response request_id, then the x-request-id header, then the id this app sent', () => {
    expect(failureReference(httpError(500, { request_id: 'abcd1234-ffff' })).short).toBe('ABCD1234');
    const fromHeader = Object.assign(new Error('x'), {
      response: { status: 500, data: {}, headers: { 'X-Request-Id': '9f8e7d6c-1111' } },
    });
    expect(failureReference(fromHeader).short).toBe('9F8E7D6C');
    const sent = Object.assign(new Error('x'), { config: { headers: { 'X-Request-Id': '12345678-aaaa' } } });
    expect(failureReference(sent).short).toBe('12345678');
    expect(failureReference(new Error('x')).short).toMatch(/^[A-Z0-9]{8}$/);
  });
});

describe('unknownAuthFailure', () => {
  beforeEach(() => mockCaptureError.mockClear());

  it('shows a reference and a support path, and reports a synthetic error without the request', () => {
    const err = httpError(
      503,
      { request_id: 'cafebabe-0000', code: 'upstream_down' },
      { config: { headers: { Authorization: 'Bearer secret-token' }, data: '{"password":"Str0ng!pass"}' } },
    );
    const f = unknownAuthFailure(err, 'sign_up');
    expect(f).toMatchObject({ kind: 'unknown', support: true, reference: 'CAFEBABE', cancelled: false });
    expect(f.message).toMatch(/contact support and quote reference CAFEBABE/);
    expect(f.message).not.toMatch(/!/);
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [captured, context] = mockCaptureError.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured).not.toBe(err);
    expect((captured as Error).message).toBe('auth_sign_up_failed');
    expect(context).toEqual({ flow: 'sign_up', provider: 'email', status: 503, code: 'upstream_down', reference: 'cafebabe-0000' });
    expect(JSON.stringify(context)).not.toMatch(/secret-token|Str0ng/);
  });

  it('provider failures offer email as the next step', () => {
    expect(unknownAuthFailure(new Error('x'), 'sign_in', 'apple').message).toMatch(/^Sign in with Apple didn’t go through\. You can use your email instead/);
    expect(unknownAuthFailure(new Error('x'), 'sign_in', 'google').message).toMatch(/^Sign in with Google didn’t go through/);
  });
});

describe('describeSignInFailure / describeSignupFailure', () => {
  beforeEach(() => mockCaptureError.mockClear());

  it('401 is wrong credentials with a next step, no reference', () => {
    const f = describeSignInFailure(httpError(401, { message: 'Invalid credentials' }));
    expect(f.kind).toBe('invalid_credentials');
    expect(f.message).toMatch(/Forgot password/);
    expect(f.support).toBe(false);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('429 and network have their own copy', () => {
    expect(describeSignInFailure(httpError(429, {})).kind).toBe('rate_limited');
    expect(describeSignInFailure(new Error('Cannot reach server. Please check your connection and try again.')).kind).toBe(
      'network',
    );
  });

  it('cancellation stays silent', () => {
    expect(describeSignInFailure('Sign-in was cancelled', { provider: 'google' }).cancelled).toBe(true);
  });

  it('an unknown sign-in failure is never the generic line', () => {
    const f = describeSignInFailure(httpError(500, { message: 'boom' }));
    expect(f.kind).toBe('unknown');
    expect(f.message).not.toMatch(GENERIC);
    expect(f.support).toBe(true);
  });

  it('signup: known kinds pass through without support; unknown gets the reference', () => {
    expect(describeSignupFailure(httpError(409, { message: 'Email already registered' }))).toMatchObject({
      kind: 'email_exists',
      support: false,
      reference: null,
    });
    const unknown = describeSignupFailure(httpError(500, { request_id: 'deadbeef-1' }));
    expect(unknown).toMatchObject({ kind: 'unknown', support: true, reference: 'DEADBEEF' });
  });

  it('Sol B-339-1: an unknown signup outcome never claims the account was not created', () => {
    const notCreated = /was not created|not been created|could not create/i;
    const fromMapper = toFriendlySignupError(httpError(500, { message: 'Internal server error' }));
    expect(fromMapper.kind).toBe('unknown');
    expect(fromMapper.message).toMatch(/could not be confirmed/);
    expect(fromMapper.message).not.toMatch(notCreated);
    const withRef = unknownAuthFailure(httpError(503, { request_id: 'cafebabe-0000' }), 'sign_up');
    expect(withRef.message).toMatch(/^Account creation could not be confirmed/);
    expect(withRef.message).not.toMatch(notCreated);
    // Known refusals keep their definite copy (positive control).
    expect(toFriendlySignupError(httpError(409, { message: 'Email already registered' })).message).toBe(
      SIGNUP_EMAIL_EXISTS_MESSAGE,
    );
  });
});

describe('isNetworkFailure', () => {
  beforeEach(() => mockCaptureError.mockClear());

  it('is true only without a response, and never reports to Sentry', () => {
    expect(isNetworkFailure(new Error('Cannot reach server. Please check your connection and try again.'))).toBe(true);
    expect(isNetworkFailure(new Error('Network request failed'))).toBe(true);
    expect(isNetworkFailure(httpError(500, { message: 'Network Error' }))).toBe(false);
    expect(isNetworkFailure(httpError(500, { message: 'boom' }))).toBe(false);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });
});
