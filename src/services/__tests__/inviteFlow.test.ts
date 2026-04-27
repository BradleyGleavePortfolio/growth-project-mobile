// Invite-flow API contract tests.
//
// These cover the wire shape of every endpoint hit by the invite + deep-link
// onboarding paths:
//
//   GET  /auth/signup-policy                      — feature flags
//   GET  /invite/<code>/preview                   — public coach preview
//   POST /auth/validate-invite-code               — validate before signup
//   POST /auth/signup-with-code                   — atomic email signup
//   POST /auth/register                           — codeless email signup
//   POST /auth/google                             — Google OAuth attach
//   POST /auth/attach-invite-code                 — fallback attach for users
//                                                   who signed in via Google
//                                                   without a code
//
// We mock axios up-front so the wrappers bind to a fake instance. Real network
// calls land at api.trygrowthproject.com / app.trygrowthproject.com — those
// are exercised by scripts/invite-qa.sh, which can hit the real backend
// without spinning up a device.

jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: { create: jest.fn(() => instance) },
    __instance: instance,
  };
});

const axiosMock = jest.requireMock('axios') as {
  __instance: {
    get: jest.Mock;
    post: jest.Mock;
    delete: jest.Mock;
  };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authApi } = require('../api');

beforeEach(() => {
  axiosMock.__instance.get.mockReset().mockResolvedValue({ data: {} });
  axiosMock.__instance.post.mockReset().mockResolvedValue({ data: {} });
  axiosMock.__instance.delete.mockReset().mockResolvedValue({ data: {} });
});

describe('signup policy', () => {
  it('GET /auth/signup-policy', async () => {
    axiosMock.__instance.get.mockResolvedValueOnce({
      data: { require_invite_code: true, google_signin_enabled: true },
    });
    const res = await authApi.getSignupPolicy();
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/auth/signup-policy');
    expect(res.data.require_invite_code).toBe(true);
    expect(res.data.google_signin_enabled).toBe(true);
  });
});

describe('invite preview — public, unauthenticated', () => {
  it('GET /invite/:code/preview percent-encodes the path segment', async () => {
    await authApi.getInvitePreview('weird/code 1');
    expect(axiosMock.__instance.get).toHaveBeenCalledWith(
      '/invite/weird%2Fcode%201/preview',
    );
  });

  it('returns coach branding on a valid code', async () => {
    axiosMock.__instance.get.mockResolvedValueOnce({
      data: {
        valid: true,
        coach_name: 'Jamie Coach',
        business_name: 'GP Wellness',
        accent_color: '#B08D57',
      },
    });
    const res = await authApi.getInvitePreview('ABCD1234');
    expect(res.data.valid).toBe(true);
    expect(res.data.business_name).toBe('GP Wellness');
  });

  it('surfaces a `reason` string on invalid / revoked / paused codes', async () => {
    // Backend convention: reason is human-readable and is what
    // CreateAccountScreen renders directly into the form. The shape is the
    // same regardless of *why* the code is rejected, which lets the UI stay
    // simple — we don't switch on an enum, we render `reason`.
    for (const reason of [
      'Invite code not found',
      'Invite code has been revoked',
      'Invite code is paused',
      'Invite code has expired',
      'Invite code has reached its usage limit',
    ]) {
      axiosMock.__instance.get.mockResolvedValueOnce({
        data: { valid: false, reason },
      });
      const res = await authApi.getInvitePreview('SOMECODE');
      expect(res.data.valid).toBe(false);
      expect(res.data.reason).toBe(reason);
    }
  });
});

describe('invite validation — pre-signup', () => {
  it('POST /auth/validate-invite-code with the raw code', async () => {
    await authApi.validateInviteCode('SMOKE01');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/auth/validate-invite-code',
      { code: 'SMOKE01' },
    );
  });

  it('returns valid:false with reason when the code is not active', async () => {
    axiosMock.__instance.post.mockResolvedValueOnce({
      data: { valid: false, reason: 'Invite code is paused' },
    });
    const res = await authApi.validateInviteCode('PAUSED1');
    expect(res.data.valid).toBe(false);
    expect(res.data.reason).toBe('Invite code is paused');
  });
});

describe('email signup with invite code (atomic path)', () => {
  it('POST /auth/signup-with-code includes the code', async () => {
    await authApi.signupWithCode({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'Password1!',
      invite_code: 'SMOKE01',
    });
    expect(axiosMock.__instance.post).toHaveBeenCalledWith('/auth/signup-with-code', {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'Password1!',
      invite_code: 'SMOKE01',
    });
  });

  it('forwards an optional phone number when provided', async () => {
    await authApi.signupWithCode({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'Password1!',
      phone: '+15551234567',
      invite_code: 'SMOKE01',
    });
    const body = axiosMock.__instance.post.mock.calls[0][1];
    expect(body.phone).toBe('+15551234567');
  });
});

describe('Google OAuth attach', () => {
  it('POST /auth/google with no invite code sends only the token', async () => {
    await authApi.googleAuth('GOOGLE_TOKEN');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith('/auth/google', {
      token: 'GOOGLE_TOKEN',
    });
  });

  it('POST /auth/google forwards invite_code when present', async () => {
    await authApi.googleAuth('GOOGLE_TOKEN', 'SMOKE01');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith('/auth/google', {
      token: 'GOOGLE_TOKEN',
      invite_code: 'SMOKE01',
    });
  });

  it('attachInviteCode posts the code separately for fallback attach', async () => {
    await authApi.attachInviteCode('SMOKE01');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith('/auth/attach-invite-code', {
      invite_code: 'SMOKE01',
    });
  });
});
