// Covers the new API wrappers added for invite codes, messaging, and nudges.
// We mock the axios instance via a jest.doMock BEFORE requiring the module so
// the wrappers bind to our fake `api.get/post/delete`.

jest.mock('axios', () => {
  const request = jest.fn();
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    request,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
    },
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

// Must require AFTER the mock is installed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authApi, coachApi, messagesApi, nudgesApi } = require('../api');

describe('new API wrappers', () => {
  beforeEach(() => {
    axiosMock.__instance.get.mockReset().mockResolvedValue({ data: {} });
    axiosMock.__instance.post.mockReset().mockResolvedValue({ data: {} });
    axiosMock.__instance.delete.mockReset().mockResolvedValue({ data: {} });
  });

  describe('authApi', () => {
    it('validateInviteCode posts the code to /auth/validate-invite-code', async () => {
      await authApi.validateInviteCode('ABCD1234');
      expect(axiosMock.__instance.post).toHaveBeenCalledWith('/auth/validate-invite-code', {
        code: 'ABCD1234',
      });
    });

    it('register forwards invite_code when provided', async () => {
      await authApi.register({
        email: 'a@b.co',
        password: 'Password1!',
        name: 'Alice',
        invite_code: 'X1Y2Z3',
      });
      expect(axiosMock.__instance.post).toHaveBeenCalledWith('/auth/register', {
        email: 'a@b.co',
        password: 'Password1!',
        name: 'Alice',
        invite_code: 'X1Y2Z3',
      });
    });
  });

  describe('coachApi — invite codes', () => {
    it('listInviteCodes calls GET /coach/invite-codes', async () => {
      await coachApi.listInviteCodes();
      expect(axiosMock.__instance.get).toHaveBeenCalledWith('/coach/invite-codes');
    });
    it('createInviteCode posts body to /coach/invite-codes', async () => {
      await coachApi.createInviteCode({ max_uses: 10, expires_at: null });
      expect(axiosMock.__instance.post).toHaveBeenCalledWith('/coach/invite-codes', {
        max_uses: 10,
        expires_at: null,
      });
    });
    it('revokeInviteCode calls DELETE /coach/invite-codes/:id', async () => {
      await coachApi.revokeInviteCode('abc-123');
      expect(axiosMock.__instance.delete).toHaveBeenCalledWith('/coach/invite-codes/abc-123');
    });
  });

  describe('coachApi — messages', () => {
    it('getClientMessages supports before+limit query params', async () => {
      await coachApi.getClientMessages('client-1', { before: '2026-01-01T00:00:00Z', limit: 20 });
      const url = axiosMock.__instance.get.mock.calls[0][0];
      expect(url).toContain('/coach/clients/client-1/messages?');
      expect(url).toContain('before=');
      expect(url).toContain('limit=20');
    });
    it('getClientMessages without params hits the base URL', async () => {
      await coachApi.getClientMessages('client-1');
      expect(axiosMock.__instance.get).toHaveBeenCalledWith('/coach/clients/client-1/messages');
    });
    it('sendClientMessage posts body wrapped in { body }', async () => {
      await coachApi.sendClientMessage('client-1', 'hello');
      expect(axiosMock.__instance.post).toHaveBeenCalledWith(
        '/coach/clients/client-1/messages',
        { body: 'hello' },
      );
    });
    it('markClientThreadRead POSTs read endpoint', async () => {
      await coachApi.markClientThreadRead('client-1');
      expect(axiosMock.__instance.post).toHaveBeenCalledWith(
        '/coach/clients/client-1/messages/read',
      );
    });
    it('getUnreadCounts calls /coach/messages/unread-count', async () => {
      await coachApi.getUnreadCounts();
      expect(axiosMock.__instance.get).toHaveBeenCalledWith('/coach/messages/unread-count');
    });
  });

  describe('coachApi — nudges', () => {
    it('sendNudge posts title+body to nudges endpoint', async () => {
      await coachApi.sendNudge('client-1', { title: 'Good job', body: 'Keep it up' });
      expect(axiosMock.__instance.post).toHaveBeenCalledWith('/coach/clients/client-1/nudges', {
        title: 'Good job',
        body: 'Keep it up',
      });
    });
  });

  describe('messagesApi (client side)', () => {
    it('list passes before+limit when provided', async () => {
      await messagesApi.list({ before: '2026-01-01T00:00:00Z', limit: 50 });
      const url = axiosMock.__instance.get.mock.calls[0][0];
      expect(url).toContain('/messages?');
      expect(url).toContain('limit=50');
    });
    it('list without params hits /messages', async () => {
      await messagesApi.list();
      expect(axiosMock.__instance.get).toHaveBeenCalledWith('/messages');
    });
    it('send wraps the message in { body }', async () => {
      await messagesApi.send('hi coach');
      expect(axiosMock.__instance.post).toHaveBeenCalledWith('/messages', { body: 'hi coach' });
    });
    it('markRead + unreadCount call the right endpoints', async () => {
      await messagesApi.markRead();
      await messagesApi.unreadCount();
      expect(axiosMock.__instance.post).toHaveBeenCalledWith('/messages/read');
      expect(axiosMock.__instance.get).toHaveBeenCalledWith('/messages/unread-count');
    });
  });

  describe('nudgesApi (client side)', () => {
    it('list passes since+limit when provided', async () => {
      await nudgesApi.list({ since: '2026-01-01T00:00:00Z', limit: 25 });
      const url = axiosMock.__instance.get.mock.calls[0][0];
      expect(url).toContain('/nudges?');
      expect(url).toContain('limit=25');
    });
    it('unreadCount hits /nudges/unread-count', async () => {
      await nudgesApi.unreadCount();
      expect(axiosMock.__instance.get).toHaveBeenCalledWith('/nudges/unread-count');
    });
    it('markRead hits /nudges/:id/read', async () => {
      await nudgesApi.markRead('nudge-42');
      expect(axiosMock.__instance.post).toHaveBeenCalledWith('/nudges/nudge-42/read');
    });
  });
});
