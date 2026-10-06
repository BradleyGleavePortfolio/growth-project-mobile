// S-FEE round 4 (#321: B-321-2, B-321-3, publish/unpublish): the package
// bodies mobile sends match backend CreatePackageDto / UpdatePackageDto,
// which run under ValidationPipe({ whitelist, forbidNonWhitelisted }).
// Any field outside the whitelist is a 400, so the contract is exact.

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
};

import {
  coachPackagesApi,
  toBackendCreate,
  toBackendUpdate,
  type PackageBillingInterval,
} from '../packagesApi';

// growth-project-backend src/packages/packages.dto.ts (#629 round 4).
const DTO_FIELDS = new Set([
  'name',
  'description',
  'amount_cents',
  'currency',
  'billing_type',
  'billing_interval',
  'billing_interval_count',
  'duration_periods',
  'recurring_amount_cents',
  'recurring_interval',
  'recurring_interval_count',
  'is_active',
]);
const BACKEND_INTERVALS = new Set(['week', 'month', 'year']);
const OPTIONS: PackageBillingInterval[] = ['one_time', 'monthly', 'quarterly', 'yearly'];

function unknownFields(body: object): string[] {
  return Object.keys(body).filter((k) => !DTO_FIELDS.has(k));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('create body contract (B-321-2)', () => {
  it.each(OPTIONS)('%s: name, amount_cents, currency and billing_type, nothing else the DTO rejects', (opt) => {
    const body = toBackendCreate({
      title: 'Strength',
      description: 'Lift',
      priceCents: 4900,
      billingInterval: opt,
      intervalCount: 1,
      trialDays: 7,
      features: ['Check-ins'],
    });
    expect(body.name).toBe('Strength');
    expect(body.amount_cents).toBe(4900);
    expect(body.currency).toBe('usd');
    expect(body.billing_type).toBe(opt === 'one_time' ? 'one_time' : 'recurring');
    expect(unknownFields(body)).toEqual([]);
    if (opt === 'one_time') {
      expect(body.billing_interval).toBeUndefined();
    } else {
      expect(BACKEND_INTERVALS.has(String(body.billing_interval))).toBe(true);
      expect(Number.isInteger(body.billing_interval_count)).toBe(true);
    }
  });

  it('keeps an explicit currency, lower-cased to the backend enum', () => {
    const body = toBackendCreate({ title: 'A', priceCents: 1999, billingInterval: 'one_time', currency: 'GBP' });
    expect(body.currency).toBe('gbp');
  });

  it('the POST the editor sends carries currency', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { id: 'p1', name: 'A', amount_cents: 1999 } });
    await coachPackagesApi.create({ title: 'A', priceCents: 1999, billingInterval: 'monthly' });
    const [, body] = apiMock.post.mock.calls[0];
    expect(body.currency).toBe('usd');
  });
});

describe('update body contract (B-321-3)', () => {
  it('switching to one-time sends billing_type one_time and billing_interval null', () => {
    const body = toBackendUpdate({ billingInterval: 'one_time', intervalCount: 1 });
    // B-345-1 (wizard train): the count is cleared too (backend resets it to 1).
    expect(body).toEqual({ billing_type: 'one_time', billing_interval: null, billing_interval_count: null });
    expect(unknownFields(body)).toEqual([]);
  });

  it.each([
    ['monthly', 'month', 1],
    ['quarterly', 'month', 3],
    ['yearly', 'year', 1],
  ] as const)('switching to %s sends the backend cadence', (opt, interval, count) => {
    const body = toBackendUpdate({ billingInterval: opt, intervalCount: 1 });
    expect(body).toEqual({
      billing_type: 'recurring',
      billing_interval: interval,
      billing_interval_count: count,
    });
  });

  it('an edit without billingInterval leaves billing alone', () => {
    const body = toBackendUpdate({ title: 'Renamed', priceCents: 2500 });
    expect(body).toEqual({ name: 'Renamed', amount_cents: 2500 });
  });

  it('every update field is on the DTO whitelist', () => {
    const body = toBackendUpdate({
      title: 'A',
      description: null,
      priceCents: 1999,
      currency: 'USD',
      billingInterval: 'yearly',
      intervalCount: 1,
      trialDays: 3,
      features: ['x'],
      status: 'active',
    });
    expect(unknownFields(body)).toEqual([]);
    expect(body.currency).toBe('usd');
  });
});

describe('reading the backend row (round 4)', () => {
  it('maps interval/interval_count/published_at from the real CoachPackage row', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: [
        { id: 'y', coach_id: 'c1', name: 'Year', amount_cents: 99000, billing_type: 'recurring', interval: 'year', interval_count: 1, is_active: true, published_at: '2026-09-01T00:00:00Z' },
        { id: 'q', name: 'Quarter', amount_cents: 25000, billing_type: 'recurring', interval: 'month', interval_count: 3, is_active: true, published_at: '2026-09-01T00:00:00Z' },
        { id: 'd', name: 'Draft', amount_cents: 1999, billing_type: 'one_time', interval: null, interval_count: 1, is_active: true, published_at: null },
        { id: 'a', name: 'Old', amount_cents: 1999, billing_type: 'one_time', is_active: true, published_at: null, archived_at: '2026-09-02T00:00:00Z' },
      ],
    });
    const res = await coachPackagesApi.list();
    const by = Object.fromEntries(res.data.map((p) => [p.id, p]));
    expect(by.y.billingInterval).toBe('yearly');
    expect(by.y.coachUserId).toBe('c1');
    expect(by.y.status).toBe('active');
    expect(by.q.billingInterval).toBe('quarterly');
    expect(by.d.status).toBe('draft');
    expect(by.d.billingInterval).toBe('one_time');
    expect(by.a.status).toBe('archived');
  });
});

describe('publish / unpublish', () => {
  it('publish → POST /v1/coach/packages/:id/publish with an idempotency key', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: { id: 'pkg 1', name: 'A', amount_cents: 1999, published_at: '2026-10-01T00:00:00Z' },
    });
    const res = await coachPackagesApi.publish('pkg 1');
    const [url, body, config] = apiMock.post.mock.calls[0];
    expect(url).toBe('/v1/coach/packages/pkg%201/publish');
    expect(body).toEqual({});
    expect(config?.headers?.['Idempotency-Key']).toBeTruthy();
    expect(res.data.status).toBe('active');
  });

  it('unpublish → POST /v1/coach/packages/:id/unpublish and the row reads as a draft', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: { id: 'pkg_1', name: 'A', amount_cents: 1999, published_at: null },
    });
    const res = await coachPackagesApi.unpublish('pkg_1');
    const [url] = apiMock.post.mock.calls[0];
    expect(url).toBe('/v1/coach/packages/pkg_1/unpublish');
    expect(res.data.status).toBe('draft');
  });
});
