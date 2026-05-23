/**
 * useBlockedUsersHydration — single source of truth for hydrating the local
 * blocked-users store on every DM surface.
 *
 * Apple 1.2 / Series D+ defence-in-depth: even with backend block enforcement,
 * the mobile client filters out messages from blocked senders before render.
 * That filter only works if the local store knows who is blocked. The local
 * MMKV cache (hydrate(uid)) gives us instant paint, but it can be empty on
 * fresh install, after cache loss, or after the user blocks someone from
 * another device. This hook layers GET /users/blocks on top so the in-memory
 * blocklist converges to the server's authoritative state.
 *
 * The hook preserves the server-provided `blockedAt` timestamp via
 * `store.addFromServer()` rather than stamping `new Date().toISOString()` —
 * the original block timestamp is what Settings → Blocked Users should show.
 */
import { useEffect } from 'react';
import { useBlockedUsersStore } from '../store/blockedUsersStore';
import { messagesModerationApi } from '../api/messagesApi';

export interface UseBlockedUsersHydrationOptions {
  /** When true (the default) the hook will also call listBlocked() once. Set
   *  to false in callers that explicitly own the server fetch themselves
   *  (e.g. BlockedUsersScreen, which needs the loading/error state). */
  fetchServer?: boolean;
}

export interface UseBlockedUsersHydrationResult {
  hydrated: boolean;
}

export function useBlockedUsersHydration(
  userId: string | null | undefined,
  options: UseBlockedUsersHydrationOptions = {},
): UseBlockedUsersHydrationResult {
  const fetchServer = options.fetchServer ?? true;
  const hydrated = useBlockedUsersStore((s) => s.hydrated);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const s = useBlockedUsersStore.getState();
      if (!s.hydrated || s.userId !== userId) {
        await s.hydrate(userId);
      }
      if (cancelled || !fetchServer) return;
      try {
        const res = await messagesModerationApi.listBlocked();
        if (cancelled) return;
        if (res.blocked.length > 0) {
          await useBlockedUsersStore.getState().addFromServer(res.blocked);
        }
      } catch {
        // Non-fatal — local cache + server-side enforcement still apply.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, fetchServer]);

  return { hydrated };
}
