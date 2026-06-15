/**
 * useCanonicalDeleteSet — D7B canonical delete-set abstraction for the coach
 * workout builder (MWB EW2 / D-045).
 *
 * Before this hook, the screen owned two ad-hoc refs side by side:
 *   - `deletedKeysRef: Set<string>`        — clientIds of removed rows
 *   - `deletedSignaturesRef: Map<sig, []>` — FIFO lists of clientIds per
 *                                            composite signature (for id-less
 *                                            rows the diff cannot name yet).
 * They were mutated from several call sites (`removeRow`, the `applyInverse`
 * executor, the adoption guard) with no single owner, and the undo path that
 * RE-ADDS a removed row never cleared them — so an autosave adoption cycle would
 * silently re-drop the just-restored row (prior audit F1).
 *
 * This hook is the single owner of both structures and the consume/clear
 * semantics that bind them. The two structures are deliberately kept (they
 * answer two different questions — "is this clientId deleted?" and "does this
 * server row's signature match a deleted id-less row?"), but mutation is now
 * funnelled through a small, named API so every site treats them consistently
 * and the undo restore path can UNMARK a row exactly the way `removeRow` MARKED
 * it.
 *
 * The set is in-memory only (refs), wiped on screen unmount, exactly as the two
 * refs were. No behavioural change to the autosave adoption guard — only the
 * ownership and the new `unmarkDeleted` restore path are new.
 */

import { useCallback, useMemo, useRef } from 'react';

/** A snapshot mapping consumed by the adoption guard, one entry per signature. */
export type DeletedSignaturePool = Map<string, string[]>;

export interface CanonicalDeleteSet {
  /**
   * Mark a row as deleted. Records the stable `clientId` AND appends it to the
   * FIFO list for its composite `signature` (so a resurrected id-less row can be
   * matched back by signature). Mirrors the original `removeRow` bookkeeping.
   */
  markDeleted: (clientId: string, signature: string) => void;
  /**
   * Reverse of {@link markDeleted} — clears the `clientId` from the key set and
   * consumes ONE matching entry from its signature FIFO list. Called by the undo
   * restore path so a re-added row is no longer treated as deleted by the next
   * adoption cycle. Idempotent: clearing an unmarked key is a no-op.
   */
  unmarkDeleted: (clientId: string, signature: string) => void;
  /** True when `clientId` is currently marked deleted. */
  isDeleted: (clientId: string) => boolean;
  /**
   * True when `signature` has at least one pending deleted id-less row. Does NOT
   * consume; the adoption guard takes a {@link snapshotSignatures} copy and
   * consumes from that so a no-op render never mutates the live pool.
   */
  hasSignature: (signature: string) => boolean;
  /**
   * A shallow copy of the signature pool (lists cloned) for the adoption guard to
   * consume locally without mutating the canonical pool. The guard binds matched
   * server row_ids to clientIds and the later cleanup prunes via
   * {@link unmarkByClientId}.
   */
  snapshotSignatures: () => DeletedSignaturePool;
  /**
   * Prune a clientId from the key set only (used by the adoption cleanup once the
   * server confirms the row is gone). Leaves signature lists alone — they are
   * consumed at match time inside the guard's local snapshot.
   */
  unmarkByClientId: (clientId: string) => void;
  /** Clear the entire delete-set (deliberate reset; unmount wipes anyway). */
  reset: () => void;
}

export function useCanonicalDeleteSet(): CanonicalDeleteSet {
  const keysRef = useRef<Set<string>>(new Set());
  const signaturesRef = useRef<DeletedSignaturePool>(new Map());

  const markDeleted = useCallback((clientId: string, signature: string) => {
    keysRef.current.add(clientId);
    const list = signaturesRef.current.get(signature) ?? [];
    list.push(clientId);
    signaturesRef.current.set(signature, list);
  }, []);

  const unmarkDeleted = useCallback((clientId: string, signature: string) => {
    keysRef.current.delete(clientId);
    const list = signaturesRef.current.get(signature);
    if (list && list.length > 0) {
      // Consume the matching entry (FIFO, mirroring markDeleted's push). Prefer
      // the exact clientId; fall back to the oldest if the id is absent so the
      // list never grows unbounded for a signature that was restored.
      const at = list.indexOf(clientId);
      if (at !== -1) list.splice(at, 1);
      else list.shift();
      if (list.length === 0) signaturesRef.current.delete(signature);
    }
  }, []);

  const isDeleted = useCallback((clientId: string) => keysRef.current.has(clientId), []);

  const hasSignature = useCallback((signature: string) => {
    const list = signaturesRef.current.get(signature);
    return list !== undefined && list.length > 0;
  }, []);

  const snapshotSignatures = useCallback((): DeletedSignaturePool => {
    const copy: DeletedSignaturePool = new Map();
    for (const [sig, list] of signaturesRef.current) copy.set(sig, list.slice());
    return copy;
  }, []);

  const unmarkByClientId = useCallback((clientId: string) => {
    keysRef.current.delete(clientId);
  }, []);

  const reset = useCallback(() => {
    keysRef.current = new Set();
    signaturesRef.current = new Map();
  }, []);

  return useMemo(
    () => ({
      markDeleted,
      unmarkDeleted,
      isDeleted,
      hasSignature,
      snapshotSignatures,
      unmarkByClientId,
      reset,
    }),
    [
      markDeleted,
      unmarkDeleted,
      isDeleted,
      hasSignature,
      snapshotSignatures,
      unmarkByClientId,
      reset,
    ],
  );
}
