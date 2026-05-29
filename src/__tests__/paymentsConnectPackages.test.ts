/**
 * Payments — Connect / packages / checkout regression tests.
 *
 * Guards the mobile contract with backend PRs #215 (packages + checkout +
 * dunning) and #216 (payout readiness, reconciliation, refunds, coach
 * earnings).
 *
 * What we assert here:
 *   1. clientPaymentsApi degrades honestly (404 / 501 → not_configured)
 *      and surfaces dunning state when present.
 *   2. The checkout session POST sends the correct success / cancel
 *      deep-link URLs so the Stripe redirect lands on
 *      com.growthproject.app://checkout/{success,cancel}. This must match
 *      the deep-link gate in BrandedCheckoutWebView — if the schemes drift,
 *      the in-app webview does not settle on return and the checkout
 *      appears stuck (audit C11).
 *   3. coachPaymentsApi CRUD calls hit the right paths + verbs.
 *   4. The coach earnings response exposes the documented fee split
 *      shape (2% TGP platform fee + 5% head coach override + Stripe).
 *   5. Navigation: ClientPackages, CheckoutReturn, CoachPackages, and
 *      CoachEarnings are registered, and the Membership screen + Settings
 *      Business section expose entry points.
 *   6. RootNavigator deep-link config accepts tgp://checkout/success
 *      and tgp://checkout/cancel.
 */

import * as fs from 'fs';
import * as path from 'path';
import { clientPaymentsApi } from '../api/clientPaymentsApi';
import { coachPaymentsApi } from '../api/coachPaymentsApi';
import api from '../services/api';

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

jest.mock('../services/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  const patch = jest.fn();
  const put = jest.fn();
  const del = jest.fn();
  return {
    __esModule: true,
    default: { get, post, patch, put, delete: del },
  };
});

const mockedApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
  mockedApi.patch.mockReset();
  mockedApi.put.mockReset();
  mockedApi.delete.mockReset();
});

// ── 1) clientPaymentsApi envelope ──────────────────────────────────────────
describe('clientPaymentsApi', () => {
  it('returns { ok: true, data } when the package list is live', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [
        {
          id: 'pkg_1',
          name: '1:1 Coaching',
          description: 'Weekly check-ins',
          type: 'recurring',
          price: 199,
          currency: 'USD',
          interval: 'month',
          trial_days: null,
          features: ['Weekly check-ins', 'Custom macros'],
          is_current: false,
        },
      ],
    });
    const res = await clientPaymentsApi.getPackages();
    expect(mockedApi.get).toHaveBeenCalledWith('/v1/clients/me/coach/packages');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0].name).toBe('1:1 Coaching');
    }
  });

  it('surfaces a 404 from packages as a retryable error, NOT not_configured', async () => {
    // PR-1 (in-app checkout fix): a 404 used to be silently mapped to
    // `not_configured`, which masked four dead routes for weeks. Real
    // 404s must surface as `reason: 'error'` so the UI offers a retry
    // instead of telling the buyer their coach hasn't enabled payments.
    mockedApi.get.mockRejectedValueOnce({
      response: { status: 404 },
      message: 'Request failed with status code 404',
    });
    const res = await clientPaymentsApi.getPackages();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('error');
    }
  });

  // PR-1 round 2 (audit fix): there is no backend `/status` route. The
  // first-pass rewire pointed `getPaymentStatus` at `/v1/checkout/status`
  // which also does not exist. `getPaymentStatus` is now DERIVED from
  // `/v1/checkout/entitlement` + `/v1/clients/me/coach/packages` — the
  // only two routes that actually exist and carry the signal we need.
  // All status tests assert on that derivation contract.

  it('derives state=active + package_name when entitlement is active and a current package exists', async () => {
    mockedApi.get
      // call 1: getEntitlement
      .mockResolvedValueOnce({ data: { active: true } })
      // call 2: getPackages
      .mockResolvedValueOnce({
        data: [
          { id: 'pkg_1', name: '1:1 Coaching', is_current: true, type: 'recurring', price: 199, currency: 'USD' },
          { id: 'pkg_2', name: 'Group', is_current: false, type: 'recurring', price: 49, currency: 'USD' },
        ],
      });
    const res = await clientPaymentsApi.getPaymentStatus();
    expect(mockedApi.get).toHaveBeenCalledWith('/v1/checkout/entitlement');
    expect(mockedApi.get).toHaveBeenCalledWith('/v1/clients/me/coach/packages');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.state).toBe('active');
      expect(res.data.package_name).toBe('1:1 Coaching');
      // No backend route exposes these yet — must be null, never invented.
      expect(res.data.current_period_end).toBeNull();
      expect(res.data.trial_ends_at).toBeNull();
      expect(res.data.dunning).toBeNull();
    }
  });

  it('derives state=none when entitlement is inactive', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: { active: false } })
      .mockResolvedValueOnce({ data: [] });
    const res = await clientPaymentsApi.getPaymentStatus();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.state).toBe('none');
      expect(res.data.package_name).toBeNull();
    }
  });

  it('returns not_configured when /v1/checkout/entitlement is 501', async () => {
    mockedApi.get
      .mockRejectedValueOnce({ response: { status: 501 } })
      // packages call still fires in parallel — give it a benign response
      .mockResolvedValueOnce({ data: [] });
    const res = await clientPaymentsApi.getPaymentStatus();
    expect(res).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns not_configured when packages list is 501', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: { active: false } })
      .mockRejectedValueOnce({ response: { status: 501 } });
    const res = await clientPaymentsApi.getPaymentStatus();
    expect(res).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('surfaces a 404 from entitlement as a retryable error, NOT not_configured', async () => {
    // PR-1 round 2: the auditor verified there is no /status route on
    // CheckoutController. A 404 on either upstream must propagate as a
    // real, retryable error so the UI offers a retry instead of telling
    // the buyer their coach hasn't enabled payments.
    mockedApi.get
      .mockRejectedValueOnce({
        response: { status: 404 },
        message: 'Request failed with status code 404',
      })
      .mockResolvedValueOnce({ data: [] });
    const res = await clientPaymentsApi.getPaymentStatus();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('error');
    }
  });

  it('surfaces a 404 from packages list as a retryable error, NOT not_configured', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: { active: true } })
      .mockRejectedValueOnce({
        response: { status: 404 },
        message: 'Request failed with status code 404',
      });
    const res = await clientPaymentsApi.getPaymentStatus();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('error');
    }
  });

  it('createBillingPortalSession POSTs /v1/checkout/billing-portal', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { url: 'https://billing.stripe.com/p/session/portal_fresh' },
    });
    const res = await clientPaymentsApi.createBillingPortalSession();
    expect(mockedApi.post).toHaveBeenCalledWith('/v1/checkout/billing-portal', {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    }
  });

  it('getEntitlement GETs /v1/checkout/entitlement (audit fix — was /v1/clients/me/coach/entitlement)', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { active: true } });
    const res = await clientPaymentsApi.getEntitlement();
    expect(mockedApi.get).toHaveBeenCalledWith('/v1/checkout/entitlement');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.active).toBe(true);
    }
  });

  it('createCheckoutSession sends Stripe template tokens for success / cancel', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        session_id: 'cs_test_abc',
        expires_at: '2026-05-16T00:00:00Z',
      },
    });
    await clientPaymentsApi.createCheckoutSession('pkg_1');
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/v1/checkout/sessions',
      expect.objectContaining({
        package_id: 'pkg_1',
        success_url: expect.stringMatching(/^com\.growthproject\.app:\/\/checkout\/success/),
        cancel_url: 'com.growthproject.app://checkout/cancel',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
        }),
      }),
    );
    // The success URL must include the Stripe session-id template token
    // so the backend hands it back to the app on return.
    const call = mockedApi.post.mock.calls[0][1] as { success_url: string };
    expect(call.success_url).toContain('{CHECKOUT_SESSION_ID}');
    // R19: every checkout-session POST carries an Idempotency-Key so a
    // double-tap on Buy does not mint duplicate Stripe sessions.
    const config = mockedApi.post.mock.calls[0][2] as {
      headers: { 'Idempotency-Key'?: string };
    };
    expect(config.headers['Idempotency-Key']).toBeTruthy();
  });

  it('confirmCheckoutSession GETs /v1/checkout/sessions/:id/confirm', async () => {
    // PR-1 (in-app checkout fix): the old call was POST to a non-existent
    // /v1/clients/me/coach/checkout/confirm path — every successful
    // charge was stuck in "confirmation pending" forever. Real route is
    // GET /v1/checkout/sessions/:id/confirm with the session id in the
    // path (the session id itself is the dedup key — no body, no
    // client-supplied Idempotency-Key required).
    mockedApi.get.mockResolvedValueOnce({
      data: {
        state: 'active',
        package_name: '1:1 Coaching',
        current_period_end: null,
        trial_ends_at: null,
        dunning: null,
      },
    });
    const res = await clientPaymentsApi.confirmCheckoutSession('cs_test_abc');
    expect(mockedApi.get).toHaveBeenCalledWith(
      '/v1/checkout/sessions/cs_test_abc/confirm',
    );
    expect(res.ok).toBe(true);
  });

  it('confirmCheckoutSession URL-encodes the session id in the path', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        state: 'active',
        package_name: null,
        current_period_end: null,
        trial_ends_at: null,
        dunning: null,
      },
    });
    // Stripe session ids are alphanumeric+underscore in practice, but defend
    // against any caller passing an id with reserved characters.
    await clientPaymentsApi.confirmCheckoutSession('cs/with/slash');
    expect(mockedApi.get).toHaveBeenCalledWith(
      '/v1/checkout/sessions/cs%2Fwith%2Fslash/confirm',
    );
  });
});

// ── 2) coachPaymentsApi CRUD + earnings shape ──────────────────────────────
describe('coachPaymentsApi', () => {
  it('listPackages GETs /v1/coach/packages', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    await coachPaymentsApi.listPackages();
    expect(mockedApi.get).toHaveBeenCalledWith('/v1/coach/packages');
  });

  it('createPackage POSTs the full input shape', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { id: 'pkg_new' } });
    await coachPaymentsApi.createPackage({
      name: '1:1 Coaching',
      type: 'recurring',
      price: 199,
      currency: 'USD',
      interval: 'month',
      trial_days: 7,
      features: ['Weekly check-ins'],
      active: true,
    });
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/v1/coach/packages',
      expect.objectContaining({
        name: '1:1 Coaching',
        type: 'recurring',
        price: 199,
        currency: 'USD',
        interval: 'month',
        trial_days: 7,
      }),
    );
  });

  it('updatePackage PATCHes /v1/coach/packages/:id', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: {} });
    await coachPaymentsApi.updatePackage('pkg_1', { active: false });
    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/v1/coach/packages/pkg_1',
      { active: false },
    );
  });

  it('archivePackage DELETEs /v1/coach/packages/:id', async () => {
    mockedApi.delete.mockResolvedValueOnce({ data: { id: 'pkg_1', active: false } });
    await coachPaymentsApi.archivePackage('pkg_1');
    expect(mockedApi.delete).toHaveBeenCalledWith('/v1/coach/packages/pkg_1');
  });

  it('getPayoutReadiness GETs /v1/coach/payouts/readiness', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        onboarded: true,
        charges_enabled: true,
        payouts_enabled: false,
        requirements_due: ['external_account'],
        next_payout_eta: null,
        dashboard_available: true,
      },
    });
    const res = await coachPaymentsApi.getPayoutReadiness();
    expect(mockedApi.get).toHaveBeenCalledWith('/v1/coach/payouts/readiness');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.requirements_due).toContain('external_account');
    }
  });

  it('earnings response carries 2% platform + 5% head-coach fee fields', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        currency: 'USD',
        gross_mtd: 5000,
        net_mtd: 4650,
        stripe_fees_mtd: 200,
        platform_fees_mtd: 100, // 2% of 5000
        head_coach_fees_mtd: 50, // 5% override
        gross_lifetime: 50000,
        net_lifetime: 46500,
        sub_coach_breakdown: [],
        generated_at: '2026-05-15T00:00:00Z',
      },
    });
    const res = await coachPaymentsApi.getEarnings();
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 2% of gross.
      expect(res.data.platform_fees_mtd).toBeCloseTo(res.data.gross_mtd * 0.02);
      // Head coach override is non-negative.
      expect(res.data.head_coach_fees_mtd).toBeGreaterThanOrEqual(0);
    }
  });

  it('reconciliation surfaces drift state + summary verbatim', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        state: 'drift',
        drift_amount: 12.34,
        currency: 'USD',
        window_start: '2026-05-01T00:00:00Z',
        window_end: '2026-05-15T00:00:00Z',
        summary: 'Ledger drift detected — contact support.',
      },
    });
    const res = await coachPaymentsApi.getReconciliation();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.state).toBe('drift');
      expect(res.data.summary).toMatch(/contact support/);
    }
  });

  it('createDashboardLink POSTs /v1/coach/dashboard-link', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { url: 'https://connect.stripe.com/express/abc', expires_at: '...' },
    });
    await coachPaymentsApi.createDashboardLink();
    expect(mockedApi.post).toHaveBeenCalledWith('/v1/coach/dashboard-link', {});
  });
});

// ── 3) Navigation wiring (static source inspection) ────────────────────────
describe('navigation wiring', () => {
  const clientNav = readSrc('navigation/ClientNavigator.tsx');
  const coachNav = readSrc('navigation/CoachNavigator.tsx');
  const rootNav = readSrc('navigation/RootNavigator.tsx');

  it('ClientNavigator registers ClientPackages + CheckoutReturn', () => {
    expect(clientNav).toMatch(/name="ClientPackages"\s+component=\{ClientPackagesScreen\}/);
    expect(clientNav).toMatch(/name="CheckoutReturn"\s+component=\{CheckoutReturnScreen\}/);
  });

  it('CoachNavigator registers CoachPackages + CoachEarnings', () => {
    expect(coachNav).toMatch(/name="CoachPackages"/);
    expect(coachNav).toMatch(/name="CoachEarnings"/);
    expect(coachNav).toMatch(/component=\{CoachPackagesScreen\}/);
    expect(coachNav).toMatch(/component=\{CoachEarningsScreen\}/);
  });

  it('RootNavigator deep-link config accepts tgp://checkout/{outcome}', () => {
    expect(rootNav).toMatch(/CheckoutReturn:\s*\{[\s\S]*?path:\s*'checkout\/:outcome'/);
  });

  it('MembershipScreen exposes a View coaching plans entry to ClientPackages', () => {
    const membership = readSrc('screens/client/MembershipScreen.tsx');
    expect(membership).toMatch(/ClientPackages/);
    expect(membership).toMatch(/VIEW COACHING PLANS/i);
  });

  it('Coach Settings Business section exposes Packages + Earnings rows', () => {
    const settings = readSrc('screens/coach/SettingsScreen.tsx');
    expect(settings).toMatch(/navigation\.navigate\('CoachPackages'\)/);
    expect(settings).toMatch(/navigation\.navigate\('CoachEarnings'\)/);
  });
});

// ── 4) Fee transparency copy ───────────────────────────────────────────────
describe('fee split copy', () => {
  const earnings = readSrc('screens/coach/CoachEarningsScreen.tsx');
  const packages = readSrc('screens/coach/CoachPackagesScreen.tsx');
  const metrics = readSrc('screens/coach/CoachBusinessMetricsScreen.tsx');

  it('Earnings screen shows the documented 2% platform fee row', () => {
    expect(earnings).toMatch(/Growth Project[^\n]*2%/);
  });

  it('Earnings screen shows the 5% head coach / gym override row', () => {
    expect(earnings).toMatch(/Head coach[^\n]*5%|5%[^\n]*head coach/i);
  });

  it('Packages editor explains the 2% TGP fee inline', () => {
    expect(packages).toMatch(/TGP fee 2%|platform fee is .{0,40}2%|2% of gross/i);
  });

  it('Business metrics screen clarifies fees are deducted on the Earnings screen', () => {
    expect(metrics).toMatch(/2%[^\n]*TGP|5%[^\n]*head coach|Earnings screen/i);
  });
});
