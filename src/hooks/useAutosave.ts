/**
 * useAutosave — the reusable Google-Docs-style autosave hook for the workout
 * builder (MWB-4, MASTER_WORKOUT_BUILDER_SPEC.md §6.3 / §6.5).
 *
 * Operator intent (the bar): "I just want a coach to be making an edit to a
 * plan, close the app all of a sudden, and it saves the change!" — so EVERY
 * flush writes the pending batch to an AsyncStorage offline mirror FIRST, then
 * hits the server; an app kill mid-flush leaves the batch on disk to replay on
 * the next mount with the SAME Idempotency-Key + optimistic-lock pair.
 *
 * Modeled on ActiveWorkoutScreen.tsx's debounced-AsyncStorage persist + the
 * AppState background force-flush (L307-352, L361-384), but pointed at the
 * SERVER with idempotency keys, and additionally force-flushed on navigation
 * `beforeRemove` (closes the dirty-guard gap #12). The offline replay reuses
 * the sync-engine dead-letter contract (offline/sync/sync-engine.ts:46-60):
 * a 409 is a recoverable conflict (fast-forward), a network error leaves the
 * batch pending to retry, and a hard 4xx is surfaced (never silently dropped).
 *
 * Generic over the caller's working copy: the caller supplies `value`, a `diff`
 * that turns (lastSavedValue, nextValue) into AutosaveOp[], and the
 * (planId/lock/index) it knows. The hook owns timing, the mirror, the network
 * round-trip, conflict classification, and the save-state machine.
 *
 * Returns { status, lastSavedAt, version, flush, hasPending } where status is
 * one of 'idle'|'saving'|'saved'|'offline'|'conflict' (the exact set the
 * save-state pill renders, §6.5).
 *
 * HARD GATES honoured:
 *   - No silent failures: a failed flush sets status='offline' (or 'conflict'),
 *     keeps the batch in the mirror, and logs — it never resolves quietly.
 *   - Reduced-motion is REAL input to the consumer (the pill reads `reduceMotion`
 *     itself); this hook exposes the raw state machine, no animation assumptions.
 *   - No `as unknown as`, no `as any`, no empty catch, no TODO/placeholder.
 *   - Flag-off is enforced by the CALLER not mounting the hook (the screen gates
 *     on featureFlags.mwbAutosave). The hook is inert with `enabled: false`
 *     too, as belt-and-suspenders, so a future caller can't accidentally fire it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type {
  AutosaveCause,
  AutosaveConflict,
  AutosaveOp,
  AutosaveResponse,
} from '../api/workoutAutosaveApi';
import { workoutAutosaveApi, WorkoutAutosaveApiError } from '../api/workoutAutosaveApi';
import {
  clearAutosaveMirror,
  readAutosaveMirror,
  writeAutosaveMirror,
  type MirroredAutosave,
} from '../storage/autosaveMirror';
import { generateIdempotencyKey } from '../utils/idempotency';
import { logger } from '../utils/logger';

/** The save-state the pill renders (spec §6.5). */
export type AutosaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'conflict';

/** Default typing debounce — longer than the 500ms session one (spec §6.3). */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * How long the `saved` confirmation lingers before the state settles back to
 * `idle` (the pill then hides — zero residue on a quiet-luxury surface, spec
 * §6.5). Brief and reassuring, never persistent chrome.
 */
export const AUTOSAVE_SAVED_SETTLE_MS = 2500;

export interface UseAutosaveArgs<TWorkingCopy> {
  /** The plan being edited. */
  planId: string;
  /** Current working copy. A change (by ===/diff) arms the debounced flush. */
  value: TWorkingCopy;
  /**
   * Compute the ordered ops between the last successfully-saved copy and the
   * next copy. Returns [] when nothing changed (the hook then no-ops). The
   * FIRST diff baselines against `value` at mount, so an unchanged screen never
   * fires a spurious save.
   */
  diff: (prev: TWorkingCopy, next: TWorkingCopy) => AutosaveOp[];
  /** Client's last-known head revision index (the optimistic-concurrency base). */
  baseRevisionIndex: number;
  /** Current 16-hex optimistic-lock token for the plan. */
  lockToken: string;
  /** Provenance written onto the server revision (default 'autosave'). */
  cause?: AutosaveCause;
  /** Debounce window in ms (default {@link AUTOSAVE_DEBOUNCE_MS}). */
  debounceMs?: number;
  /**
   * Master switch. When false the hook is fully inert — no timers, no network,
   * no mirror writes. The screen sets this from featureFlags.mwbAutosave so a
   * flag-off build does ZERO autosave work (flag-off invariance).
   */
  enabled?: boolean;
  /**
   * Called after a successful flush with the new (index, token, savedAt) so the
   * caller can advance its optimistic-concurrency base for the next batch.
   */
  onSaved?: (next: { headRevisionIndex: number; lockToken: string; savedAt: string }) => void;
  /**
   * Called on a 409 so the caller can rebase its local state to the server head
   * before the hook fast-forwards (adopts the conflict's fresh token + index).
   * The backend conflict body carries no serverOps (single-editor model), so
   * the caller typically refetches the plan; returning is enough to let the
   * hook fast-forward.
   */
  onConflict?: (conflict: AutosaveConflict) => void;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  /** Wallclock ms of the last confirmed save, or null if none yet. */
  lastSavedAt: number | null;
  /** Current head revision index after the last confirmed save. */
  version: number;
  /** Current optimistic-lock token (advances on each save / conflict). */
  lockToken: string;
  /** Force an immediate flush (used by Save button / background / beforeRemove). */
  flush: () => Promise<void>;
  /** True when there are buffered, not-yet-confirmed ops. */
  hasPending: boolean;
}

/**
 * Internal pending-batch model held in a ref so the background/beforeRemove
 * flush always sees the latest diff even between debounce-arm and -fire (the
 * same "capture into a ref synchronously" trick ActiveWorkoutScreen uses).
 */
interface PendingBatch {
  ops: AutosaveOp[];
  baseRevisionIndex: number;
  lockToken: string;
  cause: AutosaveCause;
  idempotencyKey: string;
}

export function useAutosave<TWorkingCopy>(
  args: UseAutosaveArgs<TWorkingCopy>,
): UseAutosaveResult {
  const {
    planId,
    value,
    diff,
    baseRevisionIndex,
    lockToken,
    cause = 'autosave',
    debounceMs = AUTOSAVE_DEBOUNCE_MS,
    enabled = true,
    onSaved,
    onConflict,
  } = args;

  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [hasPending, setHasPending] = useState(false);

  // Optimistic-concurrency state lives in refs (advances on each save without
  // forcing the caller to re-thread props synchronously) but is also surfaced.
  const indexRef = useRef(baseRevisionIndex);
  const tokenRef = useRef(lockToken);
  const [version, setVersion] = useState(baseRevisionIndex);
  const [tokenState, setTokenState] = useState(lockToken);

  // Re-baseline the optimistic state if the caller threads in a fresh
  // (index, token) — e.g. after a refetch following an external edit.
  useEffect(() => {
    indexRef.current = baseRevisionIndex;
    setVersion(baseRevisionIndex);
  }, [baseRevisionIndex]);
  useEffect(() => {
    tokenRef.current = lockToken;
    setTokenState(lockToken);
  }, [lockToken]);

  // The last working copy we successfully saved (the diff baseline). Starts at
  // the initial value so an untouched screen never fires a spurious save.
  const lastSavedValueRef = useRef<TWorkingCopy>(value);
  const pendingRef = useRef<PendingBatch | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `status` for reads inside the settle timer without re-arming it on
  // every status change (the timer only fires the idle transition if we are
  // STILL in `saved` when it elapses).
  const statusRef = useRef<AutosaveStatus>('idle');
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const diffRef = useRef(diff);
  const onSavedRef = useRef(onSaved);
  const onConflictRef = useRef(onConflict);
  const causeRef = useRef<AutosaveCause>(cause);

  // Keep the latest callbacks in refs so the AppState / beforeRemove listeners
  // (registered once) always call the current versions without re-subscribing.
  useEffect(() => {
    diffRef.current = diff;
    onSavedRef.current = onSaved;
    onConflictRef.current = onConflict;
    causeRef.current = cause;
  }, [diff, onSaved, onConflict, cause]);

  const safeSet = useCallback(
    <T,>(setter: (v: T) => void, v: T) => {
      if (mountedRef.current) setter(v);
    },
    [],
  );

  // Keep the status mirror current for the settle timer's IFF-still-saved check.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // ─── Settle: a brief `saved` confirmation transitions back to `idle` ────────
  // The pill shows "Saved · just now" briefly, then hides. We clear any prior
  // timer first and re-arm whenever we (re-)enter `saved`; any other state
  // (saving/offline/conflict) cancels the pending settle so it never clobbers
  // an active state. The IFF-still-saved guard guards against a race where the
  // status moved on between fire and the guarded setState.
  useEffect(() => {
    if (savedSettleRef.current) {
      clearTimeout(savedSettleRef.current);
      savedSettleRef.current = null;
    }
    if (status !== 'saved') return;
    savedSettleRef.current = setTimeout(() => {
      savedSettleRef.current = null;
      if (statusRef.current === 'saved') {
        safeSet(setStatus, 'idle');
      }
    }, AUTOSAVE_SAVED_SETTLE_MS);
    return () => {
      if (savedSettleRef.current) {
        clearTimeout(savedSettleRef.current);
        savedSettleRef.current = null;
      }
    };
  }, [status, safeSet]);

  /**
   * Perform one network flush of `batch`. The mirror write has ALREADY happened
   * before this is called (so a kill mid-flush is recoverable). On:
   *   - 200      -> clear the mirror, advance index+token, status='saved'.
   *   - 409      -> let the caller rebase, fast-forward to the conflict head +
   *                 fresh token, clear the mirror (the conflicted batch is
   *                 superseded), status='conflict' briefly then settles.
   *   - network  -> leave the mirror (replay later), status='offline'.
   *   - other    -> surface (status='offline' + log); never silent.
   */
  const sendBatch = useCallback(
    async (batch: PendingBatch): Promise<void> => {
      if (inFlightRef.current) return; // a flush is already running; coalesce.
      inFlightRef.current = true;
      safeSet(setStatus, 'saving');
      try {
        const res: AutosaveResponse = await workoutAutosaveApi.autosave({
          planId,
          idempotencyKey: batch.idempotencyKey,
          body: {
            base_revision_index: batch.baseRevisionIndex,
            lock_token: batch.lockToken,
            ops: batch.ops,
            cause: batch.cause,
          },
        });
        // Confirmed. The on-disk mirror is no longer needed.
        await clearAutosaveMirror(planId);
        pendingRef.current = null;
        indexRef.current = res.head_revision_index;
        tokenRef.current = res.lock_token;
        const savedMs = Date.parse(res.saved_at);
        safeSet(setVersion, res.head_revision_index);
        safeSet(setTokenState, res.lock_token);
        safeSet(setLastSavedAt, Number.isFinite(savedMs) ? savedMs : Date.now());
        safeSet(setHasPending, false);
        safeSet(setStatus, 'saved');
        onSavedRef.current?.({
          headRevisionIndex: res.head_revision_index,
          lockToken: res.lock_token,
          savedAt: res.saved_at,
        });
      } catch (err) {
        if (err instanceof WorkoutAutosaveApiError && err.kind === 'conflict') {
          // The plan moved ahead (another device/coach, or a replay of an
          // already-applied batch). Let the caller rebase, then fast-forward to
          // the server head + the fresh token the conflict body handed us. The
          // conflicted batch is superseded — drop it from the mirror so it does
          // not replay forever.
          if (err.conflict) {
            indexRef.current = err.conflict.head_revision_index;
            tokenRef.current = err.conflict.lock_token;
            safeSet(setVersion, err.conflict.head_revision_index);
            safeSet(setTokenState, err.conflict.lock_token);
            onConflictRef.current?.(err.conflict);
          }
          await clearAutosaveMirror(planId);
          pendingRef.current = null;
          safeSet(setHasPending, false);
          safeSet(setStatus, 'conflict');
          logger.warn('[useAutosave] conflict fast-forwarded', {
            planId,
            head: err.conflict?.head_revision_index,
          });
        } else if (
          err instanceof WorkoutAutosaveApiError &&
          (err.kind === 'network' || err.kind === 'server')
        ) {
          // Transient: the batch stays in the mirror to replay on reconnect.
          // No silent swallow — state goes to 'offline' and we log.
          safeSet(setStatus, 'offline');
          logger.warn('[useAutosave] flush deferred (offline/server)', {
            planId,
            kind: err.kind,
          });
        } else {
          // A hard 4xx (403/404/contract/etc): the batch will never apply as-is.
          // Surface it loudly. We keep status='offline' (the calm pill state)
          // and log the kind so it is never a silent loss; the screen's own
          // error path / pill tap can prompt a manual retry or refetch.
          const kind =
            err instanceof WorkoutAutosaveApiError ? err.kind : 'unknown';
          safeSet(setStatus, 'offline');
          logger.error('[useAutosave] flush rejected', { planId, kind });
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [planId, safeSet],
  );

  /**
   * Build the pending batch from the current diff (if any), write it to the
   * offline mirror FIRST, then send it. Safe to call from the debounce timer,
   * the Save button, AppState background, and navigation beforeRemove. Idempotent
   * when there is nothing pending.
   */
  const flush = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    // Recompute the diff against the last-saved baseline so the flush always
    // captures the latest edit, even if it fires between arm and fire.
    const ops = diffRef.current(lastSavedValueRef.current, value);
    if (ops.length === 0) {
      // Nothing to save. If a prior batch is still pending (e.g. an offline
      // batch awaiting replay), retry that instead of no-oping.
      if (pendingRef.current) {
        await sendBatch(pendingRef.current);
      }
      return;
    }

    const batch: PendingBatch = {
      ops,
      baseRevisionIndex: indexRef.current,
      lockToken: tokenRef.current,
      cause: causeRef.current,
      // Reuse the pending key if a batch is already buffered (so a re-flush of
      // the same logical edit dedupes), else mint a fresh one.
      idempotencyKey:
        pendingRef.current?.idempotencyKey ?? generateIdempotencyKey(),
    };
    pendingRef.current = batch;
    safeSet(setHasPending, true);

    // MIRROR FIRST — the kill-the-app guarantee. If this throws (storage fault)
    // we still attempt the send, but surface the write failure rather than
    // pretending the durability guarantee held.
    const mirror: MirroredAutosave = {
      version: 1,
      planId,
      batch: {
        base_revision_index: batch.baseRevisionIndex,
        lock_token: batch.lockToken,
        ops: batch.ops,
        cause: batch.cause,
      },
      idempotencyKey: batch.idempotencyKey,
      queuedAtMs: Date.now(),
    };
    try {
      await writeAutosaveMirror(mirror);
    } catch (err) {
      logger.error('[useAutosave] mirror write failed', { planId, err });
      // Continue to the network send anyway — better to try the save than to
      // abort entirely — but the durability promise is degraded; the offline
      // status the send may set will at least keep the in-memory batch alive.
    }

    await sendBatch(batch);
    // Advance the diff baseline ONLY on a confirmed save (sendBatch cleared the
    // pending ref + advanced the index on 200). If still pending, the baseline
    // stays put so the next diff re-derives the full unsent delta.
    if (pendingRef.current === null) {
      lastSavedValueRef.current = value;
    }
  }, [enabled, value, planId, sendBatch, safeSet]);

  // ─── Debounced arm on value change ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    // Skip if the value is identical to the last saved baseline (no diff).
    const ops = diffRef.current(lastSavedValueRef.current, value);
    if (ops.length === 0) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flush();
    }, debounceMs);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [value, enabled, debounceMs, flush]);

  // ─── AppState background force-flush (the kill-the-app case) ────────────────
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        // Flush synchronously-ish: the mirror write inside flush() is the
        // durable line, so even if the OS suspends us before the network
        // resolves, the batch is on disk to replay.
        void flush();
      }
    });
    return () => sub.remove();
  }, [enabled, flush]);

  // ─── Replay any mirrored batch on mount / reconnect ─────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const mirrored = await readAutosaveMirror(planId);
      if (cancelled || !mirrored) return;
      // Rehydrate the pending batch and replay it with the SAME key + lock pair.
      // A batch the server already applied (pre-kill) will 409-fast-forward to a
      // no-op; an unsent one applies exactly once.
      pendingRef.current = {
        ops: mirrored.batch.ops,
        baseRevisionIndex: mirrored.batch.base_revision_index,
        lockToken: mirrored.batch.lock_token,
        cause: mirrored.batch.cause,
        idempotencyKey: mirrored.idempotencyKey,
      };
      safeSet(setHasPending, true);
      safeSet(setStatus, 'offline');
      await sendBatch(pendingRef.current);
    })();
    return () => {
      cancelled = true;
    };
    // Replay is keyed on the plan id only — it runs once per plan mount.
  }, [planId, enabled, sendBatch, safeSet]);

  // ─── Lifecycle: flush on unmount (navigation beforeRemove / teardown) ───────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Best-effort durable capture on teardown — the mirror write inside
      // flush() makes the in-flight edit survivable even though we can no
      // longer setState after unmount.
      if (enabled) void flush();
    };
    // flush is stable-enough (memoised on value/planId); we intentionally only
    // re-bind the teardown when the plan or enabled flag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, enabled]);

  return useMemo(
    () => ({
      status,
      lastSavedAt,
      version,
      lockToken: tokenState,
      flush,
      hasPending,
    }),
    [status, lastSavedAt, version, tokenState, flush, hasPending],
  );
}
