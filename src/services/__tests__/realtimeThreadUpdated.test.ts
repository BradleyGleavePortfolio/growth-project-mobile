/**
 * MSGRT-M: message pings ride the signed-in person's PRIVATE topic
 * `messages:user:<User.id>`, joined with their Supabase access token. Every
 * screen shares one channel; pings are debounced (trailing); a refused or
 * failed join is poll-only and silent until the next token refresh; the
 * channel goes, and Realtime auth is read again (empty after sign-out), when
 * the last listener leaves.
 */
let mockToken: string | null = 'token-a';
jest.mock('../secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => mockToken) } }));
jest.mock('../../config/env', () => ({ env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' } }));

interface MockChannel {
  topic: string;
  opts: unknown;
  handlers: Record<string, () => void>;
  status: (s: string) => void;
  on: (type: string, filter: { event: string }, cb: () => void) => MockChannel;
  subscribe: jest.Mock;
}
const mockChannels: MockChannel[] = [];
const mockRealtime = {
  accessTokenValue: null as string | null,
  accessToken: null as null | (() => Promise<string | null>),
  setAuth: jest.fn(async () => {
    mockRealtime.accessTokenValue = mockRealtime.accessToken ? await mockRealtime.accessToken() : null;
  }),
};
const mockRemove = jest.fn(async (_c: MockChannel) => 'ok');
jest.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts: { realtime: { accessToken: () => Promise<string | null> } }) => {
    mockRealtime.accessToken = opts.realtime.accessToken;
    return {
      realtime: mockRealtime,
      removeChannel: mockRemove,
      channel: (topic: string, opts: unknown) => {
        const ch: MockChannel = {
          topic,
          opts,
          handlers: {},
          status: () => undefined,
          on: (_type, filter, cb) => {
            ch.handlers[filter.event] = cb;
            return ch;
          },
          subscribe: jest.fn((cb: (s: string) => void) => {
            ch.status = cb;
            return ch;
          }),
        };
        mockChannels.push(ch);
        return ch;
      },
    };
  },
}));

let rt: typeof import('../realtime');
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const last = () => mockChannels[mockChannels.length - 1];
let logSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  jest.clearAllMocks();
  mockChannels.length = 0;
  mockRealtime.accessTokenValue = null;
  mockToken = 'token-a';
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m));
  rt = require('../realtime');
});

afterEach(() => {
  // The token is never logged, on any path.
  for (const spy of logSpies) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain('token-');
    spy.mockRestore();
  }
  jest.useRealTimers();
});

describe('subscribeToMessages (private per-person topic)', () => {
  it('joins messages:user:<id> privately, after setAuth with the signed-in token from secure storage', async () => {
    const off = rt.subscribeToMessages('u1', jest.fn(), jest.fn());
    await flush();
    expect(mockChannels).toHaveLength(1);
    expect(last().topic).toBe('messages:user:u1');
    expect(last().opts).toEqual({ config: { private: true, broadcast: { self: false } } });
    expect(Object.keys(last().handlers).sort()).toEqual(['new-message', 'thread-updated']);
    expect(mockRealtime.setAuth.mock.invocationCallOrder[0]).toBeLessThan(last().subscribe.mock.invocationCallOrder[0]);
    expect(mockRealtime.accessTokenValue).toBe('token-a');
    // realtime-js asks this callback again on every heartbeat: a refreshed token is what it reads next.
    mockToken = 'token-refreshed';
    await expect(mockRealtime.accessToken?.()).resolves.toBe('token-refreshed');
    off();
  });

  it('one shared channel; a burst of pings is one call per event; the channel goes with the last listener', async () => {
    const onPing = jest.fn();
    const onUpdate = jest.fn();
    const legacy = jest.fn();
    const offA = rt.subscribeToMessages('u1', onPing, onUpdate);
    const offB = rt.subscribeToMessages('u1', legacy);
    await flush();
    expect(mockChannels).toHaveLength(1);
    const ch = last();
    ch.status('SUBSCRIBED');

    for (let i = 0; i < 100; i++) ch.handlers['new-message']();
    jest.advanceTimersByTime(rt.PING_DEBOUNCE_MS - 1);
    expect(onPing).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onPing).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();

    ch.handlers['thread-updated']();
    ch.handlers['thread-updated']();
    jest.advanceTimersByTime(rt.PING_DEBOUNCE_MS);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledTimes(1); // no onThreadUpdated: not called for thread-updated

    // A joined channel that drops (network) is kept: realtime-js rejoins it.
    ch.status('CHANNEL_ERROR');
    offA();
    expect(mockRemove).not.toHaveBeenCalled();
    offB();
    expect(mockRemove).toHaveBeenCalledWith(ch);
  });

  it('a refused or failed join is poll-only: the channel is removed silently and no handler runs', async () => {
    for (const status of ['CHANNEL_ERROR', 'TIMED_OUT']) {
      const onPing = jest.fn();
      const off = rt.subscribeToMessages('u1', onPing);
      await flush();
      const ch = last();
      expect(() => ch.status(status)).not.toThrow();
      expect(mockRemove).toHaveBeenLastCalledWith(ch);
      jest.advanceTimersByTime(rt.PING_DEBOUNCE_MS);
      expect(onPing).not.toHaveBeenCalled();
      off();
      await flush();
    }
    for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('after a token refresh: a refused or server-closed channel joins again; a joined one gets the new token', async () => {
    const onPing = jest.fn();
    const off = rt.subscribeToMessages('u1', onPing);
    await flush();
    const refused = last();
    refused.status('CHANNEL_ERROR'); // for example the stored token had expired
    expect(mockRemove).toHaveBeenCalledWith(refused);

    mockToken = 'token-new';
    rt.refreshRealtimeAuth();
    await flush();
    expect(mockChannels).toHaveLength(2);
    expect(last().topic).toBe('messages:user:u1');
    expect(mockRealtime.accessTokenValue).toBe('token-new');
    last().status('SUBSCRIBED');

    mockToken = 'token-newer';
    rt.refreshRealtimeAuth();
    await flush();
    expect(mockRealtime.accessTokenValue).toBe('token-newer');
    expect(mockChannels).toHaveLength(2);

    last().status('CLOSED'); // the server ends a channel whose token expired
    expect(mockRemove).toHaveBeenLastCalledWith(mockChannels[1]);
    rt.refreshRealtimeAuth();
    await flush();
    expect(mockChannels).toHaveLength(3);
    last().handlers['new-message']();
    jest.advanceTimersByTime(rt.PING_DEBOUNCE_MS);
    expect(onPing).toHaveBeenCalledTimes(1);
    off();
  });

  it('a token refresh while the join is pending: the refused join tries again with the new token', async () => {
    const off = rt.subscribeToMessages('u1', jest.fn());
    await flush();
    const pending = last();
    mockToken = 'token-new';
    rt.refreshRealtimeAuth();
    await flush();
    expect(mockChannels).toHaveLength(1);
    pending.status('CHANNEL_ERROR'); // refused: it went out with the expired token
    await flush();
    expect(mockRemove).toHaveBeenCalledWith(pending);
    expect(mockChannels).toHaveLength(2);
    last().status('CHANNEL_ERROR'); // refused with the same token: poll only, no loop
    await flush();
    expect(mockChannels).toHaveLength(2);
    off();
  });

  it('signed out: no token, no join', async () => {
    mockToken = null;
    const off = rt.subscribeToMessages('u1', jest.fn());
    await flush();
    expect(mockChannels).toHaveLength(0);
    off();
  });

  it('sign-out: the last listener leaving removes the channel and clears Realtime auth', async () => {
    const off = rt.subscribeToMessages('u1', jest.fn());
    await flush();
    expect(mockRealtime.accessTokenValue).toBe('token-a');
    mockToken = null; // signOut() removed the stored token before the screens unmounted
    off();
    await flush();
    expect(mockRemove).toHaveBeenCalledWith(mockChannels[0]);
    expect(mockRealtime.accessTokenValue).toBeNull();
  });

  it("account switch: another person's id replaces the channel and joins with their token", async () => {
    const onPingA = jest.fn();
    rt.subscribeToMessages('u1', onPingA);
    await flush();
    const first = last();
    mockToken = 'token-b';
    const off = rt.subscribeToMessages('u2', jest.fn());
    await flush();
    expect(mockRemove).toHaveBeenCalledWith(first);
    expect(last().topic).toBe('messages:user:u2');
    expect(mockRealtime.accessTokenValue).toBe('token-b');
    first.handlers['new-message']();
    jest.advanceTimersByTime(rt.PING_DEBOUNCE_MS);
    expect(onPingA).not.toHaveBeenCalled();
    off();
  });

  it('a throwing handler is contained and the other listeners still run', async () => {
    const after = jest.fn();
    const offA = rt.subscribeToMessages('u1', () => {
      throw new Error('boom');
    });
    const offB = rt.subscribeToMessages('u1', after);
    await flush();
    last().handlers['new-message']();
    expect(() => jest.advanceTimersByTime(rt.PING_DEBOUNCE_MS)).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});
