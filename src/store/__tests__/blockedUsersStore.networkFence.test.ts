/**
 * LS-914 B1, the network path: a block or unblock is sent, the person signs out, the next account signs in and loads
 * its own blocked list, and only then does the earlier request answer. The earlier answer must never add or remove a
 * person in the next account's blocked list. Real API wrappers, real blockSync, real store and the real sign-out store
 * reset run here; only the HTTP client and storage are test doubles. Same-account answers still land.
 */
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useBlockedUsersStore, type BlockedUser } from '../blockedUsersStore';
import { messagesModerationApi } from '../../api/messagesApi';
import { communitySafetyApi } from '../../api/communitySafetyApi';
import { useBlockedUsersHydration } from '../../hooks/useBlockedUsersHydration';
import { resetUserScopedStores } from '../../services/authActions';

const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockGet = jest.fn();

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    post: (...a: unknown[]) => mockPost(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
    get: (...a: unknown[]) => mockGet(...a),
  },
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  coachApi: { getClients: jest.fn(async () => ({ data: [] })) },
  logApi: { getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
  waterApi: { getDaily: jest.fn(async () => ({ data: { total_ml: 0 } })) },
}));
jest.mock('../../services/sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => null),
  readUserCache: jest.fn(async () => null),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));
jest.mock('../../storage/mmkv', () => {
  const m = new Map<string, string>();
  const store = {
    getString: (k: string) => m.get(k),
    getStringAsync: async (k: string) => m.get(k),
    set: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  };
  return { clearAllStorage: jest.fn(async () => m.clear()), prefsStorage: store, cacheStorage: store, secureStorage: store };
});

function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const NEXT_ROW = { blockedId: 'next-own-block', displayName: 'Next account block', blockedAt: '2026-10-30T09:00:00.000Z' };
const SHARED_ROW = { blockedId: 'shared-person', displayName: 'Shared person', blockedAt: '2026-10-30T09:00:00.000Z' };

type Writer = {
  name: string;
  verb: 'post' | 'delete';
  target: string;
  send: (id: string) => Promise<unknown>;
  reply: (id: string) => { data: unknown };
  /** The next account's own server list. An unblock row shares the person, so a stray unblock would remove them. */
  nextRows: typeof NEXT_ROW[];
  /** What the same account's list holds once its own answer lands. */
  sameAccount: (list: BlockedUser[]) => boolean;
};

const WRITERS: Writer[] = [
  {
    name: 'coaching block (POST /users/:id/block)',
    verb: 'post',
    target: 'earlier-person',
    send: (id) => messagesModerationApi.block(id),
    reply: () => ({ data: {} }),
    nextRows: [NEXT_ROW],
    sameAccount: (list) => list.some((b) => b.id === 'earlier-person'),
  },
  {
    name: 'community block (POST /community/blocks)',
    verb: 'post',
    target: 'earlier-person',
    send: (id) => communitySafetyApi.block(id),
    reply: (id) => ({ data: { blocked_user_id: id, blocked: true } }),
    nextRows: [NEXT_ROW],
    sameAccount: (list) => list.some((b) => b.id === 'earlier-person'),
  },
  {
    name: 'coaching unblock (DELETE /users/:id/block)',
    verb: 'delete',
    target: 'shared-person',
    send: (id) => messagesModerationApi.unblock(id),
    reply: () => ({ data: {} }),
    nextRows: [SHARED_ROW],
    sameAccount: (list) => !list.some((b) => b.id === 'shared-person'),
  },
  {
    name: 'community unblock (DELETE /community/blocks/:id)',
    verb: 'delete',
    target: 'shared-person',
    send: (id) => communitySafetyApi.unblock(id),
    reply: (id) => ({ data: { blocked_user_id: id, blocked: false } }),
    nextRows: [SHARED_ROW],
    sameAccount: (list) => !list.some((b) => b.id === 'shared-person'),
  },
];

async function signInAs(userId: string, rows: typeof NEXT_ROW[]) {
  await useBlockedUsersStore.getState().hydrate(userId);
  await useBlockedUsersStore.getState().addFromServer(rows, { replace: true });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await useBlockedUsersStore.getState().reset();
});

describe('a block answered after sign-out never reaches the next account (LS-914 B1)', () => {
  it.each(WRITERS)('$name: the earlier account’s answer leaves the next account’s list as it is', async (w) => {
    await signInAs('previous-account', [SHARED_ROW]);
    const request = held<{ data: unknown }>();
    (w.verb === 'post' ? mockPost : mockDelete).mockImplementationOnce(() => request.promise);
    const sent = w.send(w.target);

    resetUserScopedStores(); // sign-out
    await signInAs('next-account', w.nextRows);
    const nextList = useBlockedUsersStore.getState().blocked.map((b) => b.id);

    request.release(w.reply(w.target));
    await sent;

    const state = useBlockedUsersStore.getState();
    expect(state.userId).toBe('next-account');
    expect(state.blocked.map((b) => b.id)).toEqual(nextList);
  });

  it.each(WRITERS)('$name: the same account’s answer still lands', async (w) => {
    await signInAs('previous-account', [SHARED_ROW]);
    (w.verb === 'post' ? mockPost : mockDelete).mockImplementationOnce(async () => w.reply(w.target));
    await w.send(w.target);
    expect(w.sameAccount(useBlockedUsersStore.getState().blocked)).toBe(true);
  });

  it('the hydration hook’s server list for the earlier account never replaces the next account’s list', async () => {
    const list = held<{ data: unknown }>();
    mockGet.mockImplementationOnce(() => list.promise);
    const hook = await renderHook(() => useBlockedUsersHydration('previous-account'));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/users/blocks'));

    resetUserScopedStores(); // sign-out; the hook has not unmounted yet
    await signInAs('next-account', [NEXT_ROW]);

    await act(async () => {
      list.release({ data: { blocked: [{ ...SHARED_ROW, blockedId: 'earlier-person' }] } });
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.serverHydrationComplete).toBe(true));
    expect(useBlockedUsersStore.getState().userId).toBe('next-account');
    expect(useBlockedUsersStore.getState().blocked.map((b) => b.id)).toEqual(['next-own-block']);
    await hook.unmount();
  });

  it('sign-out empties the blocked list at once, and the next account’s list still loads from the server', async () => {
    await signInAs('previous-account', [SHARED_ROW]);
    resetUserScopedStores();
    expect(useBlockedUsersStore.getState().blocked).toEqual([]);
    expect(useBlockedUsersStore.getState().userId).toBeNull();

    mockGet.mockImplementationOnce(async () => ({ data: { blocked: [NEXT_ROW] } }));
    const hook = await renderHook(() => useBlockedUsersHydration('next-account'));
    await waitFor(() => expect(hook.result.current.serverHydrationComplete).toBe(true));
    expect(useBlockedUsersStore.getState().blocked.map((b) => b.id)).toEqual(['next-own-block']);
    await hook.unmount();
  });
});
