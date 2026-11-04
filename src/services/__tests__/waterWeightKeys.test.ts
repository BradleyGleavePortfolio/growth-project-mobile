/**
 * WATER-WEIGHT-KEYS-M: each water and weight save sends its one-time key
 * (client_uuid), the phone half of backend #1206 (CONTRACT 6588001442).
 *
 * The REAL axios instance of services/api.ts runs here (its request and
 * response interceptors, the 401 refresh and replay), with the REAL weightApi,
 * waterApi and client store. Only SecureStore and the transport adapter are
 * doubled: the adapter records each body that would have been sent and never
 * touches the network. Tokens are synthetic unsigned JWTs.
 *
 * FR-921R2 (LO-921R2 N1): a glass of water has one key. The client store makes
 * it (withSaveKey, src/utils/log/saveKey.ts) and waterApi.log sends that key in
 * the body as client_uuid (the field the server reads) and the same key in the
 * Idempotency-Key header; every resend of the glass sends it again.
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

import api, { __resetRefreshStateForTests, __setRefreshSessionForTests, __setSignOutForTests, waterApi, weightApi } from '../api';
import { holdSessionFence, sessionGeneration } from '../sessionFence';
import { useClientStore } from '../../store/clientStore';
import { withSaveKey } from '../../utils/log/saveKey';

const secure = jest.requireMock('../secureStorage') as { __store: Map<string, string> };

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
/** A synthetic, unsigned JWT for `sub` (never a real credential). */
function jwt(sub: string, n = 0): string {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ sub, n }))}.sig`;
}

interface Sent {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
  /** The Idempotency-Key header, when the request had one. */
  header: unknown;
}
let sent: Sent[];
let respond: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

const adapter: AxiosAdapter = (config) => {
  const raw = config.data;
  sent.push({
    method: (config.method ?? '').toUpperCase(),
    url: config.url ?? '',
    body: typeof raw === 'string' && raw ? JSON.parse(raw) : raw,
    header: config.headers?.get('Idempotency-Key') ?? undefined,
  });
  return respond(config);
};

function ok(config: InternalAxiosRequestConfig, data: unknown, status = 201): Promise<AxiosResponse> {
  return Promise.resolve({ data, status, statusText: '', headers: {}, config });
}
function httpFail(config: InternalAxiosRequestConfig, status: number, data: unknown = {}): Promise<AxiosResponse> {
  const response: AxiosResponse = { data, status, statusText: '', headers: {}, config };
  return Promise.reject(new AxiosError(`HTTP ${status}`, 'ERR_BAD_REQUEST', config, {}, response));
}
/** The request reached nobody, or its answer was lost on the way back. */
function noAnswer(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config, {}));
}

/** A sign-out and sign-in (the session generation moves; nothing waits across it). */
function newSession(): void {
  const hold = holdSessionFence(sessionGeneration());
  if (!hold) throw new Error('expected the session fence');
  hold.release(true);
}

const posts = (url: string) => sent.filter((s) => s.method === 'POST' && s.url === url);
const keysOf = (url: string) => posts(url).map((s) => s.body?.client_uuid);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/** A glass of water as the client store saves it (clientStore.logWater): withSaveKey holds the glass's key. */
const glass = (amount_ml: number, date = '2026-11-03') =>
  withSaveKey(['water', date, amount_ml], (key) => waterApi.log({ amount_ml, date }, key));

beforeEach(() => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  api.defaults.adapter = adapter;
  sent = [];
  respond = (config) => ok(config, { id: `row-${sent.length}` });
  secure.__store.clear();
  secure.__store.set('supabase_token', jwt('member-a'));
  secure.__store.set('supabase_refresh_token', 'refresh-a');
  newSession();
});

// One table over both saves: the class is "a member save the server stores
// once per client_uuid" (backend #1206 K1), and these are its two routes.
const SAVES = [
  {
    name: 'weight',
    url: '/weight',
    key: new RegExp(`^${UUID}$`),
    save: (n = 182.4) => weightApi.log({ weight_lbs: n, date: '2026-11-03', notes: 'Morning' }),
    other: () => weightApi.log({ weight_lbs: 181.2, date: '2026-11-03', notes: 'Morning' }),
  },
  {
    name: 'water',
    url: '/nutrition/water',
    // The offline queue's id shape (newSaveKey): pfl_ and a UUID.
    key: new RegExp(`^pfl_${UUID}$`),
    save: (n = 237) => glass(n),
    other: () => glass(500),
  },
] as const;

describe.each(SAVES)('$name save: its one-time key', ({ url, key, save, other }) => {
  it('sends a key with the save, beside the fields it sent before', async () => {
    await save();
    const [one] = posts(url);
    expect(typeof one.body?.client_uuid).toBe('string');
    expect(String(one.body?.client_uuid)).toMatch(key);
    expect(String(one.body?.client_uuid).length).toBeLessThanOrEqual(128); // the server's MaxLength
  });

  it('a resend after a lost answer sends the same key, and gets the first row back as the answer', async () => {
    respond = (config) => noAnswer(config);
    await expect(save()).rejects.toBeTruthy();
    respond = (config) => ok(config, { id: 'first-row', client_uuid: posts(url)[0].body?.client_uuid });
    const answer = await save();
    const [first, again] = keysOf(url);
    expect(first).toEqual(expect.any(String));
    expect(again).toBe(first);
    expect(answer.data).toEqual({ id: 'first-row', client_uuid: first });
  });

  it('a server error (5xx) may have stored the save too: the resend keeps the key', async () => {
    respond = (config) => httpFail(config, 503);
    await expect(save()).rejects.toBeTruthy();
    respond = (config) => ok(config, { id: 'r' });
    await save();
    const [first, again] = keysOf(url);
    expect(first).toEqual(expect.any(String));
    expect(again).toBe(first);
  });

  it('two saves send two keys', async () => {
    await save();
    await save();
    const [a, b] = keysOf(url);
    expect(a).toEqual(expect.any(String));
    expect(b).toEqual(expect.any(String));
    expect(b).not.toBe(a);
  });

  it('a different save after a failure is a new save with a new key', async () => {
    respond = (config) => noAnswer(config);
    await expect(save()).rejects.toBeTruthy();
    respond = (config) => ok(config, { id: 'r' });
    await other();
    const [a, b] = keysOf(url);
    expect(b).not.toBe(a);
  });

  it('a refused save (4xx, nothing stored) ends its key; 404 is another member key: a new key, never the same one', async () => {
    for (const status of [400, 404]) {
      sent = [];
      respond = (config) => httpFail(config, status, status === 404 ? { message: 'Entry not found' } : {});
      await expect(save()).rejects.toBeTruthy();
      respond = (config) => ok(config, { id: 'r' });
      await save();
      const [a, b] = keysOf(url);
      expect(b).not.toBe(a);
    }
  });

  it('the replay after a token refresh keeps the key', async () => {
    __setRefreshSessionForTests(async () => ({
      data: { session: { access_token: jwt('member-a', 1), refresh_token: 'refresh-a2' } },
      error: null,
    }));
    let first = true;
    respond = (config) => {
      if (first) {
        first = false;
        return httpFail(config, 401);
      }
      return ok(config, { id: 'r' });
    };
    await save();
    const [sentFirst, replay] = keysOf(url);
    expect(posts(url)).toHaveLength(2);
    expect(sentFirst).toEqual(expect.any(String));
    expect(replay).toBe(sentFirst);
  });

  it('a waiting key never crosses a sign-out: the next session sends a new key', async () => {
    respond = (config) => noAnswer(config);
    await expect(save()).rejects.toBeTruthy();
    // Sign-out moves the session and resets the client store (authActions resetUserScopedStores).
    newSession();
    useClientStore.getState().reset();
    respond = (config) => ok(config, { id: 'r' });
    await save();
    const [a, b] = keysOf(url);
    expect(b).not.toBe(a);
  });

  it('two saves at once, both lost: each resend gets back its own key', async () => {
    respond = (config) => noAnswer(config);
    await Promise.allSettled([save(), save()]);
    const lost = keysOf(url);
    expect(new Set(lost).size).toBe(2);
    respond = (config) => ok(config, { id: 'r' });
    await save();
    await save();
    expect(keysOf(url).slice(2).sort()).toEqual([...lost].sort());
  });
});

// LS-921 B1: a read alone ends no key; only a read the client store puts on
// screen does (the table at the end of this file).
describe('water: a read the screen never shows leaves the waiting key', () => {
  it.each([
    ['the same day', '2026-11-03'],
    ['another day', '2026-11-02'],
  ])('a read of %s through waterApi alone keeps the key', async (_label, day) => {
    respond = (config) => noAnswer(config);
    await expect(glass(237)).rejects.toBeTruthy();
    respond = (config) => ok(config, { total_ml: 237, logs: [] }, 200);
    await waterApi.getDaily(day);
    respond = (config) => ok(config, { id: 'r' });
    await glass(237);
    const [a, b] = keysOf('/nutrition/water');
    expect(a).toEqual(expect.any(String));
    expect(b).toBe(a);
  });
});

// FR-921R2 (LO-921R2 N1): one key per glass. The key the server reads (body
// client_uuid) and the Idempotency-Key header are the same key, the one the
// client store made for the glass, on the first send and on every resend.
describe('one key per glass, through the client store and the real api', () => {
  it('a lost glass and its redo send one key, in the body and the header alike', async () => {
    const date = '2026-11-03';
    useClientStore.getState().reset();
    useClientStore.setState({ selectedDate: date, waterOz: 0, waterEntries: [] });
    respond = (config) => noAnswer(config);
    await useClientStore.getState().logWater('member-a', '', 8);
    respond = (config) => ok(config, { id: 'w1', amount_ml: 237, logged_at: `${date}T08:00:00.000Z` });
    await useClientStore.getState().logWater('member-a', '', 8);
    const sends = posts('/nutrition/water');
    expect(sends).toHaveLength(2);
    const keys = sends.flatMap((s) => [s.body?.client_uuid, s.header]);
    expect(String(keys[0])).toMatch(new RegExp(`^pfl_${UUID}$`));
    expect(new Set(keys)).toEqual(new Set([keys[0]]));
  });

  it('a new glass after an answered one sends a new key, again one key in body and header', async () => {
    useClientStore.getState().reset();
    useClientStore.setState({ selectedDate: '2026-11-03', waterOz: 0, waterEntries: [] });
    await useClientStore.getState().logWater('member-a', '', 8);
    await useClientStore.getState().logWater('member-a', '', 8);
    const [a, b] = posts('/nutrition/water');
    expect(a.header).toBe(a.body?.client_uuid);
    expect(b.header).toBe(b.body?.client_uuid);
    expect(b.body?.client_uuid).not.toBe(a.body?.client_uuid);
  });
});

describe('the client store: a glass added again after a lost answer counts once', () => {
  it('the redo sends the first key and the day shows one glass', async () => {
    const date = '2026-11-03';
    useClientStore.getState().reset();
    useClientStore.setState({ selectedDate: date, waterOz: 0, waterEntries: [] });
    respond = (config) => noAnswer(config);
    await useClientStore.getState().logWater('member-a', '', 8);
    expect(useClientStore.getState().waterOz).toBe(0);
    expect(useClientStore.getState().loadError).toBe('8 oz of water was not saved. Check the connection, then add it again.');
    respond = (config) => ok(config, { id: 'w1', amount_ml: 237, logged_at: `${date}T08:00:00.000Z` });
    await useClientStore.getState().logWater('member-a', '', 8);
    const [a, b] = keysOf('/nutrition/water');
    expect(a).toEqual(expect.any(String));
    expect(b).toBe(a);
    expect(useClientStore.getState().waterOz).toBe(8);
    expect(useClientStore.getState().waterEntries.map((e) => e.id)).toEqual(['w1']);
    expect(useClientStore.getState().loadError).toBeNull();
  });

  it("a water read discarded after a food refresh failure keeps the lost save's key", async () => {
    const date = '2026-11-03';
    useClientStore.getState().reset();
    useClientStore.setState({ selectedDate: date, waterOz: 0, waterEntries: [] });
    const stored = new Map<string, { id: string; amount_ml: number; logged_at: string }>();
    let loseAnswer = true;
    respond = (config) => {
      if (config.method === 'post' && config.url === '/nutrition/water') {
        const body = JSON.parse(config.data) as { client_uuid: string; amount_ml: number };
        if (!stored.has(body.client_uuid)) {
          stored.set(body.client_uuid, {
            id: `water-${stored.size + 1}`,
            amount_ml: body.amount_ml,
            logged_at: `${date}T08:00:00.000Z`,
          });
        }
        if (loseAnswer) {
          loseAnswer = false;
          return noAnswer(config);
        }
        return ok(config, stored.get(body.client_uuid));
      }
      if (config.url === `/nutrition/water?date=${date}`) {
        const logs = [...stored.values()];
        return ok(config, { total_ml: logs.reduce((n, row) => n + row.amount_ml, 0), logs }, 200);
      }
      // The food and water refresh are independent requests. The water read
      // succeeds, but loadDayData discards both results when food fails.
      if (config.url === `/log/daily?date=${date}`) return httpFail(config, 503);
      throw new Error(`Unexpected request: ${config.url}`);
    };

    // The first glass is stored, but the answer is lost and the visible
    // count rolls back. The client then tries the existing refresh action.
    await useClientStore.getState().logWater('member-a', '', 8);
    expect(stored.size).toBe(1);
    expect(useClientStore.getState().waterOz).toBe(0);
    await useClientStore.getState().loadDayData('member-a', date);
    expect(useClientStore.getState().loadError).toBe('Food and water data could not refresh. Check your connection and try again.');
    expect(useClientStore.getState().waterOz).toBe(0);
    expect(useClientStore.getState().waterEntries).toEqual([]);

    // Nothing showed the first glass, so adding it again must resend its
    // key rather than create a second stored row.
    await useClientStore.getState().logWater('member-a', '', 8);
    expect(stored.size).toBe(1);
    expect(keysOf('/nutrition/water')[1]).toBe(keysOf('/nutrition/water')[0]);
  });
});

// FR-921R1 (LS-921 B1, the whole class): a lost glass's key waits until the
// day the client sees has taken in a water read of that day. Every way a read
// of the day can end is one row: the rows the screen never shows keep the key
// (adding the glass again resends it, so the server keeps one row); the rows
// the screen shows end it (the glass is on screen, so another tap is a new glass).
let failFood = false;
let failWaterRead = false;
let holdWaterRead = false;
let releaseWaterRead: (() => void) | null = null;
type ReadEnd = { name: string; keeps: boolean; run: (date: string, other: string) => Promise<void> };
const READ_ENDS: ReadEnd[] = [
  {
    name: 'the food read fails, so the store drops the water read',
    keeps: true,
    run: async (date) => {
      failFood = true;
      await useClientStore.getState().loadDayData('member-a', date);
      failFood = false;
    },
  },
  {
    name: 'the client opens another day while the read is out, then comes back',
    keeps: true,
    run: async (date, other) => {
      holdWaterRead = true;
      const load = useClientStore.getState().loadDayData('member-a', date);
      for (let i = 0; i < 50 && !releaseWaterRead; i += 1) await new Promise((r) => setImmediate(r));
      expect(releaseWaterRead).toEqual(expect.any(Function));
      useClientStore.getState().setSelectedDate(other);
      releaseWaterRead?.();
      await load;
      holdWaterRead = false;
      useClientStore.getState().setSelectedDate(date);
    },
  },
  {
    name: 'the water read itself fails',
    keeps: true,
    run: async (date) => {
      failWaterRead = true;
      await useClientStore.getState().loadDayData('member-a', date);
      failWaterRead = false;
    },
  },
  {
    name: 'another day is read and shown, then the client comes back',
    keeps: true,
    run: async (date, other) => {
      await useClientStore.getState().loadDayData('member-a', other);
      useClientStore.getState().setSelectedDate(date);
    },
  },
  {
    name: 'the day is read and shown',
    keeps: false,
    run: async (date) => {
      await useClientStore.getState().loadDayData('member-a', date);
    },
  },
  {
    name: 'the shown day is refreshed',
    keeps: false,
    run: async (date) => {
      await useClientStore.getState().refreshShownDay('member-a', date);
    },
  },
];

describe.each(READ_ENDS)('a lost glass, then $name', ({ keeps, run }) => {
  it(keeps ? 'adding the glass again resends its key: one row' : 'the glass is on screen: another glass is a new save', async () => {
    const date = '2026-11-03';
    const other = '2026-11-02';
    failFood = false;
    failWaterRead = false;
    holdWaterRead = false;
    releaseWaterRead = null;
    useClientStore.getState().reset();
    useClientStore.setState({ selectedDate: date, waterOz: 0, waterEntries: [] });
    const stored = new Map<string, { id: string; amount_ml: number; logged_at: string }>();
    let loseAnswer = true;
    respond = (config) => {
      const url = config.url ?? '';
      if (config.method === 'post' && url === '/nutrition/water') {
        const body = JSON.parse(config.data) as { client_uuid: string; amount_ml: number };
        if (!stored.has(body.client_uuid)) {
          stored.set(body.client_uuid, { id: `water-${stored.size + 1}`, amount_ml: body.amount_ml, logged_at: `${date}T08:00:00.000Z` });
        }
        if (loseAnswer) {
          loseAnswer = false;
          return noAnswer(config);
        }
        return ok(config, stored.get(body.client_uuid));
      }
      if (url.startsWith('/nutrition/water?date=')) {
        if (failWaterRead) return httpFail(config, 503);
        const logs = url.endsWith(date) ? [...stored.values()] : [];
        const answer = () => ok(config, { total_ml: logs.reduce((n, row) => n + row.amount_ml, 0), logs }, 200);
        if (!holdWaterRead) return answer();
        return new Promise<AxiosResponse>((resolve) => {
          releaseWaterRead = () => resolve(answer());
        });
      }
      if (url.startsWith('/log/daily?date=')) return failFood ? httpFail(config, 503) : ok(config, { entries: [] }, 200);
      throw new Error(`Unexpected request: ${url}`);
    };

    await useClientStore.getState().logWater('member-a', '', 8);
    expect(stored.size).toBe(1);
    expect(useClientStore.getState().waterOz).toBe(0);
    await run(date, other);
    expect(useClientStore.getState().selectedDate).toBe(date);
    expect(useClientStore.getState().waterOz).toBe(keeps ? 0 : 8);

    await useClientStore.getState().logWater('member-a', '', 8);
    const [first, again] = keysOf('/nutrition/water');
    expect(first).toEqual(expect.any(String));
    if (keeps) {
      expect(again).toBe(first);
      expect(stored.size).toBe(1);
    } else {
      expect(again).not.toBe(first);
      expect(stored.size).toBe(2);
    }
  });
});
