/** LS-938R2: real text transport, session writes and cache hydration. Native I/O only is doubled. */
import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

const mockDisk = new Map<string, string>();
jest.mock('../../../../storage/mmkv', () => ({
  cacheStorage: {
    getStringAsync: async (k: string) => mockDisk.get(k),
    getAllKeys: async () => [...mockDisk.keys()],
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
  },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { addEventListener: () => () => undefined },
}));

import api, {
  __resetRefreshStateForTests, __setRefreshSessionForTests, __setSignOutForTests,
} from '../../../../services/api';
import { secureStorage } from '../../../../services/secureStorage';
import { authEvents } from '../../../../utils/authEvents';
import { spaceOutbox, startSpaceOutbox, setSpaceOutboxOnline, useSpaceOutbox } from '../spaceChatOutbox';

const native = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };
const credential = (sub: string, revision = 0) => [
  Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from(JSON.stringify({ sub, revision })).toString('base64url'),
  'synthetic',
].join('.');
const A = credential('viewer-a');
const A2 = credential('viewer-a', 1);
const B = credential('viewer-b');
let sent: { authorization: unknown; key: unknown; body: unknown }[];
let expireA: boolean;
const ok = (config: InternalAxiosRequestConfig) => ({
  status: 200, statusText: '', headers: {}, config,
  data: { message: {
    id: `message-${sent.length}`, cohort_id: 'shared-space', sender_user_id: 'viewer-a',
    body: 'queued text', kind: 'text', created_at: '2026-11-05T18:00:00Z',
  } },
});
const adapter: AxiosAdapter = async (config) => {
  sent.push({ authorization: config.headers.Authorization, key: config.headers['Idempotency-Key'], body: config.data });
  if (expireA && config.headers.Authorization === `Bearer ${A}`) {
    throw new AxiosError('HTTP 401', 'ERR_BAD_REQUEST', config, {}, {
      ...ok(config), status: 401, data: {},
    });
  }
  return ok(config);
};
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
async function signIn(token: string, userId: string) {
  await secureStorage.setItem('supabase_token', token);
  await secureStorage.setItem('supabase_refresh_token', `refresh-${userId}`);
  authEvents.emit();
  startSpaceOutbox(userId);
  await settle();
}
const keptRow = {
  localId: 'local-a', key: 'key-a', cohortId: 'shared-space', body: 'queued by A',
  createdAt: '2026-11-05T18:00:00Z', state: 'sending',
};
beforeEach(async () => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  authEvents.emit('logout');
  setSpaceOutboxOnline(false);
  await settle();
  mockDisk.clear();
  native.__store.clear();
  sent = [];
  expireA = false;
  api.defaults.adapter = adapter;
});
afterEach(async () => {
  authEvents.emit('logout');
  await settle();
});

it('restart hydration: A resumes its persisted sending row, with its original key, only as A', async () => {
  mockDisk.set('space_outbox_viewer-a', JSON.stringify([keptRow]));
  await signIn(A, 'viewer-a');
  const hook = await renderHook(() => useSpaceOutbox('shared-space'));
  expect(hook.result.current.map((r) => r.body)).toEqual(['queued by A']);
  setSpaceOutboxOnline(true);
  await settle();
  expect(sent).toEqual([expect.objectContaining({ authorization: `Bearer ${A}`, key: 'key-a' })]);
  hook.unmount();
});

it('restart hydration: B neither sees nor sends A storage, even in the same space', async () => {
  mockDisk.set('space_outbox_viewer-a', JSON.stringify([keptRow]));
  await signIn(B, 'viewer-b');
  const hook = await renderHook(() => useSpaceOutbox('shared-space'));
  expect(hook.result.current).toEqual([]);
  setSpaceOutboxOnline(true);
  await settle();
  expect(sent).toEqual([]);
  hook.unmount();
});

it('401 retry: a refresh of A keeps the same message and idempotency key under A', async () => {
  await signIn(A, 'viewer-a');
  expireA = true;
  __setRefreshSessionForTests(async () => ({
    data: { session: { access_token: A2, refresh_token: 'refresh-a2' } }, error: null,
  }));
  spaceOutbox.add('shared-space', 'queued by A');
  setSpaceOutboxOnline(true);
  await settle();
  expect(sent.map((r) => r.authorization)).toEqual([`Bearer ${A}`, `Bearer ${A2}`]);
  expect(sent[1].key).toEqual(sent[0].key);
  expect(sent[1].body).toEqual(sent[0].body);
});

it('401 retry: A refresh returning after logout and B login never replays A as B', async () => {
  await signIn(A, 'viewer-a');
  expireA = true;
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { reached = resolve; });
  __setRefreshSessionForTests(async () => {
    reached();
    await gate;
    return { data: { session: { access_token: A2, refresh_token: 'refresh-a2' } }, error: null };
  });
  spaceOutbox.add('shared-space', 'queued by A');
  setSpaceOutboxOnline(true);
  await started;
  await secureStorage.removeItem('supabase_token');
  authEvents.emit('logout');
  await signIn(B, 'viewer-b');
  release();
  await settle();
  expect(sent.map((r) => r.authorization)).toEqual([`Bearer ${A}`]);
  expect(await secureStorage.getItem('supabase_token')).toEqual(B);
  const hook = await renderHook(() => useSpaceOutbox('shared-space'));
  expect(hook.result.current).toEqual([]);
  spaceOutbox.add('shared-space', 'queued by B');
  await settle();
  expect(sent.map((r) => r.authorization)).toEqual([`Bearer ${A}`, `Bearer ${B}`]);
  hook.unmount();
});
