/**
 * blockedUsersStore — Apple 1.2 compliance store for blocked users.
 *
 * Series D+ requirement: any 1:1 social/DM surface must let a user block
 * another user and have that block applied client-side as defence in depth —
 * the backend also enforces the block on send and on list, but the mobile
 * client must filter out messages from blocked users in case stale messages
 * arrive over the realtime channel or via cached pages.
 *
 * Persistence: the list is keyed per-user (`blocked_user_ids_v1:${userId}`,
 * R15) so two users on the same device never inherit each other's blocks. On
 * signOut() the prefs MMKV namespace is wiped wholesale (see authActions.ts
 * `clearAllStorage()`), which drops every user's persisted block list — the
 * next sign-in re-hydrates from the server via GET /users/blocks.
 */
import { create } from 'zustand';
import { prefsStorage } from '../storage/mmkv';

const PERSIST_PREFIX = 'blocked_user_ids_v1';

export function persistKeyFor(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${PERSIST_PREFIX}:${userId}`;
}

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
  /** The user id currently scoping this store. null until hydrate() runs. */
  userId: string | null;
  hydrate: (userId: string) => Promise<void>;
  block: (user: Omit<BlockedUser, 'blockedAt'>) => Promise<void>;
  unblock: (id: string) => Promise<void>;
  isBlocked: (id: string) => boolean;
  /** Wipe all in-memory state and the persisted entry for the active user. */
  reset: () => Promise<void>;
}

async function persistList(userId: string | null, blocked: BlockedUser[]): Promise<void> {
  const key = persistKeyFor(userId);
  if (!key) return;
  try {
    await prefsStorage.set(key, JSON.stringify(blocked));
  } catch {
    // Non-fatal — the in-memory state still reflects the block this session.
  }
}

function parseList(raw: string): BlockedUser[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
      .map((u): BlockedUser => {
        const role: BlockedUser['role'] =
          u.role === 'coach' || u.role === 'client' || u.role === 'student'
            ? u.role
            : 'other';
        return {
          id: String(u.id ?? ''),
          displayName: typeof u.displayName === 'string' ? u.displayName : '',
          role,
          blockedAt:
            typeof u.blockedAt === 'string' ? u.blockedAt : new Date().toISOString(),
        };
      })
      .filter((u) => u.id.length > 0);
  } catch {
    return [];
  }
}

export const useBlockedUsersStore = create<BlockedUsersState>((set, get) => ({
  blocked: [],
  hydrated: false,
  userId: null,

  hydrate: async (userId: string) => {
    if (!userId) return;
    const state = get();
    if (state.hydrated && state.userId === userId) return;
    // Switching users — start clean before reading the new key.
    set({ blocked: [], hydrated: false, userId });
    const key = persistKeyFor(userId);
    if (!key) {
      set({ hydrated: true });
      return;
    }
    try {
      const sync = prefsStorage.getString(key);
      const raw = sync ?? (await prefsStorage.getStringAsync(key));
      if (raw) set({ blocked: parseList(raw) });
    } catch {
      // Corrupt cache — start clean.
    } finally {
      set({ hydrated: true });
    }
  },

  block: async (user) => {
    const now = new Date().toISOString();
    const uid = get().userId;
    set((s) => {
      const without = s.blocked.filter((b) => b.id !== user.id);
      const next = [...without, { ...user, blockedAt: now }];
      void persistList(uid, next);
      return { blocked: next };
    });
  },

  unblock: async (id) => {
    const uid = get().userId;
    set((s) => {
      const next = s.blocked.filter((b) => b.id !== id);
      void persistList(uid, next);
      return { blocked: next };
    });
  },

  isBlocked: (id) => {
    if (!id) return false;
    return get().blocked.some((b) => b.id === id);
  },

  reset: async () => {
    const key = persistKeyFor(get().userId);
    if (key) {
      try {
        await prefsStorage.delete(key);
      } catch {
        /* non-fatal */
      }
    }
    set({ blocked: [], hydrated: false, userId: null });
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
