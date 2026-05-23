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
import { useEffect, useState } from 'react';
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
  /** True once the initial GET /users/blocks has resolved (success or failure)
   *  — DM surfaces gate message rendering on this flag so a sender blocked on
   *  another device can never flash through before the authoritative server
   *  list arrives. Fails open: a network/API failure still flips this to true
   *  so the UI doesn't hang. When `fetchServer` is false (BlockedUsersScreen
   *  owns its own fetch), this also resolves to true once local hydration is
   *  done, since this hook isn't responsible for server state in that mode. */
  serverHydrationComplete: boolean;
}

export function useBlockedUsersHydration(
  userId: string | null | undefined,
  options: UseBlockedUsersHydrationOptions = {},
): UseBlockedUsersHydrationResult {
  const fetchServer = options.fetchServer ?? true;
  const hydrated = useBlockedUsersStore((s) => s.hydrated);
  const [serverHydrationComplete, setServerHydrationComplete] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setServerHydrationComplete(false);
    (async () => {
      const s = useBlockedUsersStore.getState();
      if (!s.hydrated || s.userId !== userId) {
        await s.hydrate(userId);
      }
      if (cancelled) return;
      if (!fetchServer) {
        setServerHydrationComplete(true);
        return;
      }
      try {
        const res = await messagesModerationApi.listBlocked();
        if (cancelled) return;
        if (res.blocked.length > 0) {
          await useBlockedUsersStore.getState().addFromServer(res.blocked);
        }
      } catch {
        // Non-fatal — local cache + server-side enforcement still apply.
        // Fail open: we still flip serverHydrationComplete to true so the DM
        // surfaces don't hang on a network failure.
      } finally {
        if (!cancelled) setServerHydrationComplete(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, fetchServer]);

  return { hydrated, serverHydrationComplete };
}
