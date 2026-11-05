/**
 * LS-938: real text outbox -> real space API -> real axios interceptors.
 * Only device storage, connectivity subscription and transport are doubled.
 * Credentials below are generated unsigned test values, never real secrets.
 */
import type { AxiosAdapter } from 'axios';

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
jest.mock('../../storage/mmkv', () => ({
  cacheStorage: {
    getStringAsync: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));

import api, { __resetRefreshStateForTests, __setSignOutForTests } from '../api';
import { authEvents } from '../../utils/authEvents';
import {
  setSpaceOutboxOnline, spaceOutbox, startSpaceOutbox,
} from '../../components/community/space-chat/spaceChatOutbox';

const secure = jest.requireMock('../secureStorage') as {
  __store: Map<string, string>;
  secureStorage: { getItem: jest.Mock };
};
const credential = (sub: string) => [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub })).toString('base64url'),
  'synthetic',
].join('.');
const a = credential('viewer-a');
const b = credential('viewer-b');
let sent: { authorization: unknown; body: unknown }[];
const adapter: AxiosAdapter = async (config) => {
  sent.push({ authorization: config.headers.Authorization, body: config.data });
  return {
    status: 200, statusText: '', headers: {}, config,
    data: { message: {
      id: 'message', cohort_id: 'shared-space', sender_user_id: 'viewer',
      body: 'Controlled queued text', kind: 'text', created_at: '2026-11-05T18:00:00Z',
    } },
  };
};
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(async () => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  sent = [];
  api.defaults.adapter = adapter;
  secure.secureStorage.getItem.mockImplementation(async (key: string) => secure.__store.get(key) ?? null);
  secure.__store.set('supabase_token', a);
  authEvents.emit('login');
  setSpaceOutboxOnline(false);
  startSpaceOutbox('viewer-a');
  await settle();
});
afterEach(() => {
  authEvents.emit('logout');
  secure.__store.clear();
});

it('positive control: a queued text leaves under its original sign-in', async () => {
  spaceOutbox.add('shared-space', 'Controlled queued text');
  setSpaceOutboxOnline(true);
  await settle();
  expect(sent).toEqual([{
    authorization: `Bearer ${a}`,
    body: JSON.stringify({ body: 'Controlled queued text' }),
  }]);
});

it('LS938 B3: account switch while loading the credential cancels the old queued text', async () => {
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { reached = resolve; });
  secure.secureStorage.getItem.mockImplementationOnce(async (key: string) => {
    reached();
    await gate;
    return secure.__store.get(key) ?? null;
  });
  spaceOutbox.add('shared-space', 'Controlled queued text');
  setSpaceOutboxOnline(true);
  await started;
  authEvents.emit('logout');
  secure.__store.set('supabase_token', b);
  authEvents.emit('login');
  release();
  await settle();
  expect(sent).toEqual([]);
});
