/**
 * Coverage: client-side blocked-users store + the filterOutBlocked helper
 * that powers the defence-in-depth filter on MessagesScreen.
 *
 * Store is exercised via direct action calls; persistence is mocked because
 * the storage layer is unit-tested in src/storage/__tests__/mmkv.test.ts.
 */
import { useBlockedUsersStore, filterOutBlocked } from '../../store/blockedUsersStore';

jest.mock('../../storage/mmkv', () => {
  const memory = new Map<string, string>();
  return {
    prefsStorage: {
      getString: (k: string) => memory.get(k),
      getStringAsync: async (k: string) => memory.get(k),
      set: async (k: string, v: string | number | boolean) => {
        memory.set(k, String(v));
      },
      delete: async (k: string) => {
        memory.delete(k);
      },
      clearNamespace: async () => {
        memory.clear();
      },
    },
  };
});

beforeEach(async () => {
  await useBlockedUsersStore.getState().reset();
});

describe('blockedUsersStore', () => {
  it('starts empty and is idempotent on block', async () => {
    const s = useBlockedUsersStore.getState();
    await s.block({ id: 'u1', displayName: 'Alice', role: 'coach' });
    await s.block({ id: 'u1', displayName: 'Alice', role: 'coach' });
    expect(useBlockedUsersStore.getState().blocked.length).toBe(1);
    expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(true);
    expect(useBlockedUsersStore.getState().isBlocked('u2')).toBe(false);
  });

  it('unblock removes the entry', async () => {
    const s = useBlockedUsersStore.getState();
    await s.block({ id: 'u1', displayName: 'Alice', role: 'coach' });
    await s.unblock('u1');
    expect(useBlockedUsersStore.getState().blocked.length).toBe(0);
    expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(false);
  });

  it('isBlocked returns false for empty id', () => {
    expect(useBlockedUsersStore.getState().isBlocked('')).toBe(false);
  });

  it('reset clears the in-memory blocked list', async () => {
    const s = useBlockedUsersStore.getState();
    await s.block({ id: 'u1', displayName: 'A' });
    await s.block({ id: 'u2', displayName: 'B' });
    await s.reset();
    expect(useBlockedUsersStore.getState().blocked).toEqual([]);
  });
});

describe('filterOutBlocked', () => {
  const msgs = [
    { id: '1', sender_id: 'u1', body: 'a' },
    { id: '2', sender_id: 'u2', body: 'b' },
    { id: '3', sender_id: 'u1', body: 'c' },
    { id: '4', body: 'd' },
  ];

  it('returns the original list when no ids are blocked', () => {
    expect(filterOutBlocked(msgs, [])).toEqual(msgs);
  });

  it('drops every message whose sender_id matches a blocked id', () => {
    const out = filterOutBlocked(msgs, ['u1']);
    expect(out.map((m) => m.id)).toEqual(['2', '4']);
  });

  it('leaves messages without sender_id alone', () => {
    const out = filterOutBlocked(msgs, ['u1', 'u2']);
    expect(out.map((m) => m.id)).toEqual(['4']);
  });
});
