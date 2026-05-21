/**
 * blockedUsersStore — Apple 1.2 compliance store for blocked users.
 *
 * Series D+ requirement: any 1:1 social/DM surface must let a user block
 * another user and have that block applied client-side as defence in depth —
 * the backend also enforces the block on send and on list, but the mobile
 * client must filter out messages from blocked users in case stale messages
 * arrive over the realtime channel or via cached pages.
 *
 * State is persisted to MMKV (prefs namespace, non-encrypted — the list of
 * blocked user IDs is not sensitive, and persisting it survives app restarts
 * before a backend round-trip resolves). On logout the store is reset via
 * `reset()` so the next user does not inherit the previous user's blocklist.
 */
import { create } from 'zustand';
import { prefsStorage } from '../storage/mmkv';

const PERSIST_KEY = 'blocked_user_ids_v1';

export interface BlockedUser {
  /** The blocked user's id (matches sender_id on messages). */
  id: string;
  /** Display name captured at block time so the BlockedUsersScreen can render
   *  without a follow-up profile fetch when offline. */
  displayName: string;
  /** Role label captured at block time. */
  role?: 'coach' | 'client' | 'student' | 'other';
  /** ISO timestamp of when the block was created locally. */
  blockedAt: string;
}

interface BlockedUsersState {
  blocked: BlockedUser[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  block: (user: Omit<BlockedUser, 'blockedAt'>) => Promise<void>;
  unblock: (id: string) => Promise<void>;
  isBlocked: (id: string) => boolean;
  reset: () => Promise<void>;
}

async function persist(blocked: BlockedUser[]): Promise<void> {
  try {
    await prefsStorage.set(PERSIST_KEY, JSON.stringify(blocked));
  } catch {
    // Non-fatal — the in-memory state still reflects the block this session.
  }
}

export const useBlockedUsersStore = create<BlockedUsersState>((set, get) => ({
  blocked: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const sync = prefsStorage.getString(PERSIST_KEY);
      const raw = sync ?? (await prefsStorage.getStringAsync(PERSIST_KEY));
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const cleaned: BlockedUser[] = parsed
            .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
            .map((u) => ({
              id: String(u.id ?? ''),
              displayName: typeof u.displayName === 'string' ? u.displayName : '',
              role:
                u.role === 'coach' || u.role === 'client' || u.role === 'student'
                  ? u.role
                  : 'other',
              blockedAt:
                typeof u.blockedAt === 'string' ? u.blockedAt : new Date().toISOString(),
            }))
            .filter((u) => u.id.length > 0);
          set({ blocked: cleaned });
        }
      }
    } catch {
      // Corrupt cache — start clean. Real reads will repopulate.
    } finally {
      set({ hydrated: true });
    }
  },

  block: async (user) => {
    const now = new Date().toISOString();
    set((s) => {
      const without = s.blocked.filter((b) => b.id !== user.id);
      const next = [...without, { ...user, blockedAt: now }];
      void persist(next);
      return { blocked: next };
    });
  },

  unblock: async (id) => {
    set((s) => {
      const next = s.blocked.filter((b) => b.id !== id);
      void persist(next);
      return { blocked: next };
    });
  },

  isBlocked: (id) => {
    if (!id) return false;
    return get().blocked.some((b) => b.id === id);
  },

  reset: async () => {
    try {
      await prefsStorage.delete(PERSIST_KEY);
    } catch {
      /* non-fatal */
    }
    set({ blocked: [], hydrated: true });
  },
}));

/** Pure helper — filter a list of messages, removing any whose sender_id is blocked. */
export function filterOutBlocked<T extends { sender_id?: string | null }>(
  messages: T[],
  blockedIds: ReadonlyArray<string>,
): T[] {
  if (blockedIds.length === 0) return messages;
  const set = new Set(blockedIds);
  return messages.filter((m) => !m.sender_id || !set.has(m.sender_id));
}
