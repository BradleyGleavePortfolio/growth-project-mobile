/**
 * FIX-938 (LS-938 B3): a text queued by one account never goes out as another.
 * Real text outbox -> real space API -> real axios interceptors -> real secureStorage and session fence (a sign-out's
 * credential removal moves the session generation, services/sessionFence.ts). Only the native key store
 * (jest.setup.js), device cache, connectivity subscription and transport are doubled. Credentials are unsigned test
 * values, never real secrets.
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
import { sessionGeneration } from '../../../../services/sessionFence';
import { authEvents } from '../../../../utils/authEvents';
import { setSpaceOutboxOnline, spaceOutbox, startSpaceOutbox } from '../spaceChatOutbox';

const native = jest.requireMock('expo-secure-store') as { __store: Map<string, string>; getItemAsync: jest.Mock };
const credential = (sub: string) => [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub })).toString('base64url'),
  'synthetic',
].join('.');
const a = credential('viewer-a');
const b = credential('viewer-b');
let sent: { authorization: unknown; key: unknown; body: unknown }[];
const adapter: AxiosAdapter = async (config) => {
  sent.push({ authorization: config.headers.Authorization, key: config.headers['Idempotency-Key'], body: config.data });
  return {
    status: 200, statusText: '', headers: {}, config,
    data: { message: {
      id: `message-${sent.length}`, cohort_id: 'shared-space', sender_user_id: 'viewer',
      body: 'x', kind: 'text', created_at: '2026-11-05T18:00:00Z',
    } },
  };
};
const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const textOf = (r: { body: unknown }) => (JSON.parse(String(r.body)) as { body: string }).body;

/** Holds the next read of the sign-in credential until `release`; `reached` resolves once it is waiting. */
function holdNextCredentialRead() {
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { reached = resolve; });
  const real = native.getItemAsync.getMockImplementation()!;
  let held = false;
  native.getItemAsync.mockImplementation(async (key: string) => {
    if (key === 'supabase_token' && !held) {
      held = true;
      reached();
      await gate;
    }
    return real(key);
  });
  return { release: () => { release(); native.getItemAsync.mockImplementation(real); }, started };
}

/** What authActions.signOut does to the sign-in: removes the credential (session fence), then says `logout`. */
async function signOut() {
  await secureStorage.removeItem('supabase_token');
  authEvents.emit('logout');
}
/** What LoginScreen does: writes the credential, then the generic auth change; the next screen starts the outbox. */
async function signIn(token: string, userId: string) {
  await secureStorage.setItem('supabase_token', token);
  authEvents.emit();
  startSpaceOutbox(userId);
  await settle();
}

beforeEach(async () => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  sent = [];
  api.defaults.adapter = adapter;
  authEvents.emit('logout');
  setSpaceOutboxOnline(false);
  await signIn(a, 'viewer-a');
});
afterEach(() => {
  authEvents.emit('logout');
  native.__store.clear();
});

it('a queued text goes out once, as the account that queued it', async () => {
  spaceOutbox.add('shared-space', 'From A');
  setSpaceOutboxOnline(true);
  await settle();
  expect(sent).toEqual([expect.objectContaining({ authorization: `Bearer ${a}` })]);
  expect(sent.map(textOf)).toEqual(['From A']);
});

it('a real sign-out while the send reads its credential: the session generation moves and A\'s text never goes as B', async () => {
  const hold = holdNextCredentialRead();
  spaceOutbox.add('shared-space', 'From A');
  setSpaceOutboxOnline(true);
  await hold.started;
  const before = sessionGeneration();
  await signOut();
  expect(sessionGeneration()).toBeGreaterThan(before);
  await signIn(b, 'viewer-b');
  hold.release();
  await settle();
  expect(sent).toEqual([]);

  spaceOutbox.add('shared-space', 'From B');
  await settle();
  expect(sent).toEqual([expect.objectContaining({ authorization: `Bearer ${b}` })]);
  expect(sent.map(textOf)).toEqual(['From B']);
});

it('sign-out then sign-in drops A\'s queued texts: B\'s credential never carries them', async () => {
  spaceOutbox.add('shared-space', 'From A');
  await signOut();
  await signIn(b, 'viewer-b');
  setSpaceOutboxOnline(true);
  await settle();
  expect(sent).toEqual([]);
});

it('another account\'s credential with no sign-out: A\'s text waits and never goes as B', async () => {
  spaceOutbox.add('shared-space', 'From A');
  await secureStorage.setItem('supabase_token', b);
  authEvents.emit();
  setSpaceOutboxOnline(true);
  await settle();
  expect(sent).toEqual([]);
});

it('a new sign-in of the same account mid-send: the text goes again under it, once, as A', async () => {
  const hold = holdNextCredentialRead();
  spaceOutbox.add('shared-space', 'From A');
  setSpaceOutboxOnline(true);
  await hold.started;
  authEvents.emit();
  hold.release();
  await settle();
  expect(sent).toEqual([expect.objectContaining({ authorization: `Bearer ${a}` })]);
  expect(sent.map(textOf)).toEqual(['From A']);
});
