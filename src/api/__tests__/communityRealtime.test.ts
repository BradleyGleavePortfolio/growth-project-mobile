/**
 * RT-PRIVATE-M: community pings ride the signed-in person's PRIVATE topic
 * `community:user:<User.id>` (backend C10RT sends every ping privately and only
 * the topic's signed-in owner may receive it). Tested on the real seam: the
 * real communityRealtime + services/realtime modules over a mocked
 * @supabase/supabase-js, never an injected ping callback.
 */
let mockToken: string | null = 'token-a';
jest.mock('../../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => mockToken) } }));
jest.mock('../../config/env', () => ({ env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' } }));

type Handler = (msg?: unknown) => void;
interface MockChannel {
  topic: string;
  opts: unknown;
  handlers: Record<string, Handler>;
  status: (s: string) => void;
  on: (type: string, filter: { event: string }, cb: Handler) => MockChannel;
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
const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts: { realtime?: { accessToken?: () => Promise<string | null> } }) => {
    mockCreateClient(url, key, opts);
    mockRealtime.accessToken = opts?.realtime?.accessToken ?? null;
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
          subscribe: jest.fn((cb?: (s: string) => void) => {
            if (cb) ch.status = cb;
            return ch;
          }),
        };
        mockChannels.push(ch);
        return ch;
      },
    };
  },
}));

let cr: typeof import('../communityRealtime');
let rt: typeof import('../../services/realtime');
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const community = () => mockChannels.filter((c) => c.topic.startsWith('community:'));
const last = () => community()[community().length - 1];
const EVENTS = () => Object.values(cr.COMMUNITY_BROADCAST_EVENTS).sort();
let logSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockChannels.length = 0;
  mockRealtime.accessTokenValue = null;
  mockRealtime.accessToken = null;
  mockToken = 'token-a';
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m));
  rt = require('../../services/realtime');
  cr = require('../communityRealtime');
});

afterEach(() => {
  // The token is never logged, on any path.
  for (const spy of logSpies) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain('token-');
    spy.mockRestore();
  }
});

describe('subscribeToCommunityUser (private per-person topic)', () => {
  it('joins community:user:<id> privately, after setAuth with the signed-in token from secure storage', async () => {
    const off = cr.subscribeToCommunityUser('u1', jest.fn());
    await flush();
    expect(community()).toHaveLength(1);
    expect(last().topic).toBe('community:user:u1');
    expect(last().opts).toEqual({ config: { private: true, broadcast: { self: false } } });
    expect(Object.keys(last().handlers).sort()).toEqual(EVENTS());
    expect(mockRealtime.setAuth).toHaveBeenCalled();
    expect(mockRealtime.setAuth.mock.invocationCallOrder[0]).toBeLessThan(last().subscribe.mock.invocationCallOrder[0]);
    expect(mockRealtime.accessTokenValue).toBe('token-a');
    mockToken = 'token-refreshed';
    await expect(mockRealtime.accessToken?.()).resolves.toBe('token-refreshed');
    off();
  });

  it('signed out: no token, no join', async () => {
    mockToken = null;
    const off = cr.subscribeToCommunityUser('u1', jest.fn());
    await flush();
    expect(community()).toHaveLength(0);
    off();
  });

  it('each bound event reaches every listener with its name only; no payload reaches a handler', async () => {
    const a = jest.fn();
    const b = jest.fn();
    const offA = cr.subscribeToCommunityUser('u1', a);
    const offB = cr.subscribeToCommunityUser('u1', b);
    await flush();
    const ch = last();
    ch.status('SUBSCRIBED');
    const payload = { event: 'not-a-community-event', payload: { body: 'untrusted text', voice_note_id: 'v1' } };
    for (const event of EVENTS()) ch.handlers[event](payload);
    // No folding: two different event names are two calls, in order, to each listener.
    expect(a.mock.calls).toEqual(EVENTS().map((event) => [{ event }]));
    expect(b.mock.calls).toEqual(EVENTS().map((event) => [{ event }]));
    offA();
    offB();
  });

  it('two listeners share one channel; it goes only when the last one leaves', async () => {
    const offA = cr.subscribeToCommunityUser('u1', jest.fn());
    const b = jest.fn();
    const offB = cr.subscribeToCommunityUser('u1', b);
    await flush();
    expect(community()).toHaveLength(1);
    const ch = last();
    ch.status('SUBSCRIBED');
    offA();
    expect(mockRemove).not.toHaveBeenCalled();
    ch.handlers[cr.COMMUNITY_BROADCAST_EVENTS.messageCreated]();
    expect(b).toHaveBeenCalledWith({ event: 'community.message.created' });
    // A joined channel that drops with the network is kept: realtime-js rejoins it.
    ch.status('CHANNEL_ERROR');
    expect(mockRemove).not.toHaveBeenCalled();
    offB();
    expect(mockRemove).toHaveBeenCalledWith(ch);
  });

  it('sign-out: the last listener leaving removes the channel and clears Realtime auth', async () => {
    const off = cr.subscribeToCommunityUser('u1', jest.fn());
    await flush();
    expect(mockRealtime.accessTokenValue).toBe('token-a');
    mockToken = null; // signOut() removed the stored token before the screens unmounted
    off();
    await flush();
    expect(mockRemove).toHaveBeenCalledWith(community()[0]);
    expect(mockRealtime.accessTokenValue).toBeNull();
  });

  it("account switch: another person's id replaces the channel and joins with their token", async () => {
    const onPingA = jest.fn();
    cr.subscribeToCommunityUser('u1', onPingA);
    await flush();
    const first = last();
    mockToken = 'token-b';
    const off = cr.subscribeToCommunityUser('u2', jest.fn());
    await flush();
    expect(mockRemove).toHaveBeenCalledWith(first);
    expect(last().topic).toBe('community:user:u2');
    expect(mockRealtime.accessTokenValue).toBe('token-b');
    first.handlers[cr.COMMUNITY_BROADCAST_EVENTS.messageCreated]();
    expect(onPingA).not.toHaveBeenCalled();
    off();
  });

  it('a refused or failed join drops quietly (poll only); a token refresh joins again', async () => {
    for (const status of ['CHANNEL_ERROR', 'TIMED_OUT']) {
      mockChannels.length = 0;
      const onPing = jest.fn();
      const off = cr.subscribeToCommunityUser('u1', onPing);
      await flush();
      const refused = last();
      expect(() => refused.status(status)).not.toThrow();
      expect(mockRemove).toHaveBeenLastCalledWith(refused);
      await flush();
      expect(community().filter((c) => c !== refused)).toHaveLength(0); // no retry loop on the same token
      expect(onPing).not.toHaveBeenCalled();

      mockToken = `token-${status}`;
      rt.refreshRealtimeAuth(); // services/api.ts calls this after every token refresh
      await flush();
      const again = last();
      expect(again).not.toBe(refused);
      expect(again.topic).toBe('community:user:u1');
      expect(mockRealtime.accessTokenValue).toBe(`token-${status}`);
      again.status('SUBSCRIBED');
      again.handlers[cr.COMMUNITY_BROADCAST_EVENTS.postCreated]();
      expect(onPing).toHaveBeenCalledWith({ event: 'community.post.created' });
      off();
      await flush();
    }
    for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('a channel the server closes (expired token) drops quietly; a token refresh joins again', async () => {
    const onPing = jest.fn();
    const off = cr.subscribeToCommunityUser('u1', onPing);
    await flush();
    const ch = last();
    ch.status('SUBSCRIBED');
    mockToken = 'token-newer';
    rt.refreshRealtimeAuth(); // a joined channel keeps going with the new token
    await flush();
    expect(community()).toHaveLength(1);
    expect(mockRealtime.accessTokenValue).toBe('token-newer');

    ch.status('CLOSED');
    expect(mockRemove).toHaveBeenLastCalledWith(ch);
    rt.refreshRealtimeAuth();
    await flush();
    expect(community()).toHaveLength(2);
    last().handlers[cr.COMMUNITY_BROADCAST_EVENTS.membershipChanged]();
    expect(onPing).toHaveBeenCalledWith({ event: 'community.membership.changed' });
    off();
  });

  it('one Realtime client (one socket) for message and community pings; a refresh rejoins both', async () => {
    const offM = rt.subscribeToMessages('u1', jest.fn());
    const offC = cr.subscribeToCommunityUser('u1', jest.fn());
    await flush();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    const topics = mockChannels.map((c) => c.topic).sort();
    expect(topics).toEqual(['community:user:u1', 'messages:user:u1']);
    for (const c of mockChannels) c.status('CHANNEL_ERROR'); // both refused, e.g. an expired stored token
    mockToken = 'token-fresh';
    rt.refreshRealtimeAuth();
    await flush();
    expect(mockChannels.map((c) => c.topic).slice(2).sort()).toEqual(['community:user:u1', 'messages:user:u1']);
    offC();
    offM();
  });

  it('a throwing handler is contained and the other listeners still run', async () => {
    const after = jest.fn();
    const offA = cr.subscribeToCommunityUser('u1', () => {
      throw new Error('boom');
    });
    const offB = cr.subscribeToCommunityUser('u1', after);
    await flush();
    expect(() => last().handlers[cr.COMMUNITY_BROADCAST_EVENTS.reactionChanged]()).not.toThrow();
    expect(after).toHaveBeenCalledWith({ event: 'community.reaction.changed' });
    offA();
    offB();
  });

  it('no user id: nothing joins and the unsubscribe is a no-op', async () => {
    const off = cr.subscribeToCommunityUser('', jest.fn());
    await flush();
    expect(mockChannels).toHaveLength(0);
    expect(() => off()).not.toThrow();
  });
});
