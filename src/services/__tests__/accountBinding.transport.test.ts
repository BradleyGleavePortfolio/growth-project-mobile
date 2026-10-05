/**
 * Mobile #331 Sol A-331-4: a destructive Roman request bound to account A can
 * never leave the phone with account B's credential.
 *
 * This runs the REAL axios instance from services/api.ts (its request and
 * response interceptors, including the 401 refresh and replay), the REAL
 * romanChatsApi and the REAL accountBinding module. Only SecureStore and the
 * transport adapter are doubled: the adapter records what would have been
 * sent and never touches the network. Tokens are synthetic unsigned JWTs.
 */
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

jest.mock('../secureStorage', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    secureStorage: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
    },
  };
});

import api, { __resetRefreshStateForTests, __setRefreshSessionForTests, __setSignOutForTests } from '../api';
import {
  authEpoch,
  captureAccountBinding,
  credentialSubject,
  __boundRequestsInFlightForTests,
  type AccountBinding,
} from '../accountBinding';
import { romanChatsApi } from '../../api/romanChatsApi';
import { authEvents } from '../../utils/authEvents';

const secure = jest.requireMock('../secureStorage') as {
  __store: Map<string, string>;
  secureStorage: { getItem: jest.Mock };
};

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
/** A synthetic, unsigned JWT for `sub` (never a real credential). */
function jwt(sub: string, n = 0): string {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ sub, n }))}.sig`;
}
const TOKEN_A = jwt('user-a');
const TOKEN_A_REFRESHED = jwt('user-a', 1);
const TOKEN_B = jwt('user-b');

interface Sent {
  method: string;
  url: string;
  authorization: string | undefined;
  signal: AbortSignal | undefined;
}
let sent: Sent[];
let respond: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

const adapter: AxiosAdapter = (config) => {
  sent.push({
    method: (config.method ?? '').toUpperCase(),
    url: config.url ?? '',
    authorization: config.headers?.Authorization as string | undefined,
    signal: config.signal as AbortSignal | undefined,
  });
  return respond(config);
};

function ok(config: InternalAxiosRequestConfig, status = 204, data: unknown = ''): Promise<AxiosResponse> {
  return Promise.resolve({ data, status, statusText: '', headers: {}, config });
}
function httpFail(config: InternalAxiosRequestConfig, status: number): Promise<AxiosResponse> {
  const response: AxiosResponse = {
    data: {},
    status,
    statusText: '',
    headers: {},
    config,
  };
  return Promise.reject(new AxiosError(`HTTP ${status}`, 'ERR_BAD_REQUEST', config, {}, response));
}

/** Pause the next SecureStore read of the access token until released. */
function pauseNextTokenRead(): { release: () => void; reached: Promise<void> } {
  let release!: () => void;
  let reached!: () => void;
  const reachedP = new Promise<void>((r) => (reached = r));
  const gate = new Promise<void>((r) => (release = r));
  const real = secure.secureStorage.getItem.getMockImplementation();
  secure.secureStorage.getItem.mockImplementationOnce(async (k: string) => {
    reached();
    await gate;
    return real ? real(k) : null;
  });
  return { release, reached: reachedP };
}

/** Sign out (tokens removed, logout emitted) and sign in as `token`'s account. */
function switchAccount(token: string): void {
  secure.__store.clear();
  authEvents.emit('logout');
  secure.__store.set('supabase_token', token);
  secure.__store.set('supabase_refresh_token', `refresh-for-${credentialSubject(token)}`);
  authEvents.emit();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  api.defaults.adapter = adapter;
  sent = [];
  respond = (config) => ok(config);
  secure.__store.clear();
  secure.__store.set('supabase_token', TOKEN_A);
  secure.__store.set('supabase_refresh_token', 'refresh-a');
});

async function bindA(): Promise<AccountBinding> {
  const b = await captureAccountBinding();
  if (!b) throw new Error('expected a binding');
  expect(b).toEqual({ subject: 'sub:user-a', epoch: authEpoch() });
  return b;
}

describe('a bound request is sent only with its own account credential', () => {
  it("positive control: A's delete all goes out as A", async () => {
    const out = await romanChatsApi.deleteAll(await bindA());
    expect(out).toEqual({ ok: true, value: null });
    expect(sent).toEqual([
      expect.objectContaining({
        method: 'DELETE',
        url: '/roman/sessions',
        authorization: `Bearer ${TOKEN_A}`,
      }),
    ]);
  });

  it("Sol probe: credential read paused, logout, login as B, read finishes with B's token: nothing is sent", async () => {
    const binding = await bindA();
    const pause = pauseNextTokenRead();
    const pending = romanChatsApi.deleteAll(binding);
    await pause.reached;
    switchAccount(TOKEN_B);
    pause.release();
    const out = await pending;
    expect(out).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: false },
    });
    expect(sent).toEqual([]);
  });

  it('same for a single delete, and for A -> logout -> A (a new sign-in of the same account)', async () => {
    const binding = await bindA();
    const pause = pauseNextTokenRead();
    const pending = romanChatsApi.deleteOne(binding, 'cmg9x2k3l0000abcd1234efgh');
    await pause.reached;
    switchAccount(TOKEN_A);
    pause.release();
    expect(await pending).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: false },
    });
    expect(sent).toEqual([]);
  });

  it('the token changed underneath without any auth event (another subject): nothing is sent', async () => {
    const binding = await bindA();
    secure.__store.set('supabase_token', TOKEN_B);
    expect(await romanChatsApi.deleteAll(binding)).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: false },
    });
    expect(sent).toEqual([]);
  });

  it('signed out while waiting for the credential (no token): nothing is sent, and no refresh or sign-out runs', async () => {
    const refresh = jest.fn();
    __setRefreshSessionForTests(refresh);
    const binding = await bindA();
    const pause = pauseNextTokenRead();
    const pending = romanChatsApi.deleteAll(binding);
    await pause.reached;
    secure.__store.clear();
    authEvents.emit('logout');
    pause.release();
    expect((await pending).ok).toBe(false);
    expect(sent).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('401 refresh and replay keep the binding', () => {
  it('positive control: same account, expired token, refresh, replay as A', async () => {
    __setRefreshSessionForTests(async () => ({
      data: {
        session: {
          access_token: TOKEN_A_REFRESHED,
          refresh_token: 'refresh-a2',
        },
      },
      error: null,
    }));
    let first = true;
    respond = (config) => {
      if (first) {
        first = false;
        return httpFail(config, 401);
      }
      return ok(config);
    };
    const out = await romanChatsApi.deleteAll(await bindA());
    expect(out).toEqual({ ok: true, value: null });
    expect(sent.map((s) => s.authorization)).toEqual([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_A_REFRESHED}`]);
  });

  it("account switched to B during A's refresh: no replay, B's tokens are not overwritten, B is not signed out", async () => {
    let finishRefresh!: () => void;
    const refreshGate = new Promise<void>((r) => (finishRefresh = r));
    const signOut = jest.fn(async () => undefined);
    __setSignOutForTests(signOut);
    __setRefreshSessionForTests(async () => {
      await refreshGate;
      // The refresh was for A's session, so it hands back A's new tokens.
      return {
        data: {
          session: {
            access_token: TOKEN_A_REFRESHED,
            refresh_token: 'refresh-a2',
          },
        },
        error: null,
      };
    });
    respond = (config) => httpFail(config, 401);
    const pending = romanChatsApi.deleteAll(await bindA());
    await flush();
    await flush();
    expect(sent).toHaveLength(1);
    switchAccount(TOKEN_B);
    finishRefresh();
    expect(await pending).toEqual(expect.objectContaining({ ok: false }));
    expect(sent).toHaveLength(1);
    expect(sent[0].authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(secure.__store.get('supabase_token')).toBe(TOKEN_B);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("a refresh that hands back another account's token: the replay is never sent", async () => {
    __setRefreshSessionForTests(async () => ({
      data: { session: { access_token: TOKEN_B, refresh_token: 'refresh-b' } },
      error: null,
    }));
    respond = (config) => httpFail(config, 401);
    const out = await romanChatsApi.deleteAll(await bindA());
    expect(out).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: false },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].authorization).toBe(`Bearer ${TOKEN_A}`);
  });
});

describe('in-flight work on an auth change', () => {
  it('a read in flight is aborted and its late answer is dropped', async () => {
    let answer!: () => void;
    respond = (config) =>
      new Promise((resolve) => {
        answer = () =>
          resolve({
            data: { sessions: [], nextCursor: null },
            status: 200,
            statusText: '',
            headers: {},
            config,
          });
      });
    const pending = romanChatsApi.list(await bindA());
    await flush();
    await flush();
    expect(sent).toHaveLength(1);
    expect(__boundRequestsInFlightForTests()).toBe(1);
    switchAccount(TOKEN_B);
    expect(sent[0].signal?.aborted).toBe(true);
    answer();
    expect(await pending).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: true },
    });
    expect(__boundRequestsInFlightForTests()).toBe(0);
  });

  it('an erase already sent as A is answered late: the answer is dropped (account_changed), never applied for B', async () => {
    let answer!: () => void;
    respond = (config) =>
      new Promise((resolve) => {
        answer = () =>
          resolve({
            data: '',
            status: 204,
            statusText: '',
            headers: {},
            config,
          });
      });
    const pending = romanChatsApi.deleteOne(await bindA(), 'c1');
    await flush();
    await flush();
    expect(sent).toEqual([
      expect.objectContaining({
        method: 'DELETE',
        authorization: `Bearer ${TOKEN_A}`,
      }),
    ]);
    switchAccount(TOKEN_B);
    answer();
    expect(await pending).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: true },
    });
  });

  it('a binding from an older sign-in is refused before anything is read or sent', async () => {
    const binding = await bindA();
    switchAccount(TOKEN_A);
    const reads = secure.secureStorage.getItem.mock.calls.length;
    expect(await romanChatsApi.deleteAll(binding)).toEqual({
      ok: false,
      failure: { reason: 'account_changed', mayHaveBeenSent: false },
    });
    expect(secure.secureStorage.getItem.mock.calls.length).toBe(reads);
    expect(sent).toEqual([]);
  });
});

describe('credentialSubject', () => {
  it('reads the JWT sub, and identifies an opaque token without keeping it', () => {
    expect(credentialSubject(TOKEN_A)).toBe('sub:user-a');
    expect(credentialSubject(TOKEN_A_REFRESHED)).toBe('sub:user-a');
    expect(credentialSubject(null)).toBeNull();
    const opaque = credentialSubject('screenshot-mode-token');
    expect(opaque).toMatch(/^tok:[0-9a-f]{8}:\d+$/);
    expect(opaque).not.toContain('screenshot');
    expect(credentialSubject('another-opaque-token')).not.toBe(opaque);
  });

  it('captureAccountBinding returns null when nobody is signed in or the sign-in changes during the read', async () => {
    secure.__store.clear();
    expect(await captureAccountBinding()).toBeNull();
    secure.__store.set('supabase_token', TOKEN_A);
    const pause = pauseNextTokenRead();
    const pending = captureAccountBinding();
    await pause.reached;
    authEvents.emit();
    pause.release();
    expect(await pending).toBeNull();
  });
});
