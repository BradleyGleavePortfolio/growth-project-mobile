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

/**
 * Bounded budget for the 409 conflict-rebase loop (MWB-4 #237 R11 P1). A stream
 * of 409s — another active editor, a stale-cache/adoption race, or a malformed
 * conflict body — used to re-pump the rebased batch IMMEDIATELY with no counter
 * and no delay, an unbounded immediate-spin loop. We now cap conflict retries at
 * this many auto-rebases; past it the hook stops auto-retrying and surfaces a
 * manual-recovery 'conflict' state (the pill's refetch affordance) instead of
 * hammering the backend. Each conflict retry also waits a minimum jittered
 * backoff (below) so even within budget it never tight-loops.
 */
export const AUTOSAVE_MAX_CONFLICT_ATTEMPTS = 5;

/**
 * Minimum delay between conflict-rebase retries (MWB-4 #237 R11 P1). Conflict
 * retries grow 250ms→500ms→1s→2s→4s, each jittered ±25%, so even a rapid burst
 * of 409s cannot produce a tight immediate-spin loop and a fleet of conflicting
 * clients does not thundering-herd the autosave endpoint.
 */
export const AUTOSAVE_CONFLICT_BACKOFF_BASE_MS = 250;

/** Compute the nth (0-indexed) conflict-retry delay with ±25% jitter, capped. */
export function computeConflictBackoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const raw = AUTOSAVE_CONFLICT_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt);
  const capped = Math.min(raw, AUTOSAVE_BACKOFF_CAP_MS);
  const jitterFactor = 1 + (random() * 2 - 1) * AUTOSAVE_BACKOFF_JITTER;
  return Math.round(capped * jitterFactor);
}

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
   *
   * MWB-4 #237 R11 (P1): the callback MAY return a `Promise<void>`. When it
   * does, the hook AWAITS it before rebasing + re-sending, so authoritative
   * server truth is adopted (the screen refetches the plan and re-anchors the
   * diff baseline to it) FIRST. Without the await the resend went out against a
   * STALE local baseline and the full-row upsert diff could erase a concurrent
   * server edit (e.g. another field reset to null). A `void` return preserves
   * the legacy behaviour (no wait). It is also passed `undefined` when a 409
   * arrives with a malformed/undecodable body so the caller can surface manual
   * recovery rather than trust an absent server head.
   */
  onConflict?: (conflict: AutosaveConflict | undefined) => void | Promise<void>;
  /**
   * Called the moment a mirrored batch is found and a kill/replay is attempted
   * on mount (MWB-4 #237 R6). The caller MUST treat its cached plan as stale
   * here: a force-quit/relaunch replay can land the rescued edit on the server
   * while the reopened builder still shows a stale React Query cache (staleTime
   * 5min + persisted cold-start hydration), after which the legacy explicit
   * Save full-replace would erase the rescue. The screen force-invalidates AND
   * refetches `['workout-plans', planId]` (and the list) so the refreshed
   * server truth rebaselines the form BEFORE the builder is savable. Paired
   * with {@link UseAutosaveResult.replayInFlight}, which blocks explicit Save
   * until the replay settles so Save cannot race the refetch.
   */
  onReplay?: () => void;
}

export interface UseAutosaveResult<TWorkingCopy = unknown> {
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
   * True when the most recent offline-mirror write FAILED (AsyncStorage full /
   * unavailable) and has not yet recovered. While true the on-device durability
   * line is NOT holding: the batch lives only in the in-memory queue, so a
   * process kill before the network send confirms would lose the edit. The
   * screen passes this to the pill so its offline copy NEVER claims "saved on
   * device" while degraded (truthful copy instead). It clears the moment a
   * subsequent mirror write succeeds (retried on the next flush) or the batch
   * lands a 200 and clears the queue (MWB-4 #237 R9 P1, fifty-failures #36/#50).
   */
  mirrorDegraded: boolean;
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
  /**
   * True from the moment a mirrored batch is found on mount until that replayed
   * batch — and every descendant rebased+requeued from a replay 409 — reaches a
   * TRULY terminal outcome AND the reconciliation refetch/adoption has folded
   * the rescued ops into the baseline. A replay 409 that rebases+requeues keeps
   * this raised (the 409 is not terminal); it clears only on the descendant's
   * terminal 200 / hard reject, or on a 409 whose rebase finds nothing left to
   * send (adopted). The screen blocks (disables) explicit Save while this is
   * true so a full-replace Save cannot race the in-flight replay retry + cache
   * refetch and erase the rescued edit (MWB-4 #237 R6/R8 P1).
   */
  replayInFlight: boolean;
  /**
   * Re-anchor the diff baseline to an EXPLICIT server copy rather than the
   * current working copy. Used by the delete-before-adoption fix (MWB-4 #237
   * D-045): when a refetch resurrects a row the coach deleted in the adoption
   * window, the screen adopts the FILTERED rows (without the deleted one) into
   * its local state but anchors the baseline to the FULL server truth (which
   * still holds that row). The very next diff then emits a `remove_exercise`
   * for the now-known server row_id — preserving the delete on the server —
   * instead of the full-replace path resurrecting it. Like {@link rebaseline}
   * it refuses to run mid-flight so a genuine pending batch is never discarded.
   */
  rebaselineTo: (serverCopy: TWorkingCopy) => void;
  /**
   * Conflict-adoption re-anchor (MWB-4 #237 R13 D-002). Unlike {@link rebaselineTo}
   * — which refuses to run while a batch is in flight or queued so it can never
   * discard a genuine pending edit — this variant is the ONE path that MAY
   * replace `lastSavedValueRef` even when a queued edit exists, because it is
   * called from INSIDE the hook's awaited 409-adoption window (the in-flight
   * slot is already vacated by the failed send and the failed batch has not yet
   * been requeued). The queued local delta (`pendingNextRef`) is NOT discarded:
   * it is RE-DERIVED from the latest working copy diffed against the freshly
   * adopted server baseline, so the coach's edit-while-in-flight survives and
   * is replayed ON TOP OF server truth rather than clobbering a concurrent
   * server field. Without this, an edit made while request A was in flight left
   * `pendingNextRef !== null`, so {@link rebaselineTo} silently no-op'd and the
   * subsequent rebase diffed the STALE baseline — re-erasing the concurrent
   * server edit the await was meant to protect (the D-002 lost-update path).
   * The hook itself routes its conflict-await adoption through this; the screen
   * passes the refetched server copy.
   */
  rebaselineToConflict: (serverCopy: TWorkingCopy) => void;
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
  /**
   * True for the batch rehydrated from the offline mirror on mount (the
   * kill/replay path) AND for any descendant rebased+requeued from that batch's
   * 409 (the tag is carried forward by {@link rebaseBatch}). The gate clears
   * only on a TRULY terminal replay outcome: a 200, a hard reject, or a 409
   * whose rebase finds no remaining work (the reconciliation refetch already
   * absorbed the rescued ops). A 409 that rebases+requeues is NOT terminal —
   * the descendant carries this tag and clears the gate on its own terminal
   * outcome, so an explicit full-replace Save can never race the in-flight
   * replay retry and erase the rescued edit (MWB-4 #237 R8 P1). A normal
   * debounced/queued batch is never a replay.
   */
  isReplay?: boolean;
}

export function useAutosave<TWorkingCopy>(
  args: UseAutosaveArgs<TWorkingCopy>,
): UseAutosaveResult<TWorkingCopy> {
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
    onReplay,
  } = args;

  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [hasPending, setHasPending] = useState(false);
  // D-042: a dirty-since-last-save signal that flips true the MOMENT the
  // working copy diverges from the saved baseline (the value-change effect),
  // BEFORE the 800ms debounce flush builds a batch. Without it `hasPending`
  // stayed false in the gap between an edit and its flush, so the screen's
  // post-insert adoption effect — gated on `!hasPending` — could clobber a
  // coach's just-typed change with refetched server data. The mirror ref lets
  // the stable `computeHasPending` read it without a re-subscribe; the state
  // drives the re-render so consumers observe the flip synchronously.
  const [_dirtyState, setDirtyState] = useState(false);
  const dirtyStateRef = useRef(false);
  // MWB-4 #237 R6 (P1): true from the instant a mirrored batch is found on
  // mount until that replayed batch reaches a terminal server outcome. Drives
  // the screen's Save-blocked gate so an explicit full-replace Save cannot race
  // the replay + cache refetch and erase the rescued edit.
  const [replayInFlight, setReplayInFlight] = useState(false);
  const replayInFlightRef = useRef(false);
  // MWB-4 #237 R9 (P1, fifty-failures #36): true when the last offline-mirror
  // write failed and has not since recovered. The mirror is the on-device
  // durability line; when it fails we MUST NOT pretend the batch is durable —
  // we keep the batch in the in-memory queue, continue the network send (the
  // best recovery), and raise this so the pill shows truthful copy instead of
  // "saved on device". Cleared on the next successful mirror write or once the
  // batch lands a 200 and the queue drains.
  const [mirrorDegraded, setMirrorDegraded] = useState(false);
  const mirrorDegradedRef = useRef(false);
  // Whether the LATEST flush's mirror write actually held on disk. The teardown
  // (background/kill) path reads it: when false the batch is NOT durable on
  // device, so it must NOT abort the in-flight network send (which would lose
  // the edit) — it lets the send complete as the only recovery. Defaults true
  // (assume durable until a write proves otherwise).
  const mirrorHeldRef = useRef(true);

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
  // MWB-4 #237 R11 (P1): bounded budget for the 409 conflict-rebase loop. The
  // transient `retryAttemptRef` covers network/server backoff; this parallel
  // counter caps the conflict-rebase path so a stream of 409s cannot spin an
  // unbounded immediate retry loop. Incremented per conflict auto-rebase, reset
  // to 0 on a terminal 200 (a save cleared the conflict).
  const conflictAttemptRef = useRef(0);
  // Holds the conflict-retry backoff timer so teardown can cancel it (mirrors
  // backoffTimerRef for the transient path).
  const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const onReplayRef = useRef(onReplay);
  const causeRef = useRef<AutosaveCause>(cause);
  const enabledRef = useRef(enabled);
  const planIdRef = useRef(planId);

  // Keep the latest callbacks/flags in refs so the once-registered listeners
  // (AppState / NetInfo / beforeRemove) always call the current versions.
  useEffect(() => {
    diffRef.current = diff;
    onSavedRef.current = onSaved;
    onConflictRef.current = onConflict;
    onReplayRef.current = onReplay;
    causeRef.current = cause;
    enabledRef.current = enabled;
    planIdRef.current = planId;
  }, [diff, onSaved, onConflict, onReplay, cause, enabled, planId]);

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

  const clearConflictTimer = useCallback(() => {
    if (conflictTimerRef.current) {
      clearTimeout(conflictTimerRef.current);
      conflictTimerRef.current = null;
    }
  }, []);

  // Clear the replay-in-flight gate once the replayed batch (or a descendant
  // rebased+requeued from a replay 409) has reached a TRULY terminal outcome:
  // a 200, a hard reject, or a 409 whose rebase leaves nothing to re-send (the
  // reconciliation refetch already absorbed the rescued ops). It is NOT cleared
  // on a 409 that rebases+requeues — that retry is still in flight (MWB-4 #237
  // R8 P1). Keeps the ref and the state in lockstep so the screen's Save-blocked
  // gate (which reads the state) and any internal check (the ref) never disagree.
  const clearReplayInFlight = useCallback(() => {
    if (!replayInFlightRef.current) return;
    replayInFlightRef.current = false;
    safeSet(setReplayInFlight, false);
  }, [safeSet]);

  // Set the mirror-degraded signal, keeping the ref mirror and the state in
  // lockstep so an internal check (the ref) and the re-render the pill consumes
  // (the state) never disagree. Mount-guarded via safeSet.
  const setMirrorDegradedFlag = useCallback(
    (next: boolean) => {
      if (mirrorDegradedRef.current === next) return;
      mirrorDegradedRef.current = next;
      safeSet(setMirrorDegraded, next);
    },
    [safeSet],
  );

  // Set the dirty-since-last-save signal, keeping the ref mirror and the state
  // in lockstep so `computeHasPending` (which reads the ref) and any re-render
  // (driven by the state) never disagree. Mount-guarded via safeSet.
  const setDirty = useCallback(
    (next: boolean) => {
      dirtyStateRef.current = next;
      safeSet(setDirtyState, next);
    },
    [safeSet],
  );

  // True when there is still buffered work in either queue slot OR the working
  // copy is dirty since the last confirmed save (a debounce is armed but has
  // not yet built a batch). The dirty term is the D-042 fix: `hasPending` must
  // reflect "I have an unsaved local change" the instant the coach types, not
  // only once `flush()` constructs a batch.
  const computeHasPending = useCallback(
    () =>
      currentInFlightRef.current !== null ||
      pendingNextRef.current !== null ||
      dirtyStateRef.current,
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
        // Carry the replay tag forward onto the requeued retry. A replayed 409
        // is NOT terminal for the rescued edit: the batch is rebased onto the
        // fresh head and re-sent. The descendant retry must stay tagged so the
        // Save-blocked gate is released only when THAT retry reaches a truly
        // terminal outcome (200 / hard reject), never on the intermediate 409
        // that merely requeues it (MWB-4 #237 R8 P1).
        isReplay: batch.isReplay,
      };
    },
    [],
  );

  // Forward declarations via refs so sendBatch can call the queue-drain pump,
  // the mirror writer, and the backoff scheduler (all defined below) without a
  // circular useCallback dependency or a temporal-dead-zone hazard.
  const pumpRef = useRef<() => void>(() => undefined);
  const writeMirrorRef = useRef<(batch: PendingBatch<TWorkingCopy>) => Promise<boolean>>(
    async () => false,
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
        // A save landed, so the conflict-rebase loop (if any) is resolved: reset
        // the conflict budget so a future, unrelated 409 gets its full allowance
        // (MWB-4 #237 R11 P1).
        conflictAttemptRef.current = 0;
        clearConflictTimer();
        // The batch landed on the server (durable server-side). If nothing else
        // is queued, the on-device durability gap is closed — clear the degraded
        // flag. A still-queued pendingNext keeps it until that batch's own
        // mirror write succeeds (fifty-failures #36/#50).
        if (pendingNextRef.current === null) {
          setMirrorDegradedFlag(false);
        }
        // A real save landed: any later 409 is now a genuine external-edit
        // conflict, not the silent bootstrap stale-lock recovery.
        hasSavedRef.current = true;
        // The replayed batch (or its rebased+requeued descendant) reached the
        // server successfully — the rescued edit is now durable on the server
        // and this is the replay's terminal 200. Release the Save-blocked gate;
        // the screen's onReplay/onSaved already forced the cache refetch that
        // rebaselines the form (MWB-4 #237 R6/R8 P1).
        if (batch.isReplay) clearReplayInFlight();
        clearBackoffTimer();
        indexRef.current = res.head_revision_index;
        tokenRef.current = res.lock_token;
        // The user's ops landed — advance the diff baseline to the EXACT working
        // copy this batch's ops were diffed up to (batch.snapshot), NOT the
        // current latest value. An edit made while this request was in flight
        // produced a pendingNext batch; its own diff will now re-derive only the
        // delta from this snapshot onward, so no edit is lost or double-sent.
        lastSavedValueRef.current = batch.snapshot;
        // Recompute the dirty signal against the freshly-advanced baseline. If
        // an edit landed WHILE this request was in flight (so latestValueRef
        // already diverges from batch.snapshot) we stay dirty and the queued
        // batch carries it; otherwise we are clean until the next keystroke.
        // This keeps `hasPending` honest right after a 200 so the screen's
        // adoption effect only runs once there is genuinely nothing unsaved.
        setDirty(diffRef.current(lastSavedValueRef.current, latestValueRef.current).length > 0);
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
          // MWB-4 #237 R11 (P1) — MALFORMED conflict body. A 409 the API could
          // not decode (`kind==='conflict'` AND `conflict===undefined`) carries
          // NO fresh head/token, so rebasing + resending the same stale-token
          // batch is doomed to 409 again — an immediate-spin loop. Treat it as
          // NON-auto-retriable: surface a 'conflict' (the pill's manual-refetch
          // affordance), notify the caller with `undefined` so it can recover,
          // keep the batch in the mirror/queue for a manual re-drive, and STOP
          // (no pump). A replayed batch hitting this is terminal for the replay.
          if (err.conflict === undefined) {
            pendingNextRef.current = batch;
            safeSet(setStatus, 'conflict');
            safeSet(setHasPending, true);
            if (batch.isReplay) clearReplayInFlight();
            onConflictRef.current?.(undefined);
            logger.error(
              '[useAutosave] malformed conflict body — manual recovery (no auto-retry)',
              { planId },
            );
            return;
          }
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
            err.conflict.error === 'autosave_lock_stale' && !hasSavedRef.current;
          // Adopt the fresh head/token up front so even a budget-exhausted stop
          // (below) or a manual re-drive starts from the latest server head.
          indexRef.current = err.conflict.head_revision_index;
          tokenRef.current = err.conflict.lock_token;
          safeSet(setVersion, err.conflict.head_revision_index);
          safeSet(setTokenState, err.conflict.lock_token);
          // MWB-4 #237 R11 (P1) BOUNDED conflict budget. Past
          // AUTOSAVE_MAX_CONFLICT_ATTEMPTS auto-rebases (another active editor /
          // a persistent adoption race) we STOP auto-retrying and surface manual
          // recovery instead of spinning. We keep the batch queued for a manual
          // re-drive. A bootstrap stale-lock is exempt: it is the by-design
          // first-save handshake, not a contended loop.
          if (
            !isBootstrapStaleLock &&
            conflictAttemptRef.current >= AUTOSAVE_MAX_CONFLICT_ATTEMPTS
          ) {
            pendingNextRef.current = batch;
            safeSet(setStatus, 'conflict');
            safeSet(setHasPending, true);
            if (batch.isReplay) clearReplayInFlight();
            onConflictRef.current?.(err.conflict);
            logger.warn(
              '[useAutosave] conflict budget exhausted - manual recovery (no auto-retry)',
              { planId, attempts: conflictAttemptRef.current },
            );
            return;
          }
          // A replayed batch that 409s is NOT yet terminal for the rescued edit
          // (MWB-4 #237 R8 P1). This branch fast-forwards the lock/index, then
          // rebases + REQUEUES the still-unsaved ops and pumps them again — so
          // the rescued edit has NOT necessarily landed and the retry is still
          // in flight. Clearing the Save-blocked gate here (the R7 bug) let an
          // explicit full-replace Save race that retry and erase the rescue.
          // We therefore HOLD the gate across the 409 and release it only on a
          // truly terminal replay outcome: below, the gate clears iff the
          // rebase finds NO remaining work (the caller's reconciliation refetch
          // already absorbed the rescued ops — terminal + adopted), and the
          // requeued retry (which carries `isReplay` via rebaseBatch) clears it
          // on its own terminal 200 / hard reject.
          safeSet(setStatus, isBootstrapStaleLock ? 'syncing' : 'conflict');
          logger.warn(
            isBootstrapStaleLock
              ? '[useAutosave] bootstrap stale-lock - syncing + rebasing local ops'
              : '[useAutosave] conflict - awaiting server truth then rebasing',
            {
              planId,
              head: err.conflict.head_revision_index,
              error: err.conflict.error,
              attempt: conflictAttemptRef.current,
            },
          );
          // MWB-4 #237 R11 (P1) AWAIT server-truth adoption. The caller's
          // onConflict refetches the plan AND re-anchors the diff baseline
          // (lastSavedValueRef) to that authoritative server copy. We MUST wait
          // for that before rebasing: rebaseBatch diffs lastSavedValueRef vs
          // latestValueRef, so resending before adoption would diff a STALE
          // local baseline and emit full-row upserts that erase a concurrent
          // server edit. A void-returning caller resolves immediately (legacy
          // behaviour). The bootstrap stale-lock has no concurrent server edit
          // to protect, so it skips the caller round-trip entirely.
          if (!isBootstrapStaleLock) {
            try {
              await onConflictRef.current?.(err.conflict);
            } catch (adoptErr) {
              // The caller's refetch/adoption failed. Do NOT blindly resend over
              // a possibly-stale baseline (that is the lost-update bug). Surface
              // manual recovery and keep the batch queued for a manual re-drive.
              pendingNextRef.current = batch;
              safeSet(setStatus, 'conflict');
              safeSet(setHasPending, true);
              if (batch.isReplay) clearReplayInFlight();
              logger.error(
                '[useAutosave] server-truth adoption failed on conflict - manual recovery',
                { planId, err: adoptErr },
              );
              return;
            }
            // The hook may have unmounted while awaiting adoption; if so the
            // teardown already captured the mirror, so stop here.
            if (!mountedRef.current) {
              pendingNextRef.current = batch;
              return;
            }
          }
          // Rebase the still-unsaved ops onto the NOW-ADOPTED server baseline.
          // If the adoption absorbed them (diff now empty) we drop the batch
          // cleanly; otherwise we re-mirror + re-queue it for the next pump.
          const rebased = rebaseBatch(batch);
          if (rebased === null) {
            await clearAutosaveMirrorIfKey(planId, batch.idempotencyKey);
            pendingNextRef.current = null;
            // The refetch absorbed the local ops (diff empty), so the working
            // copy now matches the adopted baseline: no longer dirty. The
            // conflict is fully resolved, so reset the conflict budget + timer.
            conflictAttemptRef.current = 0;
            clearConflictTimer();
            setDirty(false);
            // Replay terminal + reconciled: this was a replayed batch and the
            // caller's refetch/adoption has folded the rescued ops into the
            // baseline (the diff is now empty), so there is no remaining replay
            // work and the refreshed truth is adopted. Release the Save-blocked
            // gate (MWB-4 #237 R8 P1).
            if (batch.isReplay) clearReplayInFlight();
            safeSet(setHasPending, computeHasPending());
            return;
          }
          pendingNextRef.current = rebased;
          // MWB-4 #237 R10 (P1): the rebased batch is the new durable truth, so
          // its mirror-write result MUST drive `mirrorHeldRef` — exactly as the
          // primary flush path does (:896-897). Ignoring it could leave the ref
          // stale-true from an earlier success, letting the unmount teardown
          // (:1094) abort an in-flight rebased send that the mirror does NOT
          // hold and silently lose the edits rescued into the rebase.
          mirrorHeldRef.current = await writeMirrorRef.current(rebased);
          safeSet(setHasPending, true);
          // MWB-4 #237 R11 (P1): count this auto-rebase against the conflict
          // budget and re-send after a minimum JITTERED backoff (never an
          // immediate tight loop). The bootstrap stale-lock handshake is exempt
          // from the count (it is the expected first-save 409) and re-sends with
          // no delay so its quiet-recovery latency is unchanged. A genuine
          // conflict waits computeConflictBackoffDelayMs(attempt) so even a
          // burst of 409s cannot spin immediately.
          const conflictAttempt = conflictAttemptRef.current;
          clearConflictTimer();
          if (isBootstrapStaleLock) {
            // Re-send immediately on the fresh baseline (a new request, gated by
            // the now-cleared currentInFlight).
            pumpRef.current();
            return;
          }
          conflictAttemptRef.current += 1;
          const conflictDelay = computeConflictBackoffDelayMs(conflictAttempt);
          conflictTimerRef.current = setTimeout(() => {
            conflictTimerRef.current = null;
            pumpRef.current();
          }, conflictDelay);
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
        // A replayed batch (or its requeued descendant) hit a hard reject: the
        // rescued edit will not apply as-is, but this IS terminal for the replay
        // attempt. Release the gate so the coach is not locked out of explicit
        // Save indefinitely; the screen's onReplay already forced a cache
        // refetch (MWB-4 #237 R6/R8 P1).
        if (batch.isReplay) clearReplayInFlight();
        safeSet(setStatus, 'offline');
        safeSet(setHasPending, true);
        logger.error('[useAutosave] flush rejected', { planId, kind });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planId, safeSet, clearBackoffTimer, clearReplayInFlight, computeHasPending, rebaseBatch, setDirty, setMirrorDegradedFlag],
  );

  /**
   * Write one batch to the offline mirror (mirror-first durability line).
   * Returns true when the on-device write actually held, false when it failed.
   *
   * A write failure is NOT swallowed (fifty-failures #36): we log it AND raise
   * `mirrorDegraded` so the pill stops claiming on-device durability, then keep
   * the batch alive in the in-memory queue and let the caller continue the
   * network send (the best recovery while the device cannot persist). A
   * subsequent successful write clears the degraded flag. The caller MUST treat
   * a `false` return as "not durable on device" — in particular the
   * background/kill teardown must not abort the in-flight send as though the
   * mirror would replay it (MWB-4 #237 R9 P1).
   */
  const writeMirror = useCallback(
    async (batch: PendingBatch<TWorkingCopy>): Promise<boolean> => {
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
        // The on-device durability line held — clear any prior degradation.
        setMirrorDegradedFlag(false);
        return true;
      } catch (err) {
        // Surface the durability degradation — do not pretend the mirror held.
        // The in-memory queue still keeps the batch alive for this session and
        // the network send proceeds as the recovery path.
        setMirrorDegradedFlag(true);
        logger.error('[useAutosave] mirror write failed (durability degraded)', {
          planId: planIdRef.current,
          err,
        });
        return false;
      }
    },
    [setMirrorDegradedFlag],
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

    // MIRROR FIRST — the kill-the-app guarantee. If the write fails it is NOT
    // swallowed: writeMirror raises `mirrorDegraded` (so the pill stops claiming
    // on-device durability) and we record it so the teardown path knows the
    // batch is NOT durable on disk and must not abort the in-flight send. We
    // still proceed to send: the network write is the best recovery when the
    // device cannot persist (fifty-failures #36/#50).
    const mirrored = await writeMirror(batch);
    mirrorHeldRef.current = mirrored;
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
    // The adopted server copy is now the saved baseline, so there is nothing
    // unsaved: clear the dirty signal and recompute `hasPending` so a stale
    // dirty flag from the just-adopted edit does not linger.
    setDirty(false);
    safeSet(setHasPending, computeHasPending());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setDirty, safeSet, computeHasPending]);

  /**
   * Re-anchor the diff baseline to an EXPLICIT server copy (D-045). Unlike
   * {@link rebaseline} this does NOT clear the dirty signal: the whole point is
   * that the explicit server copy may DIFFER from the current working copy (it
   * still holds a row the coach deleted in the adoption window), so the next
   * diff SHOULD see a delta (a `remove_exercise`) and re-flush. We recompute
   * the dirty signal honestly against the new baseline so `hasPending` reflects
   * that outstanding delete. Like the other re-anchors it refuses to run while
   * a real batch is in flight or queued so a genuine pending edit is preserved.
   */
  const rebaselineTo = useCallback(
    (serverCopy: TWorkingCopy): void => {
      if (!enabledRef.current) return;
      if (currentInFlightRef.current !== null || pendingNextRef.current !== null) {
        return;
      }
      lastSavedValueRef.current = serverCopy;
      // Recompute dirty against the explicit baseline: if the current working
      // copy diverges (the deleted row is absent here but present in the server
      // copy) we stay dirty so the next debounce flush emits the remove op.
      setDirty(
        diffRef.current(lastSavedValueRef.current, latestValueRef.current).length > 0,
      );
      safeSet(setHasPending, computeHasPending());
    },
    [setDirty, safeSet, computeHasPending],
  );

  /**
   * Conflict-adoption re-anchor (MWB-4 #237 R13 D-002). The ONLY re-anchor that
   * may replace `lastSavedValueRef` while a queued edit exists. It is called
   * exclusively from inside the hook's awaited 409-adoption window: the failed
   * send has already vacated `currentInFlightRef`, and the rebased retry is not
   * requeued until AFTER this await, so the only slot that can be non-null here
   * is `pendingNextRef` — a local edit the coach made WHILE request A was in
   * flight (the D-002 case).
   *
   * {@link rebaselineTo} refuses to run when `pendingNextRef !== null` (it must
   * never silently discard a genuine pending edit). That guard, correct for the
   * screen's id-adoption path, made the 409-adoption a NO-OP whenever the coach
   * had a queued edit: the baseline stayed stale and the subsequent rebase
   * re-erased the concurrent server field. This variant instead PRESERVES the
   * queued local delta by re-deriving it against the freshly adopted server
   * baseline:
   *   1. Capture the queued delta's intent (its idempotency key/cause), so the
   *      requeued retry stays the SAME logical edit for transport dedupe.
   *   2. Adopt server truth: `lastSavedValueRef = serverCopy`.
   *   3. Recompute `pendingNextRef` from the LATEST working copy diffed against
   *      the new baseline — the coach's edit-while-in-flight is replayed ON TOP
   *      of server truth, never lost and never clobbering a concurrent field.
   * The failed batch the await is rebasing is recomputed from the same fresh
   * baseline by {@link rebaseBatch} immediately after this returns; because the
   * latest working copy already folds in both the failed and the queued edit, a
   * single diff against `serverCopy` expresses the combined delta on top of
   * server truth.
   */
  const rebaselineToConflict = useCallback(
    (serverCopy: TWorkingCopy): void => {
      if (!enabledRef.current) return;
      // Capture the queued delta's identity BEFORE we move the baseline so the
      // re-derived batch keeps the same idempotency key/cause (one logical edit
      // the transport still dedupes), rather than minting a fresh key that the
      // server would treat as a brand-new request.
      const queued = pendingNextRef.current;
      // Adopt authoritative server truth as the diff baseline. This is the
      // step rebaselineTo refused when a queued edit existed — and the whole
      // point of the D-002 fix.
      lastSavedValueRef.current = serverCopy;
      // Re-derive the queued local delta against the NEW baseline so the coach's
      // edit-while-in-flight survives, expressed on top of server truth.
      const ops = diffRef.current(lastSavedValueRef.current, latestValueRef.current);
      if (queued) {
        if (ops.length === 0) {
          // The adopted server truth already subsumes the queued edit (nothing
          // left to express) — drop the now-empty queued batch cleanly.
          pendingNextRef.current = null;
        } else {
          pendingNextRef.current = {
            ops,
            baseRevisionIndex: indexRef.current,
            lockToken: tokenRef.current,
            cause: queued.cause,
            idempotencyKey: queued.idempotencyKey,
            snapshot: latestValueRef.current,
            isReplay: queued.isReplay,
          };
        }
      }
      // Keep the dirty signal honest against the freshly adopted baseline.
      setDirty(ops.length > 0);
      safeSet(setHasPending, computeHasPending());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setDirty, safeSet, computeHasPending],
  );

  // ─── Debounced arm on value change ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const ops = diffRef.current(lastSavedValueRef.current, value);
    if (ops.length === 0) {
      // The working copy matches the saved baseline again (e.g. an edit was
      // reverted before the debounce fired). Clear the dirty signal so a stale
      // `hasPending` does not block the screen's adoption effect forever.
      if (dirtyStateRef.current && currentInFlightRef.current === null && pendingNextRef.current === null) {
        setDirty(false);
        safeSet(setHasPending, computeHasPending());
      }
      return;
    }

    // D-042: mark dirty the instant the working copy diverges from the saved
    // baseline — BEFORE the debounce flush builds a batch — so `hasPending`
    // reflects the unsaved local edit immediately and the screen's adoption
    // effect cannot clobber it during the post-insert refetch window.
    setDirty(true);
    safeSet(setHasPending, computeHasPending());

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, debounceMs, flush, setDirty, safeSet, computeHasPending]);

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
      // A mirrored batch exists: a previous session was force-quit before the
      // edit was confirmed server-side. Raise the replay-in-flight gate BEFORE
      // the network attempt and notify the screen so it force-invalidates and
      // refetches its (possibly stale, persisted-hydrated) cache. The gate
      // blocks explicit Save until the replay reaches a terminal outcome so a
      // full-replace Save cannot race the refetch and erase the rescued edit
      // (MWB-4 #237 R6 P1).
      replayInFlightRef.current = true;
      safeSet(setReplayInFlight, true);
      onReplayRef.current?.();
      // Rehydrate the pending batch and replay it with the SAME key + lock pair.
      const replay: PendingBatch<TWorkingCopy> = {
        ops: mirrored.batch.ops,
        baseRevisionIndex: mirrored.batch.base_revision_index,
        lockToken: mirrored.batch.lock_token,
        cause: mirrored.batch.cause,
        idempotencyKey: mirrored.idempotencyKey,
        // Mark this batch as the replay so its terminal server outcome (200 /
        // 409 / hard reject) clears the replay-in-flight gate.
        isReplay: true,
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

  // ─── Navigation beforeRemove: owned by the screen, not this hook ────────────
  // The Navigation `beforeRemove` listener is NOT registered here — it lives in
  // the screen, where it fires a FIRE-AND-FORGET mirror-first flush (`void
  // autosaveFlush()`) without `preventDefault` or awaiting the promise, so the
  // route tears down instantly while the batch is captured to the offline
  // mirror (the durability line) and replays on the next mount. This hook stays
  // navigation-agnostic: its own durable-capture guarantee comes from the
  // stable flush (reads latestValueRef) firing from BOTH the AppState listener
  // and the unmount cleanup below, so the last edit is always mirrored
  // regardless of how teardown is triggered.

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
      // MWB-4 #237 R11 (P1): tear down the conflict-rebase backoff timer too, so
      // a queued conflict re-pump cannot fire after the editor has unmounted
      // (the teardown flush below already captures the latest edit to the
      // mirror, which replays on the next mount).
      clearConflictTimer();
      if (enabledRef.current) {
        // Mirror-first durable capture of the latest edit (stable flush reads
        // latestValueRef, so it never misses the last keystroke), THEN abort the
        // obsolete network request — BUT ONLY IF the mirror write held. When the
        // mirror write held, the batch is on disk to replay, so a cancelled
        // request is safe and we don't leave a write racing after the editor is
        // gone. When it did NOT hold (mirrorDegraded), the in-flight send is the
        // ONLY surviving copy, so we must let it complete rather than abort it
        // (aborting would silently lose the edit — fifty-failures #36/#50).
        void flush().finally(() => {
          if (mirrorHeldRef.current && abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
          }
        });
      }
    };
  }, [planId, enabled, flush, clearBackoffTimer, clearConflictTimer]);

  return useMemo(
    () => ({
      status,
      lastSavedAt,
      version,
      lockToken: tokenState,
      flush,
      hasPending,
      mirrorDegraded,
      rebaseline,
      replayInFlight,
      rebaselineTo,
      rebaselineToConflict,
    }),
    [status, lastSavedAt, version, tokenState, flush, hasPending, mirrorDegraded, rebaseline, replayInFlight, rebaselineTo, rebaselineToConflict],
  );
}
