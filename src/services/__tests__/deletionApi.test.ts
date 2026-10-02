// Wire-shape tests for the in-app account deletion client (Apple 5.1.1(v)).
// Backend contract: growth-project-backend src/account-deletion (PR #608).

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
  __instance: { get: jest.Mock; post: jest.Mock };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deletionApi, RECENT_AUTH_HEADER, isAccountDeletedError } = require('../api');

describe('deletionApi', () => {
  beforeEach(() => {
    axiosMock.__instance.get.mockReset().mockResolvedValue({ data: {} });
    axiosMock.__instance.post.mockReset().mockResolvedValue({ data: {} });
  });

  it('issueRecentAuthToken posts a password proof without refresh-and-replay', async () => {
    await deletionApi.issueRecentAuthToken({ password: 'pw' });
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/auth/recent-auth-token',
      { password: 'pw' },
      expect.objectContaining({ skipAuthRefresh: true }),
    );
  });

  it('issueRecentAuthToken posts an Apple identity token proof', async () => {
    await deletionApi.issueRecentAuthToken({ provider: 'apple', provider_token: 'id-tok' });
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/auth/recent-auth-token',
      { provider: 'apple', provider_token: 'id-tok' },
      expect.anything(),
    );
  });

  it('requestDeletion sends X-Recent-Auth-Token and no body for password users', async () => {
    await deletionApi.requestDeletion('recent-tok');
    expect(RECENT_AUTH_HEADER).toBe('X-Recent-Auth-Token');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/me/delete-account',
      {},
      { headers: { 'X-Recent-Auth-Token': 'recent-tok' } },
    );
  });

  it('requestDeletion forwards the Apple authorization code for token revocation', async () => {
    await deletionApi.requestDeletion('recent-tok', 'apple-code');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/me/delete-account',
      { apple_authorization_code: 'apple-code' },
      { headers: { 'X-Recent-Auth-Token': 'recent-tok' } },
    );
  });

  it('getDeletionStatus and cancelDeletion hit the canonical routes', async () => {
    await deletionApi.getDeletionStatus();
    await deletionApi.cancelDeletion();
    expect(axiosMock.__instance.get).toHaveBeenCalledWith('/me/delete-account/status');
    expect(axiosMock.__instance.post).toHaveBeenCalledWith('/me/delete-account/cancel');
  });

  it('issueRecentAuthToken posts a Google session proof (B-313-1)', async () => {
    await deletionApi.issueRecentAuthToken({ provider: 'google_session', provider_token: 'sess' });
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/auth/recent-auth-token',
      { provider: 'google_session', provider_token: 'sess' },
      expect.objectContaining({ skipAuthRefresh: true }),
    );
  });

  it('isAccountDeletedError recognises only the 403 ACCOUNT_DELETED signal (B-313-5)', () => {
    const err = (status: number, data: unknown) => ({ response: { status, data } });
    expect(isAccountDeletedError(err(403, { code: 'ACCOUNT_DELETED' }))).toBe(true);
    expect(isAccountDeletedError(err(403, { code: 'FORBIDDEN' }))).toBe(false);
    expect(isAccountDeletedError(err(401, { code: 'ACCOUNT_DELETED' }))).toBe(false);
    expect(isAccountDeletedError(new Error('Network Error'))).toBe(false);
    expect(isAccountDeletedError(null)).toBe(false);
  });
});
