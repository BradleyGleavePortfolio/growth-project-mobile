/**
 * Mobile #331 Sol A-331-7 (round 3): the one-time copy of a legacy
 * AsyncStorage session value into SecureStore (first read after an upgrade)
 * is ordered by sessionFence like every other session-key write. A sign-in
 * or sign-out that runs while the copy is paused (in its legacy read or in
 * its native write) never ends with a mixed pair or a signed-out session
 * back.
 *
 * REAL: services/api.ts (axios instance and interceptors), the secureStorage
 * adapter and sessionFence. Doubled: native SecureStore and AsyncStorage
 * (in-memory stores whose single operations can be paused), the transport
 * adapter (records what would be sent; no network) and the Supabase refresh
 * call. Tokens are synthetic unsigned JWTs.
 */
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

type Op = 'get' | 'set' | 'delete' | 'legacy_get';
interface Pause {
  op: Op;
  key: string;
  reached: () => void;
  gate: Promise<void>;
}
const mockNative = {
  secure: new Map<string, string>(),
  legacy: new Map<string, string>(),
  pauses: [] as Pause[],
  legacyReads: 0,
};
async function mockMaybePause(op: Op, key: string): Promise<void> {
  const i = mockNative.pauses.findIndex((p) => p.op === op && p.key === key);
  if (i < 0) return;
  const [p] = mockNative.pauses.splice(i, 1);
  p.reached();
  await p.gate;
}

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => {
    const v = mockNative.secure.get(k) ?? null; // value as of when the read was issued
    await mockMaybePause('get', k);
    return v;
  }),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    await mockMaybePause('set', k);
    mockNative.secure.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    await mockMaybePause('delete', k);
    mockNative.secure.delete(k);
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => {
      mockNative.legacyReads += 1;
      const v = mockNative.legacy.get(k) ?? null; // value as of when the read was issued
      await mockMaybePause('legacy_get', k);
      return v;
    }),
    setItem: jest.fn(async (k: string, v: string) => {
      mockNative.legacy.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockNative.legacy.delete(k);
    }),
  },
}));

import api, { __resetRefreshStateForTests, __setRefreshSessionForTests, __setSignOutForTests } from '../api';
import { secureStorage, __resetSecureStorageForTests } from '../secureStorage';
import { __resetSessionFenceForTests, sessionFenceHeld } from '../sessionFence';
import { authEvents } from '../../utils/authEvents';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function jwt(sub: string, n = 0): string {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ sub, n }))}.sig`;
}
const A = jwt('user-a'); // A's access token, stored by a pre-SecureStore build
const A2 = jwt('user-a', 2); // A's refreshed access token
const B = jwt('user-b');

/** Pause the next native op on `key`; resolves `reached` when it starts. */
function pauseNext(op: Op, key: string): { reached: Promise<void>; release: () => void } {
  let release!: () => void;
  let reached!: () => void;
  const reachedP = new Promise<void>((r) => (reached = r));
  const gate = new Promise<void>((r) => (release = r));
  mockNative.pauses.push({ op, key, reached, gate });
  return { reached: reachedP, release };
}

/** What every sign-in screen does (LoginScreen / CreateAccount / Apple / Google). */
async function signIn(access: string, refresh: string): Promise<void> {
  await secureStorage.setItem('supabase_token', access);
  await secureStorage.setItem('supabase_refresh_token', refresh);
  authEvents.emit();
}
/** What authActions.signOut does to the session keys. */
async function signOutKeys(): Promise<void> {
  await Promise.all([secureStorage.removeItem('supabase_token'), secureStorage.removeItem('supabase_refresh_token')]);
  authEvents.emit('logout');
}

let sent: { url: string; authorization: string | undefined }[];
let respond: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;
const adapter: AxiosAdapter = (config) => {
  sent.push({ url: config.url ?? '', authorization: config.headers?.Authorization as string | undefined });
  return respond(config);
};
function ok(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  return Promise.resolve({ data: {}, status: 200, statusText: '', headers: {}, config });
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await tick();
}

let refreshCalls: string[];

beforeEach(() => {
  __resetRefreshStateForTests();
  __resetSecureStorageForTests();
  __resetSessionFenceForTests();
  api.defaults.adapter = adapter;
  sent = [];
  refreshCalls = [];
  mockNative.pauses = [];
  mockNative.legacyReads = 0;
  // An install upgraded from a build that kept A's session in AsyncStorage.
  mockNative.secure = new Map();
  mockNative.legacy = new Map([
    ['supabase_token', A],
    ['supabase_refresh_token', 'refresh-a'],
  ]);
  respond = ok;
  __setRefreshSessionForTests(async ({ refresh_token }) => {
    refreshCalls.push(refresh_token);
    return { data: { session: { access_token: A2, refresh_token: 'refresh-a2' } }, error: null };
  });
  __setSignOutForTests(async (_userId, opts) => {
    await Promise.all([
      secureStorage.removeItem('supabase_token', opts?.sessionFence),
      secureStorage.removeItem('supabase_refresh_token', opts?.sessionFence),
    ]);
    authEvents.emit('logout');
  });
});

function stored(): { access: string | undefined; refresh: string | undefined } {
  return { access: mockNative.secure.get('supabase_token'), refresh: mockNative.secure.get('supabase_refresh_token') };
}

describe("legacy copy paused in its native write (Sol A-331-7 round 3, counterexamples 1 and 2)", () => {
  it("B signs in while A's legacy copy is landing: B's writes wait for it and land last", async () => {
    const p = pauseNext('set', 'supabase_token');
    const read = secureStorage.getItem('supabase_token');
    await p.reached;
    const bSignIn = signIn(B, 'refresh-b');
    await settle();
    // B's first write waits for the copy that is landing.
    expect(stored()).toEqual({ access: undefined, refresh: undefined });
    p.release();
    await bSignIn;
    await read;
    await settle();
    expect(stored()).toEqual({ access: B, refresh: 'refresh-b' });
    expect(mockNative.legacy.has('supabase_token')).toBe(false);
    expect(sessionFenceHeld()).toBe(false);
    await api.get('/messages');
    expect(sent).toEqual([{ url: '/messages', authorization: `Bearer ${B}` }]);
  });

  it("sign-out while A's legacy copy is landing: A's session never comes back", async () => {
    const p = pauseNext('set', 'supabase_token');
    const read = secureStorage.getItem('supabase_token');
    await p.reached;
    const out = signOutKeys();
    await settle();
    p.release();
    await out;
    await read;
    await settle();
    expect(stored()).toEqual({ access: undefined, refresh: undefined });
    expect(mockNative.legacy.has('supabase_token')).toBe(false);
    expect(await secureStorage.getItem('supabase_token')).toBeNull();
    expect(sessionFenceHeld()).toBe(false);
  });
});

describe('legacy copy paused in its legacy read (Sol A-331-7 round 3)', () => {
  it("sign-out during the legacy read: the stale value is never copied and nothing comes back", async () => {
    const p = pauseNext('legacy_get', 'supabase_token');
    const read = secureStorage.getItem('supabase_token');
    await p.reached;
    await signOutKeys();
    p.release();
    expect(await read).toBeNull();
    await settle();
    expect(stored()).toEqual({ access: undefined, refresh: undefined });
    expect(await secureStorage.getItem('supabase_token')).toBeNull();
    expect(await secureStorage.getItem('supabase_refresh_token')).toBeNull();
  });

  it("B signs in during a request's legacy read: the stale value is refused and the request goes out as B", async () => {
    const p = pauseNext('legacy_get', 'supabase_token');
    const work = api.get('/messages');
    await p.reached;
    await signIn(B, 'refresh-b');
    p.release();
    await work;
    await settle();
    expect(stored()).toEqual({ access: B, refresh: 'refresh-b' });
    expect(sent).toEqual([{ url: '/messages', authorization: `Bearer ${B}` }]);
  });

  it("B signs in during the refresh token's legacy read: A's refresh token is never copied beside B's access", async () => {
    mockNative.secure.set('supabase_token', A);
    const p = pauseNext('legacy_get', 'supabase_refresh_token');
    const read = secureStorage.getItem('supabase_refresh_token');
    await p.reached;
    await signIn(B, 'refresh-b');
    p.release();
    expect(await read).toBeNull();
    await settle();
    expect(stored()).toEqual({ access: B, refresh: 'refresh-b' });
  });
});

describe('ordinary upgrade still works (positive controls)', () => {
  it('first request after the upgrade carries A; both keys move to SecureStore and leave AsyncStorage', async () => {
    await api.get('/messages');
    expect(sent).toEqual([{ url: '/messages', authorization: `Bearer ${A}` }]);
    expect(await secureStorage.getItem('supabase_refresh_token')).toBe('refresh-a');
    expect(stored()).toEqual({ access: A, refresh: 'refresh-a' });
    expect([...mockNative.legacy.keys()]).toEqual([]);
  });

  it('parallel cold-start requests share one legacy read and all carry A', async () => {
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(sent.map((s) => s.authorization)).toEqual([`Bearer ${A}`, `Bearer ${A}`, `Bearer ${A}`]);
    expect(mockNative.legacyReads).toBe(1);
  });

  it("a 401 right after the upgrade refreshes with A's migrated refresh token and commits", async () => {
    respond = (config) => {
      if (config.url === '/a-work' && config.headers?.Authorization === `Bearer ${A}`) {
        const response: AxiosResponse = { data: {}, status: 401, statusText: '', headers: {}, config };
        return Promise.reject(new AxiosError('HTTP 401', 'ERR_BAD_REQUEST', config, {}, response));
      }
      return ok(config);
    };
    await api.get('/a-work');
    expect(refreshCalls).toEqual(['refresh-a']);
    expect(stored()).toEqual({ access: A2, refresh: 'refresh-a2' });
    expect(sent.map((s) => s.authorization)).toEqual([`Bearer ${A}`, `Bearer ${A2}`]);
  });
});
