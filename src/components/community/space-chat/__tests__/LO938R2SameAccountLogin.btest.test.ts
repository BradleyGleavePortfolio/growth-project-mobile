/**
 * LO-938R2 B1 (agent 199): authEvents 'login' is also the SAME account's "re-read the session" event
 * (AddCoachCodeScreen.tsx:75/86, HousePackageScreen.tsx:66, planRenewal.ts:91). The text outbox treats it as a new
 * sign-in (spaceChatOutbox.ts:156 -> reset): the viewer's queued texts are wiped and, with the space chat still
 * mounted (useSpaceChat.ts:86 only restarts on a new userId), nothing written afterwards is ever sent.
 * Real outbox -> real space API -> real interceptors and secureStorage; device cache, connectivity and transport doubled.
 * Credentials are unsigned test values, never real secrets.
 */
import type { AxiosAdapter } from 'axios';

jest.mock('../../../../storage/mmkv', () => ({
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

import api, { __resetRefreshStateForTests, __setSignOutForTests } from '../../../../services/api';
import { secureStorage } from '../../../../services/secureStorage';
import { authEvents } from '../../../../utils/authEvents';
import { setSpaceOutboxOnline, spaceOutbox, startSpaceOutbox } from '../spaceChatOutbox';

const native = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };
const credential = (sub: string) => [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub })).toString('base64url'),
  'synthetic',
].join('.');
let sent: { body: unknown }[];
const adapter: AxiosAdapter = async (config) => {
  sent.push({ body: config.data });
  return {
    status: 200, statusText: '', headers: {}, config,
    data: { message: {
      id: `message-${sent.length}`, cohort_id: 'space', sender_user_id: 'viewer-a',
      body: 'x', kind: 'text', created_at: '2026-11-05T18:00:00Z',
    } },
  };
};
const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const textOf = (r: { body: unknown }) => (JSON.parse(String(r.body)) as { body: string }).body;

beforeEach(async () => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  sent = [];
  api.defaults.adapter = adapter;
  authEvents.emit('logout');
  setSpaceOutboxOnline(false);
  await secureStorage.setItem('supabase_token', credential('viewer-a'));
  authEvents.emit();
  startSpaceOutbox('viewer-a');
  await settle();
});
afterEach(() => {
  authEvents.emit('logout');
  native.__store.clear();
});

it('LO938R2 B1: the same account re-reading its session (emit login, as AddCoachCode) keeps its queued text and the outbox sends', async () => {
  spaceOutbox.add('space', 'Written offline');
  // AddCoachCodeScreen after a redeem: patchUserCache, then "re-read the session everywhere". Same account, same token.
  authEvents.emit('login');
  await settle();
  // Still in the same space chat (the screen stays mounted; its userId did not change).
  spaceOutbox.add('space', 'Written after');
  setSpaceOutboxOnline(true);
  await settle();
  expect(sent.map(textOf)).toEqual(['Written offline', 'Written after']);
});
