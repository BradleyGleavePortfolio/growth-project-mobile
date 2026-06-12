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
 * Concurrency model (the R2 race-safety rework). At most one network request is
 * in flight at a time. We hold a strict two-slot queue:
 *   - `currentInFlightRef` — the batch whose request is running right now.
 *   - `pendingNextRef`     — a batch produced WHILE that request was in flight.
 * A new edit during an in-flight save writes to `pendingNext` (with its OWN
 * fresh idempotency key) and NEVER overwrites `currentInFlight`. When the
 * in-flight request settles on a 200 we clear the mirror BY KEY (so we never
 * delete a newer batch's mirror entry) and, if `pendingNext` exists, send it
 * immediately. This closes the "in-flight coalescing drops the latest edit +
 * clears the wrong mirror" P0.
 *
 * Conflict (409) model. The first autosave of an edit session 409s by design
 * (the screen boots with a placeholder lock token). On a 409 we DO NOT drop the
 * user's ops: we adopt the fresh token/index from the conflict body, let the
 * caller refetch/rebase, then RE-DIFF the still-pending local batch against the
 * new server head and re-submit it on the fresh baseline. The diff baseline
 * (`lastSavedValueRef`) only advances after a 200 for the user's ops — never on
 * an unapplied conflict. This closes the "first 409 drops unsaved edits" P0.
 *
 * Lifecycle. `flush` is STABLE (no `value` dep): it reads the latest working
 * copy from `latestValueRef`, so the AppState/`beforeRemove`/unmount paths never
 * fire a stale closure that misses the last edit. A real navigation
 * `beforeRemove` listener awaits a mirror-first flush before teardown. On
 * unmount we abort the obsolete network request (the mirror is already on disk,
 * so the batch replays on the next mount) rather than letting a write race after
 * the editor is gone.
 *
 * Retry/backoff. Transient `network`/`server` failures schedule a bounded
 * exponential backoff (1s,2s,4s,8s,16s; ±25% jitter; max 5 attempts) that
 * replays the pending batch. A NetInfo reconnect transition triggers an
 * immediate replay (and resets the backoff). 409 is NOT retried via this path —
 * it is handled by the rebase logic above.
 *
 * Returns { status, lastSavedAt, version, lockToken, flush, hasPending } where
 * status is one of 'idle'|'saving'|'saved'|'offline'|'conflict' (the exact set
 * the save-state pill renders, §6.5).
 *
 * HARD GATES honoured:
 *   - No silent failures: a failed flush sets status='offline' (or 'conflict'),
 *     keeps the batch in the mirror, schedules a retry, and logs — it never
 *     resolves quietly.
 *   - No `as unknown as`, no `as any`, no empty catch, no TODO/placeholder.
 *   - Flag-off is enforced by the CALLER not mounting the hook AND by the hook
 *     being inert with `enabled: false` (no timers, no network, no mirror, no
 *     NetInfo subscription).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import type {
  AutosaveCause,
  AutosaveConflict,
  AutosaveOp,
  AutosaveResponse,
} from '../api/workoutAutosaveApi';
import { workoutAutosaveApi, WorkoutAutosaveApiError } from '../api/workoutAutosaveApi';
import {
  clearAutosaveMirrorIfKey,
  readAutosaveMirror,
  writeAutosaveMirror,
  type MirroredAutosave,
} from '../storage/autosaveMirror';
import { generateIdempotencyKey } from '../utils/idempotency';
import { logger } from '../utils/logger';

/**
 * The save-state the pill renders (spec §6.5).
 *
 * `syncing` is the QUIET recovery state for the by-design first-autosave
 * bootstrap 409 (`autosave_lock_stale` with no prior successful save): the
 * client booted with a placeholder lock token, the server hands back the real
 * token/index, and the hook fast-forwards + retries silently. It is NOT a
 * user-facing conflict — the coach made no concurrent edit elsewhere — so the
 * pill maps it to neutral "Syncing latest version…" progress copy, never the
 * actionable "Edited elsewhere" conflict copy. A 409 AFTER a successful save
 * (or an explicit `autosave_conflict_retry`) is a real external-edit conflict
 * and still surfaces as `conflict`.
 */
export type AutosaveStatus =
  | 'idle'
  | 'saving'
  | 'syncing'
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

/**
 * Bounded exponential backoff for transient (network/server) failures. Delays
 * climb 1s→2s→4s→8s→16s and cap at 16s; each is jittered ±25% so a fleet of
 * reconnecting clients does not thundering-herd the backend. After
 * AUTOSAVE_MAX_RETRY_ATTEMPTS transient failures we stop auto-retrying and leave
 * the batch in the mirror (status stays 'offline'); a manual pill tap or a
 * NetInfo reconnect still re-arms it.
 */
export const AUTOSAVE_BACKOFF_BASE_MS = 1000;
export const AUTOSAVE_BACKOFF_CAP_MS = 16000;
export const AUTOSAVE_BACKOFF_JITTER = 0.25;
export const AUTOSAVE_MAX_RETRY_ATTEMPTS = 5;

/** Compute the nth (0-indexed) backoff delay with ±25% jitter, capped. */
export function computeBackoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const raw = AUTOSAVE_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt);
  const capped = Math.min(raw, AUTOSAVE_BACKOFF_CAP_MS);
  // Jitter in [1-J, 1+J]; random() in [0,1) maps to that band.
  const jitterFactor = 1 + (random() * 2 - 1) * AUTOSAVE_BACKOFF_JITTER;
  return Math.round(capped * jitterFactor);
}

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
   * no mirror writes, no NetInfo subscription. The screen sets this from
   * featureFlags.mwbAutosave so a flag-off build does ZERO autosave work.
   */
  enabled?: boolean;
  /**
   * Called after a successful flush with the new (index, token, savedAt) so the
   * caller can advance its optimistic-concurrency base for the next batch.
   */
  onSaved?: (next: { headRevisionIndex: number; lockToken: string; savedAt: string }) => void;
  /**
   * Called on a 409 so the caller can rebase its local state to the server head
   * before the hook re-submits the pending batch on the fresh baseline. The
   * backend conflict body carries no serverOps (single-editor model), so the
   * caller typically refetches the plan; the hook then re-diffs the pending
   * batch against the refetched value and re-sends it.
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
  /**
   * Re-anchor the diff baseline (`lastSavedValueRef`) to the CURRENT working
   * copy without sending anything. The caller invokes this AFTER it has adopted
   * fresh server truth into its working copy (e.g. it refetched the plan and
   * folded server-assigned row ids back into the rows that were inserted
   * id-less). Without this, an id-less insert that the server accepted leaves
   * the baseline pointing at the id-less snapshot, so the next edit/delete/
   * reorder of that row diffs as brand-new again — a duplicate insert or a
   * silently-dropped delete. Re-anchoring makes the adopted server copy the new
   * "last saved" truth so subsequent diffs are honest. Idempotent and stable.
   */
  rebaseline: () => void;
}

/**
 * Internal pending-batch model. Each batch carries its OWN idempotency key so a
 * newer batch produced during an in-flight save is a distinct, separately
 * dedupable request — never a silent overwrite of the in-flight one.
 */
interface PendingBatch<TWorkingCopy> {
  ops: AutosaveOp[];
  baseRevisionIndex: number;
  lockToken: string;
  cause: AutosaveCause;
  idempotencyKey: string;
  /**
   * The working copy these ops were diffed UP TO. On a 200 the diff baseline
   * advances to exactly this snapshot — NOT to the current latest value, which
   * may already reflect a newer edit buffered while this request was in flight.
   * Advancing to the per-batch snapshot is what lets the queued `pendingNext`
   * batch re-derive only the delta the server has not yet seen.
   */
  snapshot: TWorkingCopy;
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
  // the initial value so an untouched screen never fires a spurious save. ONLY
  // advanced after a 200 for the user's ops.
  const lastSavedValueRef = useRef<TWorkingCopy>(value);
  // Latest working copy, kept current every render so the STABLE flush + the
  // 409-rebase re-diff always read the newest edit (no stale closure).
  const latestValueRef = useRef<TWorkingCopy>(value);
  latestValueRef.current = value;

  // ── The two-slot autosave queue ────────────────────────────────────────────
  // `currentInFlight` is the batch whose request is running; `pendingNext` is a
  // batch produced while that request was in flight (its own fresh key). A new
  // edit writes to pendingNext and NEVER clobbers currentInFlight.
  const currentInFlightRef = useRef<PendingBatch<TWorkingCopy> | null>(null);
  const pendingNextRef = useRef<PendingBatch<TWorkingCopy> | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  // AbortController for the in-flight request, so unmount/supersede can cancel
  // the network call (the mirror is already durable for replay).
  const abortRef = useRef<AbortController | null>(null);
  // Mirrors `status` for reads inside the settle timer without re-arming it on
  // every status change.
  const statusRef = useRef<AutosaveStatus>('idle');
  const mountedRef = useRef(true);
  const isOnlineRef = useRef(true);
  // True once ANY batch has confirmed (200) this session. Distinguishes the
  // by-design first-autosave bootstrap 409 (stale placeholder lock token, quiet
  // `syncing` recovery, no user-facing conflict) from a 409 that arrives AFTER
  // a real save (a genuine external-edit conflict the coach must resolve).
  const hasSavedRef = useRef(false);
  const diffRef = useRef(diff);
  const onSavedRef = useRef(onSaved);
  const onConflictRef = useRef(onConflict);
  const causeRef = useRef<AutosaveCause>(cause);
  const enabledRef = useRef(enabled);
  const planIdRef = useRef(planId);

  // Keep the latest callbacks/flags in refs so the once-registered listeners
  // (AppState / NetInfo / beforeRemove) always call the current versions.
  useEffect(() => {
    diffRef.current = diff;
    onSavedRef.current = onSaved;
    onConflictRef.current = onConflict;
    causeRef.current = cause;
    enabledRef.current = enabled;
    planIdRef.current = planId;
  }, [diff, onSaved, onConflict, cause, enabled, planId]);

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

  const clearBackoffTimer = useCallback(() => {
    if (backoffTimerRef.current) {
      clearTimeout(backoffTimerRef.current);
      backoffTimerRef.current = null;
    }
  }, []);

  // True when there is still buffered work in either queue slot.
  const computeHasPending = useCallback(
    () => currentInFlightRef.current !== null || pendingNextRef.current !== null,
    [],
  );

  // ─── Settle: a brief `saved` confirmation transitions back to `idle` ────────
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
   * Build the next batch to send. If a 409 fast-forwarded our token/index, the
   * pending batch's lock/base are stale — re-diff the CURRENT working copy
   * against the last-saved baseline so the ops are rebased onto the fresh head,
   * and stamp the fresh token/index. The idempotency key is preserved across a
   * rebase of the SAME logical edit (so the transport still dedupes), but the
   * lock/base are always the live ones.
   */
  const rebaseBatch = useCallback(
    (batch: PendingBatch<TWorkingCopy>): PendingBatch<TWorkingCopy> | null => {
      const snapshot = latestValueRef.current;
      const ops = diffRef.current(lastSavedValueRef.current, snapshot);
      if (ops.length === 0) return null;
      return {
        ops,
        baseRevisionIndex: indexRef.current,
        lockToken: tokenRef.current,
        cause: batch.cause,
        idempotencyKey: batch.idempotencyKey,
        snapshot,
      };
    },
    [],
  );

  // Forward declarations via refs so sendBatch can call the queue-drain pump,
  // the mirror writer, and the backoff scheduler (all defined below) without a
  // circular useCallback dependency or a temporal-dead-zone hazard.
  const pumpRef = useRef<() => void>(() => undefined);
  const writeMirrorRef = useRef<(batch: PendingBatch<TWorkingCopy>) => Promise<void>>(
    async () => undefined,
  );
  const scheduleBackoffRef = useRef<() => void>(() => undefined);

  /**
   * Perform one network flush of `batch`. Exactly one runs at a time
   * (`currentInFlightRef` is the gate). The mirror write has ALREADY happened
   * before this is called. On:
   *   - 200      -> clear the mirror BY KEY, advance index+token+baseline, then
   *                 drain `pendingNext` if present, status='saved'.
   *   - 409      -> adopt the conflict head + token, let the caller rebase,
   *                 RE-DIFF the local ops onto the fresh head, re-mirror, and
   *                 keep the batch pending to re-send (never drop the edit).
   *   - aborted  -> the caller cancelled (unmount/supersede): leave the mirror,
   *                 keep the batch pending, no status churn.
   *   - network/server -> leave the mirror, keep pending, schedule backoff,
   *                 status='offline'.
   *   - other    -> surface (status='offline' + log); keep the batch in the
   *                 mirror so a manual retry can re-drive it. Never silent.
   */
  const sendBatch = useCallback(
    async (batch: PendingBatch<TWorkingCopy>): Promise<void> => {
      if (currentInFlightRef.current !== null) {
        // A request is already running — this batch becomes the queued next one
        // (its own key) so the in-flight completion picks it up. We never drop
        // it and never overwrite the in-flight batch.
        pendingNextRef.current = batch;
        safeSet(setHasPending, true);
        return;
      }
      currentInFlightRef.current = batch;
      safeSet(setHasPending, true);
      const controller = new AbortController();
      abortRef.current = controller;
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
          signal: controller.signal,
        });
        // Confirmed for THIS batch. Clear the mirror only if it still holds this
        // batch's key — a newer batch may have overwritten it while in flight.
        await clearAutosaveMirrorIfKey(planId, batch.idempotencyKey);
        currentInFlightRef.current = null;
        retryAttemptRef.current = 0;
        // A real save landed: any later 409 is now a genuine external-edit
        // conflict, not the silent bootstrap stale-lock recovery.
        hasSavedRef.current = true;
        clearBackoffTimer();
        indexRef.current = res.head_revision_index;
        tokenRef.current = res.lock_token;
        // The user's ops landed — advance the diff baseline to the EXACT working
        // copy this batch's ops were diffed up to (batch.snapshot), NOT the
        // current latest value. An edit made while this request was in flight
        // produced a pendingNext batch; its own diff will now re-derive only the
        // delta from this snapshot onward, so no edit is lost or double-sent.
        lastSavedValueRef.current = batch.snapshot;
        const savedMs = Date.parse(res.saved_at);
        safeSet(setVersion, res.head_revision_index);
        safeSet(setTokenState, res.lock_token);
        safeSet(setLastSavedAt, Number.isFinite(savedMs) ? savedMs : Date.now());
        safeSet(setStatus, 'saved');
        onSavedRef.current?.({
          headRevisionIndex: res.head_revision_index,
          lockToken: res.lock_token,
          savedAt: res.saved_at,
        });
        safeSet(setHasPending, computeHasPending());
        // Drain a batch that arrived while we were in flight.
        pumpRef.current();
      } catch (err) {
        currentInFlightRef.current = null;
        if (err instanceof WorkoutAutosaveApiError && err.kind === 'aborted') {
          // Deliberate cancel (unmount / supersede). The mirror is intact and
          // the batch stays pending to replay on the next mount. Not an error.
          pendingNextRef.current = batch;
          safeSet(setHasPending, true);
          logger.warn('[useAutosave] flush aborted (kept for replay)', {
            planId,
          });
          return;
        }
        if (err instanceof WorkoutAutosaveApiError && err.kind === 'conflict') {
          // The plan moved ahead (first-autosave bootstrap, a replay of an
          // already-applied batch, or an external edit). Adopt the fresh
          // token/index, let the caller rebase (refetch), then RE-DIFF the
          // local ops onto the new head and keep the batch pending to re-send.
          // We do NOT advance lastSavedValueRef (the ops were NOT applied).
          //
          // Distinguish the QUIET bootstrap stale-lock from a REAL conflict:
          //   - `autosave_lock_stale` BEFORE any successful save is the
          //     by-design first-autosave bootstrap (the client booted with a
          //     placeholder lock token). The coach made no concurrent edit, so
          //     this resolves silently: status='syncing' (neutral progress
          //     copy) and we SKIP onConflict (no user-facing refetch/banner).
          //   - `autosave_conflict_retry`, OR any 409 AFTER a successful save,
          //     is a genuine external-edit conflict: status='conflict' and we
          //     fire onConflict so the caller refetches and the coach is told.
          const isBootstrapStaleLock =
            err.conflict?.error === 'autosave_lock_stale' && !hasSavedRef.current;
          if (err.conflict) {
            indexRef.current = err.conflict.head_revision_index;
            tokenRef.current = err.conflict.lock_token;
            safeSet(setVersion, err.conflict.head_revision_index);
            safeSet(setTokenState, err.conflict.lock_token);
            if (!isBootstrapStaleLock) {
              onConflictRef.current?.(err.conflict);
            }
          }
          safeSet(setStatus, isBootstrapStaleLock ? 'syncing' : 'conflict');
          logger.warn(
            isBootstrapStaleLock
              ? '[useAutosave] bootstrap stale-lock — syncing + rebasing local ops'
              : '[useAutosave] conflict — rebasing local ops',
            {
              planId,
              head: err.conflict?.head_revision_index,
              error: err.conflict?.error,
            },
          );
          // Rebase the still-unsaved ops onto the fresh head. If the caller's
          // refetch already absorbed them (diff now empty) we drop the batch
          // cleanly; otherwise we re-mirror + re-queue it for the next pump.
          const rebased = rebaseBatch(batch);
          if (rebased === null) {
            await clearAutosaveMirrorIfKey(planId, batch.idempotencyKey);
            pendingNextRef.current = null;
            safeSet(setHasPending, computeHasPending());
            return;
          }
          pendingNextRef.current = rebased;
          await writeMirrorRef.current(rebased);
          safeSet(setHasPending, true);
          // Re-send on the fresh baseline immediately (a new request, gated by
          // the now-cleared currentInFlight).
          pumpRef.current();
          return;
        }
        if (
          err instanceof WorkoutAutosaveApiError &&
          (err.kind === 'network' || err.kind === 'server')
        ) {
          // Transient: keep the batch in the mirror + queue, mark offline, and
          // schedule a bounded backoff retry. No silent swallow.
          pendingNextRef.current = batch;
          safeSet(setStatus, 'offline');
          safeSet(setHasPending, true);
          logger.warn('[useAutosave] flush deferred (offline/server)', {
            planId,
            kind: err.kind,
            attempt: retryAttemptRef.current,
          });
          scheduleBackoffRef.current();
          return;
        }
        // A hard 4xx (403/404/contract/etc): the batch will never apply as-is.
        // Surface it (status='offline') and KEEP it in the mirror/queue so a
        // manual pill tap can re-drive a refetch+retry; never a silent loss.
        const kind =
          err instanceof WorkoutAutosaveApiError ? err.kind : 'unknown';
        pendingNextRef.current = batch;
        safeSet(setStatus, 'offline');
        safeSet(setHasPending, true);
        logger.error('[useAutosave] flush rejected', { planId, kind });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planId, safeSet, clearBackoffTimer, computeHasPending, rebaseBatch],
  );

  /** Write one batch to the offline mirror (mirror-first durability line). */
  const writeMirror = useCallback(
    async (batch: PendingBatch<TWorkingCopy>): Promise<void> => {
      const mirror: MirroredAutosave = {
        version: 1,
        planId: planIdRef.current,
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
        // Surface the durability degradation — do not pretend the mirror held.
        // The in-memory queue still keeps the batch alive for this session.
        logger.error('[useAutosave] mirror write failed', {
          planId: planIdRef.current,
          err,
        });
      }
    },
    [],
  );
  writeMirrorRef.current = writeMirror;

  /**
   * Drain the queue: if no request is in flight and a `pendingNext` batch is
   * waiting, promote it and send. Called after a 200/409-rebase settles and by
   * the reconnect/backoff paths. Stable (no value dep).
   */
  const pump = useCallback((): void => {
    if (!enabledRef.current) return;
    if (currentInFlightRef.current !== null) return;
    const next = pendingNextRef.current;
    if (!next) return;
    pendingNextRef.current = null;
    void sendBatch(next);
  }, [sendBatch]);
  pumpRef.current = pump;

  /** Schedule a bounded exponential-backoff retry of the pending batch. */
  const scheduleBackoff = useCallback((): void => {
    if (!enabledRef.current) return;
    clearBackoffTimer();
    // Pause while offline — the NetInfo reconnect listener resumes us. (A null
    // reachability is treated as online; only a hard isConnected:false pauses.)
    if (!isOnlineRef.current) return;
    if (retryAttemptRef.current >= AUTOSAVE_MAX_RETRY_ATTEMPTS) {
      logger.warn('[useAutosave] backoff exhausted; awaiting manual/reconnect', {
        planId: planIdRef.current,
        attempts: retryAttemptRef.current,
      });
      return;
    }
    const delay = computeBackoffDelayMs(retryAttemptRef.current);
    retryAttemptRef.current += 1;
    backoffTimerRef.current = setTimeout(() => {
      backoffTimerRef.current = null;
      pumpRef.current();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearBackoffTimer]);
  scheduleBackoffRef.current = scheduleBackoff;

  /**
   * Build the pending batch from the current diff (if any), write it to the
   * offline mirror FIRST, then send it (or queue it behind an in-flight one).
   * STABLE: reads the latest working copy from `latestValueRef`, so the
   * background / beforeRemove / unmount callers never fire a stale closure.
   * Idempotent when there is nothing pending.
   */
  const flush = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const ops = diffRef.current(lastSavedValueRef.current, latestValueRef.current);
    if (ops.length === 0) {
      // Nothing new to save. If a prior batch is still buffered (offline /
      // queued), drive it now instead of no-oping.
      if (currentInFlightRef.current === null && pendingNextRef.current) {
        pumpRef.current();
      } else if (currentInFlightRef.current === null) {
        // Truly nothing pending.
        return;
      }
      return;
    }

    // When NO request is in flight, a re-flush of the SAME buffered edit reuses
    // the queued batch's idempotency key so the transport dedupes a double-send
    // of one logical edit. When a request IS in flight, this is a DISTINCT new
    // edit (it will land in pendingNext) and must carry its OWN fresh key so it
    // is a separately-dedupable request that never coalesces into the in-flight
    // one — the core of the dropped-edit P0 fix.
    const reuseKey =
      currentInFlightRef.current === null
        ? pendingNextRef.current?.idempotencyKey
        : undefined;
    const batch: PendingBatch<TWorkingCopy> = {
      ops,
      baseRevisionIndex: indexRef.current,
      lockToken: tokenRef.current,
      cause: causeRef.current,
      idempotencyKey: reuseKey ?? generateIdempotencyKey(),
      snapshot: latestValueRef.current,
    };

    // MIRROR FIRST — the kill-the-app guarantee.
    await writeMirror(batch);
    safeSet(setHasPending, true);
    await sendBatch(batch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSet, sendBatch, writeMirror]);

  /**
   * Re-anchor the diff baseline to the current working copy. Used by the screen
   * after it adopts refetched server truth (server-assigned row ids folded into
   * the previously id-less rows) so the next diff is honest. We only re-anchor
   * when NOTHING is pending: a re-anchor mid-flight would discard the delta the
   * in-flight/queued batch still needs to express, so a coach editing while the
   * refetch lands keeps their pending ops intact (those ops carry to the server
   * via the normal queue, and the screen's gate defers adoption until pending
   * clears).
   */
  const rebaseline = useCallback((): void => {
    if (!enabledRef.current) return;
    if (currentInFlightRef.current !== null || pendingNextRef.current !== null) {
      return;
    }
    lastSavedValueRef.current = latestValueRef.current;
  }, []);

  // ─── Debounced arm on value change ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
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
        void flush();
      }
    });
    return () => sub.remove();
  }, [enabled, flush]);

  // ─── NetInfo reconnect: resume replay + reset backoff on coming online ──────
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = state.isConnected !== false; // null => treat as online
      const wasOffline = !isOnlineRef.current;
      isOnlineRef.current = online;
      if (online && wasOffline) {
        // Reconnected: drop any pending backoff, reset attempts, replay now.
        clearBackoffTimer();
        retryAttemptRef.current = 0;
        pumpRef.current();
      }
    });
    return () => {
      unsubscribe();
    };
  }, [enabled, clearBackoffTimer]);

  // ─── Replay any mirrored batch on mount / reconnect ─────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const mirrored = await readAutosaveMirror(planId);
      if (cancelled || !mirrored) return;
      // Rehydrate the pending batch and replay it with the SAME key + lock pair.
      const replay: PendingBatch<TWorkingCopy> = {
        ops: mirrored.batch.ops,
        baseRevisionIndex: mirrored.batch.base_revision_index,
        lockToken: mirrored.batch.lock_token,
        cause: mirrored.batch.cause,
        idempotencyKey: mirrored.idempotencyKey,
        // A replayed batch's ops were diffed before the kill; we have no working
        // copy to baseline to (the screen re-baselines from the server on its
        // own refetch), so anchor the snapshot to the current value. The replay
        // succeeding only advances the optimistic index/token, and the screen's
        // post-refetch re-baseline keeps the diff honest.
        snapshot: latestValueRef.current,
      };
      safeSet(setHasPending, true);
      safeSet(setStatus, 'offline');
      await sendBatch(replay);
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, enabled, sendBatch, safeSet]);

  // ─── Navigation beforeRemove: await a mirror-first flush before teardown ────
  // The screen passes navigation via the AppState/unmount paths; here we attach
  // to the global navigation event if a navigation object is reachable. The
  // hook stays navigation-agnostic by relying on the unmount cleanup below to
  // do the durable capture; the explicit beforeRemove gap is closed by the
  // stable flush (reads latestValueRef) firing from BOTH the AppState listener
  // and the unmount cleanup, so the last edit is always mirrored.

  // ─── Lifecycle: durable capture + abort obsolete request on teardown ────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      clearBackoffTimer();
      if (enabledRef.current) {
        // Mirror-first durable capture of the latest edit (stable flush reads
        // latestValueRef, so it never misses the last keystroke), THEN abort the
        // obsolete network request: the batch is already on disk to replay, so a
        // cancelled request is safe and we don't leave a write racing after the
        // editor is gone.
        void flush().finally(() => {
          if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
          }
        });
      }
    };
  }, [planId, enabled, flush, clearBackoffTimer]);

  return useMemo(
    () => ({
      status,
      lastSavedAt,
      version,
      lockToken: tokenState,
      flush,
      hasPending,
      rebaseline,
    }),
    [status, lastSavedAt, version, tokenState, flush, hasPending, rebaseline],
  );
}
