// Behavioral tests for the Connect + Packages typed API clients.
//
// Backend-compatible shapes only — see pr149_round2_backend_contract/* for
// the source of truth. Tests assert package_id (not share_token), backend
// enums ('one_time'|'recurring', 'week'|'month'|'year'), allowed redirect
// URL prefixes (growthproject://), Idempotency-Key on every mutation, and
// that generateIdempotencyKey uses a cryptographically secure UUID source.

jest.mock('../../services/api', () => {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  return { __esModule: true, default: instance };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const apiMock = jest.requireMock('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};

import { connectApi } from '../connectApi';
import {
  coachPackagesApi,
  publicPackagesApi,
  PACKAGE_CHECKOUT_SUCCESS_URL,
  PACKAGE_CHECKOUT_CANCEL_URL,
} from '../packagesApi';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { validateStripeUrl } from '../../utils/stripeUrlValidator';
import { isValidPackageShareToken } from '../../utils/packageShare';

beforeEach(() => {
  apiMock.get.mockReset().mockResolvedValue({ data: {} });
  apiMock.post.mockReset().mockResolvedValue({ data: {} });
  apiMock.patch.mockReset().mockResolvedValue({ data: {} });
  apiMock.delete.mockReset().mockResolvedValue({ data: {} });
});

// ── connectApi mutations carry Idempotency-Key ─────────────────────────────

describe('connectApi mutations send Idempotency-Key', () => {
  it('createAccount → POST /v1/connect/accounts/create + idem header', async () => {
    await connectApi.createAccount({ country: 'US' });
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = apiMock.post.mock.calls[0];
    expect(url).toBe('/v1/connect/accounts/create');
    expect(body).toEqual({ country: 'US' });
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('createOnboardingLink → POST .../onboarding-link + idem header', async () => {
    await connectApi.createOnboardingLink();
    const [url, , config] = apiMock.post.mock.calls[0];
    expect(url).toBe('/v1/connect/accounts/onboarding-link');
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('createDashboardLink → POST .../dashboard-link + idem header', async () => {
    await connectApi.createDashboardLink();
    const [url, , config] = apiMock.post.mock.calls[0];
    expect(url).toBe('/v1/connect/accounts/dashboard-link');
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('two sequential mutations get distinct idempotency keys', async () => {
    await connectApi.createOnboardingLink();
    await connectApi.createOnboardingLink();
    const k1 = apiMock.post.mock.calls[0][2]?.headers?.['Idempotency-Key'];
    const k2 = apiMock.post.mock.calls[1][2]?.headers?.['Idempotency-Key'];
    expect(k1).toBeTruthy();
    expect(k2).toBeTruthy();
    expect(k1).not.toEqual(k2);
  });
});

// ── coachPackagesApi: list / mapping / verbs / idempotency ─────────────────

describe('coachPackagesApi list contract', () => {
  it('unwraps { packages: rows } and maps snake_case → camelCase', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: {
        packages: [
          {
            id: 'pkg_1',
            coach_user_id: 'coach_a',
            name: 'Test',
            description: 'desc',
            amount_cents: 1500,
            currency: 'usd',
            billing_type: 'recurring',
            billing_interval: 'month',
            billing_interval_count: 1,
            is_active: true,
            share_token: 'tok_abc',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
          },
        ],
      },
    });
    const res = await coachPackagesApi.list();
    expect(apiMock.get).toHaveBeenCalledWith('/v1/coach/packages');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      id: 'pkg_1',
      coachUserId: 'coach_a',
      title: 'Test',
      priceCents: 1500,
      // Backend interval='month' + count=1 → mobile UI 'monthly'.
      billingInterval: 'monthly',
      intervalCount: 1,
      status: 'active',
      shareToken: 'tok_abc',
    });
  });

  it('tolerates a flat array response (legacy backends)', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: [{ id: 'pkg_x', name: 'Solo', amount_cents: 500 }],
    });
    const res = await coachPackagesApi.list();
    expect(res.data[0].title).toBe('Solo');
    expect(res.data[0].priceCents).toBe(500);
  });
});

describe('coachPackagesApi mutations', () => {
  it('create monthly → POST with backend-compatible body + idem header', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: { id: 'pkg_new', name: 'Pro', amount_cents: 9900 },
    });
    const res = await coachPackagesApi.create({
      title: 'Pro',
      priceCents: 9900,
      billingInterval: 'monthly',
      intervalCount: 1,
      features: ['weekly check-ins'],
    });
    const [url, body, config] = apiMock.post.mock.calls[0];
    expect(url).toBe('/v1/coach/packages');
    expect(body).toMatchObject({
      name: 'Pro',
      amount_cents: 9900,
      billing_type: 'recurring',
      // Backend DTO accepts only 'week' | 'month' | 'year'.
      billing_interval: 'month',
      billing_interval_count: 1,
    });
    // Backend `CreatePackageDto` whitelist rejects unknown fields.
    expect(body.features).toBeUndefined();
    expect(body.trial_days).toBeUndefined();
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
    expect(res.data.id).toBe('pkg_new');
    expect(res.data.title).toBe('Pro');
  });

  it('create yearly → backend billing_interval=year', async () => {
    await coachPackagesApi.create({
      title: 'Annual',
      priceCents: 99000,
      billingInterval: 'yearly',
    });
    const [, body] = apiMock.post.mock.calls[0];
    expect(body.billing_type).toBe('recurring');
    expect(body.billing_interval).toBe('year');
    expect(body.billing_interval_count).toBe(1);
  });

  it('create quarterly → backend billing_interval=month, count=3', async () => {
    await coachPackagesApi.create({
      title: 'Quarter',
      priceCents: 25000,
      billingInterval: 'quarterly',
    });
    const [, body] = apiMock.post.mock.calls[0];
    expect(body.billing_type).toBe('recurring');
    expect(body.billing_interval).toBe('month');
    expect(body.billing_interval_count).toBe(3);
  });

  it('one_time create → billing_type=one_time, no billing_interval', async () => {
    await coachPackagesApi.create({
      title: 'Once',
      priceCents: 5000,
      billingInterval: 'one_time',
    });
    const [, body] = apiMock.post.mock.calls[0];
    expect(body.billing_type).toBe('one_time');
    // Backend `billing_interval` is enum 'week'|'month'|'year' — valid only
    // for recurring. One-time must omit the field entirely.
    expect(body.billing_interval).toBeUndefined();
    expect(body.billing_interval_count).toBeUndefined();
  });

  it('update → PATCH with whitelisted snake_case body + idem header', async () => {
    apiMock.patch.mockResolvedValueOnce({
      data: { id: 'pkg_1', name: 'Renamed', amount_cents: 2500 },
    });
    await coachPackagesApi.update('pkg_1', { priceCents: 2500, status: 'active' });
    const [url, body, config] = apiMock.patch.mock.calls[0];
    expect(url).toBe('/v1/coach/packages/pkg_1');
    expect(body).toMatchObject({ amount_cents: 2500, is_active: true });
    // Backend UpdatePackageDto whitelist: name, description, amount_cents,
    // currency, is_active only.
    expect(body.billing_type).toBeUndefined();
    expect(body.billing_interval).toBeUndefined();
    expect(body.trial_days).toBeUndefined();
    expect(body.features).toBeUndefined();
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('archive → DELETE /v1/coach/packages/:id (not POST archive) + idem', async () => {
    apiMock.delete.mockResolvedValueOnce({ data: { ok: true } });
    const res = await coachPackagesApi.archive('pkg_1');
    expect(apiMock.delete).toHaveBeenCalledTimes(1);
    expect(apiMock.post).not.toHaveBeenCalled();
    const [url, config] = apiMock.delete.mock.calls[0];
    expect(url).toBe('/v1/coach/packages/pkg_1');
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
    expect(res.data.id).toBe('pkg_1');
    expect(res.data.status).toBe('archived');
  });

  it('encodeURIComponent is applied to ids in path segments', async () => {
    await coachPackagesApi.update('pkg/with/slash', { priceCents: 100 });
    const [url] = apiMock.patch.mock.calls[0];
    expect(url).toBe('/v1/coach/packages/pkg%2Fwith%2Fslash');
  });
});

// ── publicPackagesApi: checkout endpoint + token validation ────────────────

describe('publicPackagesApi.createCheckoutSession', () => {
  it('hits /v1/checkout/sessions with package_id + allowed redirect URLs + idem header', async () => {
    await publicPackagesApi.createCheckoutSession(
      '11111111-2222-4333-8444-555555555555',
    );
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = apiMock.post.mock.calls[0];
    expect(url).toBe('/v1/checkout/sessions');
    // Backend `CreateCheckoutDto` requires `package_id` as a UUID. We must
    // NOT send `share_token` — the whitelist validator rejects it.
    expect(body).toMatchObject({
      package_id: '11111111-2222-4333-8444-555555555555',
      success_url: PACKAGE_CHECKOUT_SUCCESS_URL,
      cancel_url: PACKAGE_CHECKOUT_CANCEL_URL,
    });
    expect(body.share_token).toBeUndefined();
    expect(body.success_url).toMatch(/^(growthproject:\/\/|com\.growthproject\.app:\/\/|https:\/\/)/);
    expect(body.cancel_url).toMatch(/^(growthproject:\/\/|com\.growthproject\.app:\/\/|https:\/\/)/);
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  it('caller can override success/cancel URLs', async () => {
    await publicPackagesApi.createCheckoutSession('pkg_1', {
      successUrl: 'growthproject://checkout/custom-return',
      cancelUrl: 'https://app.trygrowthproject.com/cancel',
    });
    const [, body] = apiMock.post.mock.calls[0];
    expect(body.success_url).toBe('growthproject://checkout/custom-return');
    expect(body.cancel_url).toBe('https://app.trygrowthproject.com/cancel');
  });

  it('rejects empty package id without making a network call', async () => {
    await expect(
      publicPackagesApi.createCheckoutSession(''),
    ).rejects.toThrow('INVALID_PACKAGE_ID');
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('getByShareToken rejects malformed tokens before calling the API', async () => {
    await expect(
      publicPackagesApi.getByShareToken('has space'),
    ).rejects.toThrow('INVALID_SHARE_TOKEN');
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('getByShareToken encodes valid tokens into the URL path', async () => {
    await publicPackagesApi.getByShareToken('abc-123_DEF');
    expect(apiMock.get).toHaveBeenCalledWith('/v1/packages/abc-123_DEF');
  });
});

// ── generateIdempotencyKey ─────────────────────────────────────────────────
// (canonical helper from utils/idempotency — packagesApi and connectApi both
// delegate here instead of maintaining a local copy)

describe('generateIdempotencyKey', () => {
  it('returns a string in UUID v4 shape', () => {
    const k = generateIdempotencyKey();
    expect(typeof k).toBe('string');
    expect(k).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('returns a distinct value on each call', () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).not.toEqual(b);
  });

  it('uses crypto.getRandomValues (secure source, not Math.random)', () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    const getRandomValues = jest.fn((buf: Uint8Array) => {
      for (let i = 0; i < buf.length; i++) buf[i] = (i * 17) & 0xff;
      return buf;
    });
    (globalThis as { crypto?: unknown }).crypto = { getRandomValues };
    try {
      const k = generateIdempotencyKey();
      expect(getRandomValues).toHaveBeenCalledTimes(1);
      expect(k).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      (globalThis as { crypto?: unknown }).crypto = original;
    }
  });
});

// ── validateStripeUrl ──────────────────────────────────────────────────────

describe('validateStripeUrl', () => {
  it('accepts known Stripe hosts over https', () => {
    expect(validateStripeUrl('https://checkout.stripe.com/c/pay/cs_x')).toBe(true);
    expect(validateStripeUrl('https://connect.stripe.com/setup/e/acct_x')).toBe(true);
    expect(validateStripeUrl('https://dashboard.stripe.com/login')).toBe(true);
    expect(validateStripeUrl('https://billing.stripe.com/p/session_x')).toBe(true);
  });

  it('accepts Stripe subdomains', () => {
    expect(validateStripeUrl('https://foo.checkout.stripe.com/x')).toBe(true);
  });

  it('rejects http (non-https) even for Stripe hosts', () => {
    expect(validateStripeUrl('http://checkout.stripe.com/c/pay/cs_x')).toBe(false);
  });

  it('rejects unrelated hosts', () => {
    expect(validateStripeUrl('https://evil.example.com/checkout.stripe.com')).toBe(false);
    expect(validateStripeUrl('https://stripe.com.evil.example.com/x')).toBe(false);
    expect(validateStripeUrl('https://stripe.com/x')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(validateStripeUrl('')).toBe(false);
    expect(validateStripeUrl('not a url')).toBe(false);
    // @ts-expect-error — testing runtime guard for non-string input
    expect(validateStripeUrl(null)).toBe(false);
  });
});

// ── isValidPackageShareToken ───────────────────────────────────────────────

describe('isValidPackageShareToken', () => {
  it('accepts UUID-like and alnum tokens with - and _', () => {
    expect(isValidPackageShareToken('abcDEF123')).toBe(true);
    expect(isValidPackageShareToken('a-b_c-1_2')).toBe(true);
    expect(
      isValidPackageShareToken('11111111-2222-4333-8444-555555555555'),
    ).toBe(true);
  });

  it('rejects empty / oversize', () => {
    expect(isValidPackageShareToken('')).toBe(false);
    expect(isValidPackageShareToken('a'.repeat(129))).toBe(false);
  });

  it('rejects path-like, whitespace, and HTML chars', () => {
    expect(isValidPackageShareToken('../etc/passwd')).toBe(false);
    expect(isValidPackageShareToken('foo bar')).toBe(false);
    expect(isValidPackageShareToken('<script>')).toBe(false);
    expect(isValidPackageShareToken('foo/bar')).toBe(false);
    expect(isValidPackageShareToken('foo.bar')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidPackageShareToken(null)).toBe(false);
    expect(isValidPackageShareToken(undefined)).toBe(false);
    expect(isValidPackageShareToken(123)).toBe(false);
  });
});
