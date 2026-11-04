/**
 * LS-921R3 tests only: real API/store, synthetic transport and storage.
 * The server model owns each row by account and body client_uuid, as #1206.
 */
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

jest.mock('../secureStorage', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    secureStorage: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
      removeItem: jest.fn(async (key: string) => { store.delete(key); }),
    },
  };
});

import api, { __resetRefreshStateForTests, __setSignOutForTests } from '../api';
import { holdSessionFence, sessionGeneration } from '../sessionFence';
import { useClientStore } from '../../store/clientStore';

const secure = jest.requireMock('../secureStorage') as { __store: Map<string, string> };
const date = '2026-11-03';
const token = (sub: string) =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.sig`;

function ok(config: InternalAxiosRequestConfig, data: unknown): Promise<AxiosResponse> {
  return Promise.resolve({ config, data, status: 200, statusText: '', headers: {} });
}
function failure(config: InternalAxiosRequestConfig, status: number): AxiosError {
  return new AxiosError(status ? `HTTP ${status}` : 'Network Error', status ? 'ERR_BAD_RESPONSE' : 'ERR_NETWORK', config, {},
    status ? { config, data: {}, status, statusText: '', headers: {} } : undefined);
}
function signIn(account: string): void {
  const hold = holdSessionFence(sessionGeneration());
  if (!hold) throw new Error('expected free session fence');
  hold.release(true);
  secure.__store.set('supabase_token', token(account));
  secure.__store.set('supabase_refresh_token', 'synthetic-refresh');
  useClientStore.getState().reset();
  useClientStore.setState({ selectedDate: date, hasLoadedDay: true });
}

beforeEach(() => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  secure.__store.clear();
  signIn('member-a');
});

describe('LS-921R3 B1: an ended session cannot put a water key back after reset', () => {
  it.each([
    ['member-b', 0],
    ['member-b', 503],
    ['member-a', 0],
    ['member-a', 503],
  ])('old request fails with %s signed in, status %s: next glass has a new key', async (nextAccount, status) => {
    const sent: string[] = [];
    const stored = new Map<string, { id: string; owner: string; amount_ml: number }>();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let rejectOld!: () => void;
    let first = true;
    let owner = 'member-a';
    api.defaults.adapter = ((config) => {
      const body = JSON.parse(config.data) as { client_uuid: string; amount_ml: number };
      sent.push(body.client_uuid);
      const row = stored.get(body.client_uuid);
      if (row && row.owner !== owner) return Promise.reject(failure(config, 404));
      if (!row) stored.set(body.client_uuid, { id: `row-${stored.size + 1}`, owner, amount_ml: body.amount_ml });
      if (first) {
        first = false;
        entered();
        return new Promise<AxiosResponse>((_resolve, reject) => {
          rejectOld = () => reject(failure(config, status));
        });
      }
      return ok(config, stored.get(body.client_uuid));
    }) as AxiosAdapter;

    const oldSave = useClientStore.getState().logWater('member-a', '', 8);
    await started; // A's glass reached the server, but its reply is still out.
    owner = nextAccount;
    signIn(nextAccount); // The real reset clears the pending-key pool.
    rejectOld(); // The old callback runs after that reset.
    await oldSave;
    await useClientStore.getState().logWater(nextAccount, '', 8);

    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toBe(sent[0]);
    expect(stored.size).toBe(2);
    expect(useClientStore.getState().loadError).toBeNull();
  });
});

it('LS-921R3 B2: a refresh snapshot before a lost glass cannot retire that glass key', async () => {
  const sent: string[] = [];
  const stored = new Map<string, { id: string; amount_ml: number; logged_at: string }>();
  let releaseFood!: () => void;
  let waterRead!: () => void;
  const snapshotted = new Promise<void>((resolve) => { waterRead = resolve; });
  let lose = true;
  api.defaults.adapter = ((config) => {
    if (config.url === `/log/daily?date=${date}`) {
      return new Promise<AxiosResponse>((resolve) => {
        releaseFood = () => { void ok(config, { entries: [] }).then(resolve); };
      });
    }
    if (config.url === `/nutrition/water?date=${date}`) {
      const logs = [...stored.values()]; // Snapshot has no glass yet.
      waterRead();
      return ok(config, { total_ml: logs.reduce((sum, row) => sum + row.amount_ml, 0), logs });
    }
    if (config.method === 'post' && config.url === '/nutrition/water') {
      const body = JSON.parse(config.data) as { client_uuid: string; amount_ml: number };
      sent.push(body.client_uuid);
      if (!stored.has(body.client_uuid)) {
        stored.set(body.client_uuid, { id: `row-${stored.size + 1}`, amount_ml: body.amount_ml, logged_at: `${date}T08:00:00Z` });
      }
      if (lose) {
        lose = false;
        return Promise.reject(failure(config, 0));
      }
      return ok(config, stored.get(body.client_uuid));
    }
    throw new Error(`unexpected route ${config.url}`);
  }) as AxiosAdapter;

  const refresh = useClientStore.getState().loadDayData('member-a', date);
  await snapshotted;
  await useClientStore.getState().logWater('member-a', '', 8);
  expect(stored.size).toBe(1);
  releaseFood(); // The successful refresh now applies its earlier empty water snapshot.
  await refresh;
  expect(useClientStore.getState().waterEntries).toEqual([]);
  expect(useClientStore.getState().waterOz).toBe(0);
  await useClientStore.getState().logWater('member-a', '', 8);

  expect(sent[1]).toBe(sent[0]);
  expect(stored.size).toBe(1);
});
