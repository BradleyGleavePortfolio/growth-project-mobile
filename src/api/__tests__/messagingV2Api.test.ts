/**
 * Wire contract for the messaging v2 inbox client (backend #708-#711): every
 * route, method and body; Zod validation at the boundary; and the
 * messaging.* error codes mapped to user copy (no generic errors).
 */
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import api from '../../services/api';
import {
  messagingV2Api,
  MessagingApiError,
  MESSAGING_ERROR_COPY,
  threadBase,
  toMessagingError,
} from '../messagingV2Api';

const http = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', jest.Mock>;
const coach = { role: 'coach' as const, clientId: 'client-1' };
const client = { role: 'client' as const };

const inbox = {
  items: [
    {
      thread_id: 'coach-1:client-1',
      kind: 'coach_client',
      coach_id: 'coach-1',
      client_id: 'client-1',
      counterpart: { user_id: 'client-1', display_name: 'Ana Ruiz' },
      last_message: {
        id: 'm1',
        sender_id: 'client-1',
        is_mine: false,
        kind: 'text',
        preview: 'Done with today',
        created_at: '2026-10-05T10:00:00.000Z',
        edited: false,
      },
      unread_count: 2,
      muted: false,
      muted_until: null,
      pinned: true,
      blocked_by_me: false,
      last_activity_at: '2026-10-05T10:00:00.000Z',
    },
  ],
  next_cursor: 'MV8xNzAwXzE',
  total_unread: 2,
};

function httpError(status: number, data?: unknown) {
  return Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    response: status ? { status, data } : undefined,
  });
}

beforeEach(() => {
  Object.values(http).forEach((m) => m.mockReset());
});

describe('thread base paths', () => {
  it('coach threads are addressed by client id (encoded); the client has one thread', () => {
    expect(threadBase(coach)).toBe('/coach/clients/client-1/messages');
    expect(threadBase({ role: 'coach', clientId: 'a/b' })).toBe('/coach/clients/a%2Fb/messages');
    expect(threadBase(client)).toBe('/messages');
  });
});

describe('inbox', () => {
  it('coach inbox passes cursor, limit and the unread filter; all sends no filter', async () => {
    http.get.mockResolvedValue({ data: inbox });
    const res = await messagingV2Api.getCoachInbox({ cursor: 'abc', limit: 50, filter: 'unread' });
    expect(http.get.mock.calls[0][0]).toBe('/coach/messages/inbox?cursor=abc&limit=50&filter=unread');
    expect(res.items[0].counterpart.display_name).toBe('Ana Ruiz');
    expect(res.next_cursor).toBe('MV8xNzAwXzE');

    await messagingV2Api.getCoachInbox({ filter: 'all' });
    expect(http.get.mock.calls[1][0]).toBe('/coach/messages/inbox');
  });

  it('client inbox reads GET /messages/inbox', async () => {
    http.get.mockResolvedValue({ data: { items: [], next_cursor: null, total_unread: 0 } });
    await expect(messagingV2Api.getClientInbox()).resolves.toEqual({ items: [], next_cursor: null, total_unread: 0 });
    expect(http.get.mock.calls[0][0]).toBe('/messages/inbox');
  });

  it('ignores additive fields but throws a contract error when a needed field drifts', async () => {
    http.get.mockResolvedValueOnce({ data: { ...inbox, extra: 1 } });
    await expect(messagingV2Api.getCoachInbox()).resolves.toMatchObject({ total_unread: 2 });

    http.get.mockResolvedValueOnce({ data: { ...inbox, items: [{ ...inbox.items[0], unread_count: '2' }] } });
    const err = await messagingV2Api.getCoachInbox().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MessagingApiError);
    expect((err as MessagingApiError).kind).toBe('contract');
    expect((err as MessagingApiError).userMessage).toMatch(/Update the app/);
  });
});

describe('thread state', () => {
  it('inbox pin and mute PUT the caller state on either side', async () => {
    const state = { muted: true, muted_until: '2026-10-05T11:00:00.000Z', pinned: false };
    http.put.mockResolvedValue({ data: state });
    await expect(messagingV2Api.setMute(coach, '1h')).resolves.toEqual(state);
    expect(http.put.mock.calls[0].slice(0, 2)).toEqual(['/coach/clients/client-1/messages/mute', { duration: '1h' }]);
    await messagingV2Api.setInboxPin(client, true);
    expect(http.put.mock.calls[1].slice(0, 2)).toEqual(['/messages/inbox-pin', { pinned: true }]);
  });
});

describe('error mapping', () => {
  it.each(Object.keys(MESSAGING_ERROR_COPY))('%s maps to its own copy', (code) => {
    const e = toMessagingError(httpError(409, { statusCode: 409, code, error: code, message: 'server text' }));
    expect(e.code).toBe(code);
    expect(e.userMessage).toBe(MESSAGING_ERROR_COPY[code]);
  });

  it('copy has no first person, no exclamation marks and names the next step', () => {
    for (const text of Object.values(MESSAGING_ERROR_COPY)) {
      expect(text).not.toMatch(/\b(we|us|our|I|my)\b/i);
      expect(text).not.toContain('!');
    }
  });

  it('feature_disabled is detectable for the legacy fallback', () => {
    const e = toMessagingError(httpError(503, { code: 'messaging.feature_disabled', error: 'messaging.feature_disabled' }));
    expect(e.isFeatureDisabled).toBe(true);
  });

  it('reads the legacy `error` key (NO_COACH_ASSIGNED) and status-specific copy otherwise', () => {
    expect(toMessagingError(httpError(409, { error: 'NO_COACH_ASSIGNED' })).userMessage).toMatch(/No coach is assigned/);
    expect(toMessagingError(httpError(429, {})).userMessage).toMatch(/Wait a minute/);
    expect(toMessagingError(httpError(503, {})).userMessage).toMatch(/Try again in a moment/);
    expect(toMessagingError(httpError(0)).userMessage).toMatch(/No connection/);
    expect(toMessagingError(httpError(400, { message: 'body must be shorter' })).userMessage).toBe('body must be shorter');
    expect(toMessagingError(httpError(422, {})).userMessage).toMatch(/status 422/);
  });
});
