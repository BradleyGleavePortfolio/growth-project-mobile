// PersistedQueryCacheGate — identity boundary for the persisted React Query
// cache (S6-P1).
//
// Replaces the import-time PersistQueryClientProvider composition, whose
// persister key was fixed at module load (always ':anonymous' on
// AsyncStorage-shim builds) and could not follow the signed-in identity.
//
// Contract:
//   `userId` is the COMMITTED bootstrap identity supplied by RootNavigator:
//     undefined — bootstrap outcome unknown yet: nothing is read, written,
//                 cleared or purged; children stay unmounted;
//     null      — committed logged-out: memory is cleared and every persisted
//                 cache key is purged before unauthenticated children mount;
//                 nothing is persisted while logged out;
//     string    — committed user: that user's own key is restored (bounded)
//                 before that user's children mount, then kept in sync.
//
//   Children are rendered only while `committed === userId`. Any identity
//   change therefore unmounts the previous identity's children in the same
//   React commit that schedules the transition effect — structurally, no
//   replacement child can ever observe the previous identity's memory, and the
//   previous children's observers have detached before the cache is cleared.
//
//   Transition order (explicit, same for A→B, A→null, null→A, interrupted):
//     1. retire the previous persistence (unsubscribe + write fence)
//     2. drain its in-flight storage writes (bounded)
//     3. settleAndClearQueryCache() — cancel fetches, detach observers, clear
//     4. null: purge every persisted cache key;  user: restore own key (bounded)
//     5. commit → children mount
//   A transition that is superseded mid-flight — by the next identity OR by the
//   gate unmounting — is invalidated synchronously in the effect cleanup and
//   stops at its next checkpoint without clearing, hydrating, creating or
//   subscribing anything; the cleanup also retires whatever that transition
//   had created, so no persistence outlives its gate instance (S6-P2, S6-A-01).
//   Late completions of a retired persistence are fenced inside
//   createIdentityPersistence (restore→hydrate boundary, actual setItem,
//   fail-closed removal after an expired drain); signOut() drains them.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  createIdentityPersistence,
  purgePersistedQueryCacheForAllUsers,
  settleAndClearQueryCache,
} from './queryClient';
import type { IdentityPersistence } from './queryClient';

/** Upper bound on the restoring phase for one identity (hung storage read). */
export const PERSISTED_CACHE_RESTORE_TIMEOUT_MS = 4000;
/** Upper bound on waiting for the previous identity's in-flight writes. */
export const PERSISTED_CACHE_DRAIN_TIMEOUT_MS = 1000;

export interface PersistedQueryCacheGateProps {
  userId: string | null | undefined;
  children: React.ReactNode;
  /** Optional placeholder while restoring; defaults to a centered spinner. */
  renderRestoring?: () => React.ReactElement | null;
}

export function PersistedQueryCacheGate({ userId, children, renderRestoring }: PersistedQueryCacheGateProps) {
  // undefined = nothing committed yet (never equal to a real identity because
  // the render guard below also requires userId !== undefined).
  const [committed, setCommitted] = useState<string | null | undefined>(undefined);
  const activeRef = useRef<IdentityPersistence | null>(null);
  // Persistences that have been retired but whose in-flight writes have not
  // been drained yet. A transition that is superseded mid-drain leaves its
  // entries here so the superseding transition drains them instead of losing
  // them (interrupted A→B→A / A→B→null paths).
  const retiredRef = useRef<Set<IdentityPersistence>>(new Set());
  // True once an identity-bound restore could have put private data into the
  // shared client. Until then (cold boot before the first commit) there is no
  // previous identity memory to clear, and clearing would needlessly cancel
  // queries owned by providers mounted ABOVE this gate.
  const memoryDirtyRef = useRef(false);
  const transitionRef = useRef(0);

  useEffect(() => {
    if (userId === undefined) {
      // Bootstrap unknown: hold. Whatever was active stays retired by the
      // cleanup below; no storage or cache side effects until a real outcome.
      return undefined;
    }
    const transition = ++transitionRef.current;
    const isCurrent = () => transitionRef.current === transition;
    const retired = retiredRef.current;
    if (activeRef.current) retired.add(activeRef.current);
    activeRef.current = null;
    // Step 1 (idempotent — the cleanup of the previous effect already fenced it).
    retired.forEach((persistence) => persistence.retire());
    // The persistence THIS transition creates (step 4), so the cleanup can
    // retire it even while activeRef is still null (drain/clear in progress).
    let created: IdentityPersistence | null = null;

    (async () => {
      // Step 2.
      if (retired.size) {
        const draining = Array.from(retired);
        await Promise.all(
          draining.map((persistence) => persistence.drain({ timeoutMs: PERSISTED_CACHE_DRAIN_TIMEOUT_MS })),
        );
        if (!isCurrent()) return;
        // Drained or fenced fail-closed: no longer this gate's concern.
        draining.forEach((persistence) => retired.delete(persistence));
      }
      // Superseded (next identity or unmount) while nothing was pending: stop
      // before touching the shared client.
      if (!isCurrent()) return;
      // Step 3. The previous identity's children were unmounted in the commit
      // that scheduled this effect (their passive cleanups ran first), so the
      // clear runs after their observers detached.
      if (memoryDirtyRef.current) {
        const cleared = await settleAndClearQueryCache(undefined, { shouldContinue: isCurrent });
        if (!cleared || !isCurrent()) return;
        memoryDirtyRef.current = false;
      }
      // Step 4.
      if (userId === null) {
        await purgePersistedQueryCacheForAllUsers();
        if (!isCurrent()) return;
        setCommitted(null);
        return;
      }
      const next = createIdentityPersistence(userId);
      created = next;
      activeRef.current = next;
      // From here a restore may hydrate this identity's private data.
      memoryDirtyRef.current = true;
      await next.restore({ timeoutMs: PERSISTED_CACHE_RESTORE_TIMEOUT_MS });
      // A later transition retired `next` and took over; it never commits.
      if (!isCurrent() || next.isRetired()) return;
      // Step 5.
      setCommitted(userId);
    })();

    return () => {
      // Invalidate this transition synchronously: a body suspended in drain,
      // clear, purge or restore fails its next isCurrent() checkpoint and can
      // no longer clear, hydrate, create or subscribe (S6-A-01). The next
      // effect, if any, bumps the counter again.
      transitionRef.current += 1;
      // Fence the persistence this transition created as soon as the identity
      // changes or the gate unmounts, and hand it to the next transition (same
      // instance) for draining; signOut() drains it otherwise.
      const owned = created;
      if (owned) {
        owned.retire();
        retiredRef.current.add(owned);
        if (activeRef.current === owned) activeRef.current = null;
      }
    };
  }, [userId]);

  const isCommitted = userId !== undefined && committed === userId;
  if (!isCommitted) {
    if (renderRestoring) return renderRestoring();
    return (
      <View style={styles.restoring}>
        <ActivityIndicator testID="persisted-cache-restoring" />
      </View>
    );
  }
  return <>{children}</>;
}

export default PersistedQueryCacheGate;

const styles = StyleSheet.create({
  restoring: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
