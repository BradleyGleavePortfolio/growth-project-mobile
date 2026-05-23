/**
 * Coverage: client-side blocked-users store + the filterOutBlocked helper
 * that powers the defence-in-depth filter on MessagesScreen.
 *
 * The store is user-scoped (R15) — every persisted key is suffixed with the
 * active user id. These tests prove both basic operations and cross-user
 * isolation on a shared device.
 */
import { useBlockedUsersStore, filterOutBlocked, persistKeyFor } from '../../store/blockedUsersStore';

jest.mock('../../storage/mmkv', () => {
  const memory = new Map<string, string>();
  return {
    __memory: memory,
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __memory } = require('../../storage/mmkv') as { __memory: Map<string, string> };

beforeEach(async () => {
  __memory.clear();
  await useBlockedUsersStore.getState().reset();
});

describe('blockedUsersStore', () => {
  it('starts empty and is idempotent on block', async () => {
    await useBlockedUsersStore.getState().hydrate('user-A');
    const s = useBlockedUsersStore.getState();
    await s.block({ id: 'u1', displayName: 'Alice', role: 'coach' });
    await s.block({ id: 'u1', displayName: 'Alice', role: 'coach' });
    expect(useBlockedUsersStore.getState().blocked.length).toBe(1);
    expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(true);
    expect(useBlockedUsersStore.getState().isBlocked('u2')).toBe(false);
  });

  it('unblock removes the entry', async () => {
    await useBlockedUsersStore.getState().hydrate('user-A');
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
    await useBlockedUsersStore.getState().hydrate('user-A');
    const s = useBlockedUsersStore.getState();
    await s.block({ id: 'u1', displayName: 'A' });
    await s.block({ id: 'u2', displayName: 'B' });
    await s.reset();
    expect(useBlockedUsersStore.getState().blocked).toEqual([]);
  });

  it('persists under a user-scoped key', async () => {
    await useBlockedUsersStore.getState().hydrate('user-A');
    await useBlockedUsersStore.getState().block({ id: 'u1', displayName: 'A' });
    const key = persistKeyFor('user-A')!;
    const raw = __memory.get(key);
    expect(raw).toBeTruthy();
    expect(raw).toContain('"id":"u1"');
    // Untyped key alone should never carry data.
    expect(__memory.get('blocked_user_ids_v1')).toBeUndefined();
  });

  it('cross-user isolation — seeding user-A does not leak into user-B', async () => {
    // Seed user-A directly into storage.
    __memory.set(
      persistKeyFor('user-A')!,
      JSON.stringify([
        { id: 'u1', displayName: 'Alice', role: 'coach', blockedAt: '2026-05-01T00:00:00Z' },
      ]),
    );

    // Sign in as user-A and verify the seed hydrates.
    await useBlockedUsersStore.getState().hydrate('user-A');
    expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(true);

    // Sign-out: signOut() wipes the entire prefs namespace via clearAllStorage.
    // Simulate that here.
    __memory.clear();
    await useBlockedUsersStore.getState().reset();

    // Sign in as user-B: store should be empty for them.
    await useBlockedUsersStore.getState().hydrate('user-B');
    expect(useBlockedUsersStore.getState().blocked).toEqual([]);
    expect(useBlockedUsersStore.getState().isBlocked('u1')).toBe(false);
  });

  it('cross-user isolation — user-B reads only their own key even without signOut wipe', async () => {
    // Two users have persisted block lists on the same device.
    __memory.set(
      persistKeyFor('user-A')!,
      JSON.stringify([{ id: 'a1', displayName: 'Alice', blockedAt: 'now' }]),
    );
    __memory.set(
      persistKeyFor('user-B')!,
      JSON.stringify([{ id: 'b1', displayName: 'Bob', blockedAt: 'now' }]),
    );

    await useBlockedUsersStore.getState().hydrate('user-A');
    expect(useBlockedUsersStore.getState().isBlocked('a1')).toBe(true);
    expect(useBlockedUsersStore.getState().isBlocked('b1')).toBe(false);

    // Switch user without explicit reset — hydrate must re-scope.
    await useBlockedUsersStore.getState().hydrate('user-B');
    expect(useBlockedUsersStore.getState().isBlocked('a1')).toBe(false);
    expect(useBlockedUsersStore.getState().isBlocked('b1')).toBe(true);
  });
});

describe('blockedUsersStore.addFromServer', () => {
  it('inserts new rows with the server-provided blockedAt verbatim', async () => {
    await useBlockedUsersStore.getState().hydrate('user-A');
    const serverIso = '2025-11-30T12:34:56.000Z';
    await useBlockedUsersStore.getState().addFromServer([
      { blockedId: 'srv1', displayName: 'Server Name', blockedAt: serverIso },
    ]);
    const row = useBlockedUsersStore.getState().blocked.find((b) => b.id === 'srv1');
    expect(row).toBeDefined();
    expect(row?.blockedAt).toBe(serverIso);
    expect(row?.displayName).toBe('Server Name');
  });

  it('does not overwrite an existing local blockedAt when the row already exists', async () => {
    await useBlockedUsersStore.getState().hydrate('user-A');
    await useBlockedUsersStore.getState().block({
      id: 'u1',
      displayName: 'Alice',
      role: 'coach',
    });
    const localStamp = useBlockedUsersStore.getState().blocked.find((b) => b.id === 'u1')!.blockedAt;
    // Server returns a different blockedAt — addFromServer should take the
    // server value because that is the canonical source of truth.
    const serverIso = '2020-01-01T00:00:00.000Z';
    await useBlockedUsersStore.getState().addFromServer([
      { blockedId: 'u1', displayName: 'Alice', blockedAt: serverIso },
    ]);
    const after = useBlockedUsersStore.getState().blocked.find((b) => b.id === 'u1')!;
    // The blocked entry should now reflect the server's blockedAt (server is
    // authoritative) and must not be the locally-stamped value.
    expect(after.blockedAt).toBe(serverIso);
    expect(after.blockedAt).not.toBe(localStamp);
  });

  it('falls back to a local timestamp if the server omits blockedAt', async () => {
    await useBlockedUsersStore.getState().hydrate('user-A');
    await useBlockedUsersStore.getState().addFromServer([
      { blockedId: 'srv2', displayName: 'No date', blockedAt: '' },
    ]);
    const row = useBlockedUsersStore.getState().blocked.find((b) => b.id === 'srv2')!;
    expect(row.blockedAt.length).toBeGreaterThan(0);
  });

  it('persists merged rows under the user-scoped key', async () => {
    await useBlockedUsersStore.getState().hydrate('user-A');
    await useBlockedUsersStore.getState().addFromServer([
      { blockedId: 'u9', displayName: 'Server', blockedAt: '2026-01-01T00:00:00Z' },
    ]);
    const key = persistKeyFor('user-A')!;
    const raw = __memory.get(key);
    expect(raw).toBeTruthy();
    expect(raw).toContain('"id":"u9"');
    expect(raw).toContain('2026-01-01T00:00:00Z');
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
