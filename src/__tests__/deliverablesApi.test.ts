/**
 * clientPaymentsApi.getPurchaseDrops — PR-13 typed contract tests.
 *
 * Lives in a separate file from the screen RTL tests so the module
 * `jest.mock('../api/clientPaymentsApi', ...)` in the screen test does
 * not collide with these direct calls to the real implementation.
 */

import { clientPaymentsApi } from '../api/clientPaymentsApi';
import api from '../services/api';

jest.mock('../services/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  return {
    __esModule: true,
    default: { get, post, patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  };
});

const mockedApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
};

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
});

describe('clientPaymentsApi.getPurchaseDrops — typed contract', () => {
  it('GETs /v1/checkout/purchases/:id/drops and unwraps the {drops} envelope', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        drops: [
          {
            id: 'drop_1',
            asset_type: 'workout_program',
            asset_id: 'prog_1',
            asset_revision_id: null,
            cadence_kind: 'immediate',
            display_title: 'Week 1',
            display_caption: null,
            fire_at: null,
            fired_at: '2026-05-01T10:00:00Z',
            status: 'fired',
            materialised_ref: 'assignment_1',
          },
        ],
      },
    });
    const res = await clientPaymentsApi.getPurchaseDrops('purchase_42');
    expect(mockedApi.get).toHaveBeenCalledWith(
      '/v1/checkout/purchases/purchase_42/drops',
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0].status).toBe('fired');
      expect(res.data[0].materialised_ref).toBe('assignment_1');
    }
  });

  it('also accepts a bare array (no envelope)', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [
        {
          id: 'd',
          asset_type: 'meal_plan',
          asset_id: 'mp_1',
          asset_revision_id: null,
          cadence_kind: 'immediate',
          display_title: null,
          display_caption: null,
          fire_at: null,
          fired_at: '2026-05-01T10:00:00Z',
          status: 'fired',
          materialised_ref: '2026-05-01',
        },
      ],
    });
    const res = await clientPaymentsApi.getPurchaseDrops('p');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(1);
  });

  it('encodes path components defensively', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { drops: [] } });
    await clientPaymentsApi.getPurchaseDrops('a b/c');
    expect(mockedApi.get).toHaveBeenCalledWith(
      '/v1/checkout/purchases/a%20b%2Fc/drops',
    );
  });

  it('surfaces a 501 as not_configured (calm empty state)', async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { status: 501 },
      message: 'Not implemented',
    });
    const res = await clientPaymentsApi.getPurchaseDrops('p');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_configured');
  });

  it('maps a 404 on the documented-prereq drops route to not_configured (PR-13 audit P2-1)', async () => {
    // Scoped exception to PR-1's "404 is never not_configured" rule:
    // the buyer-facing drops endpoint is a documented backend prereq
    // (PR13_BUILD_REPORT.md) that does not exist yet. As defense-in-
    // depth — on top of the production feature flag that hides the
    // CTA entirely — a 404 here renders the calm "No deliverables yet"
    // empty state, NOT a "Request failed with status code 404" banner
    // (Rule 9 / Rule 17). The PR-1 sin was different in kind: a route
    // TYPO that 404'd silently. This route is publicly tracked.
    mockedApi.get.mockRejectedValueOnce({
      response: { status: 404 },
      message: 'Request failed with status code 404',
    });
    const res = await clientPaymentsApi.getPurchaseDrops('p');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_configured');
  });

  it('a 5xx remains a retryable error (only 404 + 501 collapse to not_configured)', async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { status: 503 },
      message: 'Service unavailable',
    });
    const res = await clientPaymentsApi.getPurchaseDrops('p');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('error');
  });

  it('a network failure (no response) remains a retryable error', async () => {
    mockedApi.get.mockRejectedValueOnce({
      message: 'Network Error',
    });
    const res = await clientPaymentsApi.getPurchaseDrops('p');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('error');
  });

  it('exposes ClientPaymentStatus.purchase_id for the Deliverables entry', async () => {
    // PR-13 plumbing: getPaymentStatus must surface the active
    // ClientPurchase.id so ClientPackagesScreen can deep-link into the
    // per-purchase Deliverables view without a second round trip.
    mockedApi.get
      .mockResolvedValueOnce({
        data: {
          purchases: [
            {
              id: 'cp_active',
              package_id: 'pkg_1',
              status: 'active',
              entitlement_active: true,
              access_expires_at: null,
              current_period_end: '2026-06-01T00:00:00Z',
              cancel_at_period_end: false,
              canceled_at: null,
              created_at: '2026-05-01T00:00:00Z',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'pkg_1',
            name: '1:1 Coaching',
            description: null,
            type: 'recurring',
            price: 199,
            currency: 'USD',
            interval: 'month',
            features: [],
          },
        ],
      });
    const res = await clientPaymentsApi.getPaymentStatus();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.purchase_id).toBe('cp_active');
      expect(res.data.package_id).toBe('pkg_1');
      expect(res.data.state).toBe('active');
    }
  });
});
