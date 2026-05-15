// Wire-shape tests for the Connect + Packages typed API clients. Mirrors
// the pattern in src/services/__tests__/billingAndAccountApi.test.ts: mock
// axios up front so the wrappers bind to a fake instance, then assert the
// URL + payload of every call.

jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    request: jest.fn(),
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
    patch: jest.Mock;
  };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connectApi } = require('../connectApi');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { coachPackagesApi, publicPackagesApi } = require('../packagesApi');

beforeEach(() => {
  axiosMock.__instance.get.mockReset().mockResolvedValue({ data: {} });
  axiosMock.__instance.post.mockReset().mockResolvedValue({ data: {} });
  axiosMock.__instance.patch.mockReset().mockResolvedValue({ data: {} });
});

describe('connectApi', () => {
  it('getStatus → GET /v1/connect/accounts/me', async () => {
    await connectApi.getStatus();
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/v1/connect/accounts/me');
  });

  it('createAccount with country → POST /v1/connect/accounts/create', async () => {
    await connectApi.createAccount({ country: 'US' });
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/v1/connect/accounts/create',
      { country: 'US' },
    );
  });

  it('createOnboardingLink → POST /v1/connect/accounts/onboarding-link', async () => {
    await connectApi.createOnboardingLink();
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/v1/connect/accounts/onboarding-link',
      {},
    );
  });

  it('createDashboardLink → POST /v1/connect/accounts/dashboard-link', async () => {
    await connectApi.createDashboardLink();
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/v1/connect/accounts/dashboard-link',
      {},
    );
  });
});

describe('coachPackagesApi', () => {
  it('list → GET /v1/coach/packages', async () => {
    await coachPackagesApi.list();
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/v1/coach/packages');
  });

  it('get(id) → GET /v1/coach/packages/:id', async () => {
    await coachPackagesApi.get('pkg_1');
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/v1/coach/packages/pkg_1');
  });

  it('create → POST /v1/coach/packages with body', async () => {
    const input = {
      title: 'Test',
      priceCents: 1000,
      billingInterval: 'monthly' as const,
    };
    await coachPackagesApi.create(input);
    expect(axiosMock.__instance.post).toHaveBeenCalledWith('/v1/coach/packages', input);
  });

  it('update(id, body) → PATCH /v1/coach/packages/:id', async () => {
    await coachPackagesApi.update('pkg_1', { priceCents: 1500 });
    expect(axiosMock.__instance.patch).toHaveBeenCalledWith(
      '/v1/coach/packages/pkg_1',
      { priceCents: 1500 },
    );
  });

  it('archive(id) → POST /v1/coach/packages/:id/archive', async () => {
    await coachPackagesApi.archive('pkg_1');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/v1/coach/packages/pkg_1/archive',
      {},
    );
  });

  it('subscribers(id) → GET /v1/coach/packages/:id/subscribers', async () => {
    await coachPackagesApi.subscribers('pkg_1');
    expect(axiosMock.__instance.get).toHaveBeenCalledWith(
      '/v1/coach/packages/pkg_1/subscribers',
    );
  });

  it('earnings → GET /v1/coach/earnings', async () => {
    await coachPackagesApi.earnings();
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/v1/coach/earnings');
  });
});

describe('publicPackagesApi', () => {
  it('getByShareToken → GET /v1/packages/:shareToken', async () => {
    await publicPackagesApi.getByShareToken('tok_abc');
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/v1/packages/tok_abc');
  });

  it('createCheckoutSession → POST /v1/packages/:shareToken/checkout', async () => {
    await publicPackagesApi.createCheckoutSession('tok_abc', { returnUrl: 'tgp://x' });
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/v1/packages/tok_abc/checkout',
      { returnUrl: 'tgp://x' },
    );
  });
});
