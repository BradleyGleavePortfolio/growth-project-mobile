// Wire-shape tests for the coach billing endpoints and the user account
// status / cancel-deletion endpoints added alongside the coach Settings
// surface. The patterns here mirror apiClients.test.ts: we mock axios up
// front so the wrappers bind to a fake instance, then assert the URL +
// payload of every call.

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
    delete: jest.Mock;
  };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { coachBillingApi, usersApi } = require('../api');

describe('coachBillingApi', () => {
  beforeEach(() => {
    axiosMock.__instance.get.mockReset().mockResolvedValue({ data: {} });
    axiosMock.__instance.post.mockReset().mockResolvedValue({ data: {} });
  });

  it('getStatus calls GET /coach/billing/status', async () => {
    await coachBillingApi.getStatus();
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/coach/billing/status');
  });

  it('createPortalSession with no return path posts an empty body', async () => {
    await coachBillingApi.createPortalSession();
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/coach/billing/portal-session',
      {},
    );
  });

  it('createPortalSession forwards return_path when provided', async () => {
    await coachBillingApi.createPortalSession('/coach/settings');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/coach/billing/portal-session',
      { return_path: '/coach/settings' },
    );
  });
});

describe('usersApi — account status & cancel-deletion', () => {
  beforeEach(() => {
    axiosMock.__instance.get.mockReset().mockResolvedValue({ data: {} });
    axiosMock.__instance.post.mockReset().mockResolvedValue({ data: {} });
    axiosMock.__instance.delete.mockReset().mockResolvedValue({ data: {} });
  });

  it('getAccountStatus calls GET /users/me/account/status', async () => {
    await usersApi.getAccountStatus();
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/users/me/account/status');
  });

  it('cancelAccountDeletion POSTs /users/me/account/cancel-deletion', async () => {
    await usersApi.cancelAccountDeletion();
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/users/me/account/cancel-deletion',
    );
  });

  it('deleteAccount DELETEs /users/me/account (existing contract preserved)', async () => {
    await usersApi.deleteAccount();
    expect(axiosMock.__instance.delete).toHaveBeenCalledWith('/users/me/account');
  });
});
