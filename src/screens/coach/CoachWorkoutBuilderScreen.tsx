/**
 * CoachWorkoutBuilderScreen — create or edit a coach-owned workout
 * plan and (optionally) seed its ordered exercise rows.
 *
 * Sprint B-2 final wave. The screen wraps three workout-builder hooks:
 *   - useCreateWorkoutPlan      (when params.planId is undefined)
 *   - useUpdateWorkoutPlan      (when editing an existing plan)
 *   - useSetWorkoutExercises    (replace-all semantics, matches the
 *                                PUT /workout-plans/:id/exercises
 *                                contract on the backend)
 *
 * Exercise rows are populated by searching the ExerciseDB-backed
 * catalog via useExerciseSearch. Reorder is intentionally simple —
 * up/down arrow buttons on each row instead of pulling in a
 * drag-and-drop dependency. Sets, reps_or_duration_seconds, rest, and
 * notes are inline numeric inputs.
 *
 * Palette note: uses `sc.accent` from useTheme(). On Body pillar this
 * resolves to forest (#2C4A36). Oxblood (#4A0404) is reserved for the
 * Finance pillar per src/theme/tokens.ts line 48. PR #130's coach
 * screens follow the same convention; we mirror it here.
 *
 * MWB-4 (autosave, flag `EXPO_PUBLIC_FF_MWB_AUTOSAVE`, default OFF): when the
 * flag is ON the screen ALSO mounts a Google-Docs-style autosave — a debounced
 * op-diff (workoutBuilderAutosaveDiff) is streamed to the MWB-3 backend through
 * useAutosave, an offline mirror lets an in-flight edit survive an app kill, a
 * 409 rebases by refetching the plan, and a calm save-state pill rides in the
 * header. When the flag is OFF the autosave hook is mounted with `enabled:
 * false` (fully inert — no timers, no network, no mirror) and the screen behaves
 * byte-identically to its legacy explicit-Save (PUT replace-all) form. The
 * explicit Save button stays in BOTH modes as the big-save fallback.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Exercise } from '../../api/exerciseLibraryApi';
import type {
  UpsertExerciseRowInput,
  WorkoutPlanExercise,
  WorkoutType,
} from '../../api/workoutBuilderApi';
import {
  useCreateWorkoutPlan,
  useSetWorkoutExercises,
  useUpdateWorkoutPlan,
  useWorkoutPlan,
} from '../../hooks/useWorkoutBuilder';
import { useExerciseSearch } from '../../hooks/useExerciseLibrary';
import { spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import { useAutosave } from '../../hooks/useAutosave';
import { generateClientId } from '../../utils/clientId';
import AutosaveStatusPill from '../../components/workout/AutosaveStatusPill';
import RevisionHistorySheet from '../../components/coach/ai-entry/RevisionHistorySheet';
import {
  WorkoutAutosaveApiError,
  workoutAutosaveApi,
} from '../../api/workoutAutosaveApi';
import {
  describeHistoryFailure,
  describeUnconfirmedHistory,
  HISTORY_CONFIRMED_REDO,
  HISTORY_CONFIRMED_UNDO,
  HISTORY_EDITED_ELSEWHERE,
  HISTORY_REFRESH_FAILED,
  HISTORY_WAIT_FOR_SAVE,
  isUnknownHistoryOutcome,
  type HistoryDirection,
} from './workoutBuilderUndo';
import {
  diffWorkingCopy,
  type WorkoutBuilderWorkingCopy,
} from './workoutBuilderAutosaveDiff';
import { describeAutosaveRefusal } from './workoutBuilderAccess';
import CoachExerciseName from '../../components/coach/workout-builder/CoachExerciseName';
import AiBuilderSheet from '../../components/coach/ai-builder/AiBuilderSheet';
import { fireAiHaptic, useAiBuilder } from '../../components/coach/ai-builder/useAiBuilder';
import type { AiBuilderRef } from '../../api/aiBuilderApi';
import { appliedToast, SAVE_FIRST_COPY } from '../../components/coach/ai-builder/aiBuilderCopy';

/** S-MWB-3: the undo / redo barrier phases (see the screen body). */
type HistoryOutcome = 'applied' | 'elsewhere';
type HistoryGate =
  | { phase: 'running' }
  | {
      phase: 'unconfirmed';
      direction: HistoryDirection;
      target: number;
      expectedHead: number;
    }
  | {
      phase: 'reload';
      direction: HistoryDirection;
      head: number;
      lockToken: string;
      expectedHead: number;
      outcome: HistoryOutcome;
    };

/**
 * The live phase of the history barrier. Reading through a function keeps
 * TypeScript from reusing a narrowing taken before an await (the ref moves
 * while a flush or request is in flight).
 */
function historyGatePhase(ref: {
  readonly current: HistoryGate | null;
}): HistoryGate['phase'] | null {
  return ref.current?.phase ?? null;
}

type RouteParam = { planId?: string };

/**
 * Placeholder lock token + base index used for the FIRST autosave attempt.
 *
 * The backend lock_token is an HMAC of (planId, version, head_revision_id)
 * computed with a server-only secret, and `GET /workout-plans/:id` does NOT
 * expose version / head_revision_index / lock_token (the mobile WorkoutPlan
 * shape has none of those fields). The client therefore CANNOT derive the real
 * token up front. By design the first autosave 409s with `autosave_lock_stale`
 * carrying the correct fresh lock_token + head_revision_index; the hook
 * fast-forwards and the next batch lands. Starting from a 16-zero token + index
 * 0 makes that bootstrap deterministic. (Documented as a deviation in
 * MWB-4_BUILDER_REPORT.md.)
 */
const AUTOSAVE_BOOTSTRAP_LOCK_TOKEN = '0000000000000000';
const AUTOSAVE_BOOTSTRAP_BASE_INDEX = 0;

const WORKOUT_TYPES: WorkoutType[] = ['strength', 'cardio', 'mobility'];

export interface DraftExerciseRow {
  /**
   * Stable per-row CLIENT identifier, generated once when the row first exists
   * on this device (a server-loaded row gets one on adoption; a brand-new row
   * gets one in `addExercise`). It persists with the row for its whole life and
   * is NEVER sent to the server — the autosave working copy (and the legacy PUT
   * payload) carry only server-facing fields, so the wire contract / DB schema
   * are unchanged (R69). MWB-4 #237 (D-045) uses it to track a row deleted in
   * the autosave insert/adoption window (when it has no `row_id` yet) so the
   * post-insert refetch does not resurrect it.
   */
  clientId: string;
  /**
   * Server-assigned row uuid for a row the backend already persisted; undefined
   * for a row added on-device this session. Used by the autosave diff to emit
   * remove_exercise / reorder ops (which require a uuid) and to upsert with the
   * right id. The legacy explicit-Save (PUT replace-all) path ignores it.
   */
  row_id?: string;
  exercise_external_id: string;
  display_name: string;
  sets: number;
  reps_or_duration_seconds: number;
  rest_seconds: number | null;
  weight_lbs: number | null;
  superset_group_id: string | null;
  notes: string | null;
}

/**
 * Build the explicit-Save (PUT replace-all) exercise payload from the local
 * draft rows.
 *
 * MWB-4 #237 R14 (D-001): the new `weight_lbs` + `superset_group_id` fields are
 * gated on the autosave feature flag. When `autosaveEnabled` is FALSE the
 * builder MUST emit the BYTE-IDENTICAL legacy payload the base branch sent —
 * exactly `exercise_external_id`, `order`, `sets`, `reps_or_duration_seconds`,
 * `rest_seconds`, `notes`, in that key order, and NEITHER `weight_lbs` NOR
 * `superset_group_id`. This preserves the hard invariant that with the flag off
 * the CoachWorkoutBuilderScreen behaves identically to its legacy explicit-Save
 * (PUT replace-all) form, including the exact PUT body shape.
 *
 * MWB-4 #237 R11 (P1): when `autosaveEnabled` is TRUE the backend `setExercises`
 * endpoint is a FULL REPLACE - every persisted field omitted from a row is
 * reset to null. `weight_lbs` and `superset_group_id` are carried in local
 * state and are preserved by the autosave diff + replay/adoption path, so
 * omitting them in the flag-on path silently erased server-preserved weights
 * and supersets the coach never re-entered. The flag-on branch therefore maps
 * EVERY persisted field (a `null` local value is sent as `undefined` so the row
 * input stays schema-clean) so an explicit Save round-trips weight_lbs and
 * superset_group_id at parity with autosave.
 *
 * Exported as a pure function so both flag branches are unit-testable without a
 * full screen render.
 */
export function buildSetExercisesPayload(
  rows: DraftExerciseRow[],
  autosaveEnabled: boolean,
): UpsertExerciseRowInput[] {
  if (!autosaveEnabled) {
    // Legacy byte-identical payload: same keys, same order, no weight_lbs /
    // superset_group_id. Do not add fields here without re-checking the
    // flag-off byte-identity test.
    return rows.map((r, idx) => ({
      exercise_external_id: r.exercise_external_id,
      order: idx + 1,
      sets: r.sets,
      reps_or_duration_seconds: r.reps_or_duration_seconds,
      rest_seconds: r.rest_seconds ?? undefined,
      notes: r.notes ?? undefined,
    }));
  }
  return rows.map((r, idx) => ({
    exercise_external_id: r.exercise_external_id,
    order: idx + 1,
    sets: r.sets,
    reps_or_duration_seconds: r.reps_or_duration_seconds,
    weight_lbs: r.weight_lbs ?? undefined,
    rest_seconds: r.rest_seconds ?? undefined,
    superset_group_id: r.superset_group_id ?? undefined,
    notes: r.notes ?? undefined,
  }));
}

/**
 * The server-facing fields that identify a row's CONTENT (everything the
 * backend persists EXCEPT identity + order). Shared by the local DraftExerciseRow
 * and a server WorkoutPlanExercise so a row deleted before its row_id existed
 * can be matched back to the server row the post-insert refetch resurrects
 * (D-045). Order is intentionally excluded — the resurrected row may land at a
 * different index than where it was added/deleted.
 */
function rowCompositeSignature(row: {
  exercise_external_id: string;
  sets: number;
  reps_or_duration_seconds: number;
  rest_seconds: number | null;
  weight_lbs: number | null;
  superset_group_id: string | null;
  notes: string | null;
}): string {
  return JSON.stringify([
    row.exercise_external_id,
    row.sets,
    row.reps_or_duration_seconds,
    row.rest_seconds,
    row.weight_lbs,
    row.superset_group_id,
    row.notes,
  ]);
}

/** Composite signature for a server exercise row (same field order as above). */
function serverRowCompositeSignature(e: WorkoutPlanExercise): string {
  return rowCompositeSignature({
    exercise_external_id: e.exercise_external_id,
    sets: e.sets,
    reps_or_duration_seconds: e.reps_or_duration_seconds,
    rest_seconds: e.rest_seconds,
    weight_lbs: e.weight_lbs,
    superset_group_id: e.superset_group_id,
    notes: e.notes,
  });
}

export default function CoachWorkoutBuilderScreen() {
  const route = useRoute<RouteProp<Record<string, RouteParam>, string>>();
  const navigation = useNavigation();
  const planId = route.params?.planId;
  const isEditing = Boolean(planId);

  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const qc = useQueryClient();
  const {
    data: existingPlan,
    refetch: refetchPlan,
    isError: planLoadFailed,
  } = useWorkoutPlan(planId);
  const createMut = useCreateWorkoutPlan();
  const updateMut = useUpdateWorkoutPlan();
  const setExercisesMut = useSetWorkoutExercises();

  const [name, setName] = useState<string>(existingPlan?.name ?? '');
  const [type, setType] = useState<WorkoutType>(
    existingPlan?.type ?? 'strength',
  );
  const [duration, setDuration] = useState<string>(
    existingPlan?.duration_estimate_minutes != null
      ? String(existingPlan.duration_estimate_minutes)
      : '',
  );
  // AUDIT-07-125: a plan opened from the Programs library (a program day or a
  // saved workout) is usually not in the query cache yet, so the initialisers
  // above ran with no plan and the editor showed a blank name, the wrong type
  // and a disabled Save. Fill the plan details in once, the first time the
  // plan arrives, unless the coach already typed into one of them.
  const metaHydratedRef = useRef(Boolean(existingPlan));
  const metaTouchedRef = useRef(false);
  useEffect(() => {
    if (metaHydratedRef.current || !existingPlan) return;
    metaHydratedRef.current = true;
    if (metaTouchedRef.current) return;
    setName(existingPlan.name ?? '');
    setType(existingPlan.type ?? 'strength');
    setDuration(
      existingPlan.duration_estimate_minutes != null
        ? String(existingPlan.duration_estimate_minutes)
        : '',
    );
  }, [existingPlan]);
  const planLoading = isEditing && !existingPlan;
  // Map a server exercise row into a local DraftExerciseRow, reusing the stable
  // clientId we already minted for that server row_id when one exists so the
  // identity survives a refetch/adoption (and the deletedKeysRef bookkeeping
  // below can match it). A row_id we have never seen gets a fresh clientId.
  const rowIdToClientIdRef = useRef<Map<string, string>>(new Map());
  const clientIdForServerRow = useCallback((serverRowId: string): string => {
    const existing = rowIdToClientIdRef.current.get(serverRowId);
    if (existing) return existing;
    const minted = generateClientId();
    rowIdToClientIdRef.current.set(serverRowId, minted);
    return minted;
  }, []);

  const [rows, setRows] = useState<DraftExerciseRow[]>(() =>
    (existingPlan?.exercises ?? []).map((e) => ({
      clientId: clientIdForServerRow(e.id),
      row_id: e.id,
      exercise_external_id: e.exercise_external_id,
      display_name: e.exercise_external_id,
      sets: e.sets,
      reps_or_duration_seconds: e.reps_or_duration_seconds,
      rest_seconds: e.rest_seconds,
      weight_lbs: e.weight_lbs,
      superset_group_id: e.superset_group_id,
      notes: e.notes,
    })),
  );

  // MWB-4 #237 (D-045): clientIds of rows the coach has removed. A row deleted
  // BEFORE its server row_id was adopted produces NO remove_exercise op (the
  // diff needs a row_id), so the dirty signal can stay false and the
  // post-insert refetch's full-replace adoption would otherwise RESURRECT it.
  // We record the stable clientId on removal (regardless of row_id presence)
  // and the adoption effect filters server rows through this set so the delete
  // is preserved — then re-issued as a remove_exercise once the server row_id
  // is known. Entries are pruned once the server confirms the row is gone.
  const deletedKeysRef = useRef<Set<string>>(new Set());

  // Search box state — local-only.
  const [search, setSearch] = useState<string>('');
  const searchEnabled = search.trim().length >= 2;
  const { data: searchResult } = useExerciseSearch(
    { q: search.trim(), limit: 8 },
    { enabled: searchEnabled },
  );

  // S-MWB-3 (B-328-5 / B-328-6): the history barrier. Raised BEFORE the
  // pre-undo flush and held until the server copy has been adopted (or the
  // request was definitely refused). While it is up the editor is read-only:
  // inputs, row controls, Save, the status-pill flush and the leave flush all
  // stand still, so nothing the coach types can be overwritten by the copy the
  // undo brings back. An unknown outcome (no response, 5xx, unreadable reply)
  // keeps it up in the `unconfirmed` phase until a fenced retry settles what
  // the server holds; a landed undo whose refreshed copy did not load keeps it
  // up in the `reload` phase until the copy loads.
  const historyGateRef = useRef<HistoryGate | null>(null);
  const [historyGate, setHistoryGateState] = useState<HistoryGate | null>(null);
  const setHistoryGate = useCallback((next: HistoryGate | null) => {
    historyGateRef.current = next;
    setHistoryGateState(next);
  }, []);
  const historyBusy = historyGate?.phase === 'running';
  const editorLocked = historyGate !== null;

  const addExercise = useCallback((ex: Exercise) => {
    if (historyGateRef.current) return;
    setRows((cur) => [
      ...cur,
      {
        // Stable client identity for this on-device row, minted once at
        // creation. Tracks the row across the id-less insert / adoption window
        // (D-045) and is never serialized to the server.
        clientId: generateClientId(),
        // No row_id: a brand-new on-device row. The autosave diff emits an
        // upsert_exercise WITHOUT a row_id (the server assigns one on insert,
        // which the next refetch folds back in).
        exercise_external_id: ex.id,
        display_name: ex.name,
        sets: 3,
        reps_or_duration_seconds: 10,
        rest_seconds: 60,
        weight_lbs: null,
        superset_group_id: null,
        notes: null,
      },
    ]);
    setSearch('');
  }, []);

  const moveRow = useCallback((idx: number, dir: -1 | 1) => {
    if (historyGateRef.current) return;
    setRows((cur) => {
      const next = cur.slice();
      const target = idx + dir;
      if (target < 0 || target >= next.length) return cur;
      const tmp = next[idx] as DraftExerciseRow;
      next[idx] = next[target] as DraftExerciseRow;
      next[target] = tmp;
      return next;
    });
  }, []);

  // Composite signature of a deleted id-less row -> the clientIds removed with
  // that signature. A row deleted before adoption has no row_id, so the only
  // way to recognise the server row that the post-insert refetch resurrects is
  // to match its server-facing fields (D-045). Stored as a FIFO list per
  // signature so two identical rows added-then-one-deleted are matched one for
  // one rather than both being dropped.
  const deletedSignaturesRef = useRef<Map<string, string[]>>(new Map());

  const removeRow = useCallback((idx: number) => {
    if (historyGateRef.current) return;
    setRows((cur) => {
      const target = cur[idx];
      // Record the stable clientId of the removed row REGARDLESS of whether it
      // has a server row_id yet (D-045). If it was deleted in the id-less
      // insert/adoption window the diff cannot emit a remove_exercise, so this
      // is the only durable record of the coach's intent; the adoption effect
      // reads it to keep the row deleted (and re-issue the server-side remove
      // once the row_id is known) instead of letting the refetch resurrect it.
      if (target) {
        deletedKeysRef.current.add(target.clientId);
        // Index by composite signature too, so a resurrected server row with a
        // brand-new row_id (the id-less insert the coach then deleted) can be
        // matched back to this clientId and dropped.
        const sig = rowCompositeSignature(target);
        const list = deletedSignaturesRef.current.get(sig) ?? [];
        list.push(target.clientId);
        deletedSignaturesRef.current.set(sig, list);
      }
      return cur.filter((_, i) => i !== idx);
    });
  }, []);

  const updateRow = useCallback(
    (idx: number, patch: Partial<DraftExerciseRow>) => {
      if (historyGateRef.current) return;
      setRows((cur) =>
        cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  // ─── MWB-4 autosave wiring (flag-gated) ────────────────────────────────────
  // The hook is ALWAYS mounted (hooks cannot be conditional), but `enabled` is
  // driven by the flag AND the plan-exists precondition. With `enabled: false`
  // the hook is fully inert — no timers, no network, no mirror writes — so a
  // flag-off build does ZERO autosave work and the screen is byte-identical to
  // its legacy form. Autosave only runs when EDITING an existing plan: a brand
  // new (not-yet-created) plan has no planId to PATCH, so it stays on the
  // explicit-Create path until first save.
  const autosaveEnabled = featureFlags.mwbAutosave && isEditing && Boolean(planId);

  // The working copy the diff runs over. Memoised on the editable fields so an
  // unrelated re-render does not churn a new reference (which would re-arm the
  // debounce). plan-meta duration is NOT in the autosave meta (the backend
  // plan_meta op set covers name/type/duration_weeks/week/day, not the legacy
  // duration_estimate_minutes), so duration edits stay on the explicit-Save
  // path; name + type + the row set are what autosave streams.
  const workingCopy = useMemo<WorkoutBuilderWorkingCopy>(
    () => ({
      meta: { name, type },
      rows: rows.map((r) => ({
        rowId: r.row_id,
        exerciseExternalId: r.exercise_external_id,
        sets: r.sets,
        repsOrDurationSeconds: r.reps_or_duration_seconds,
        restSeconds: r.rest_seconds,
        weightLbs: r.weight_lbs,
        supersetGroupId: r.superset_group_id,
        notes: r.notes,
      })),
    }),
    [name, type, rows],
  );

  // True when the current working copy still holds at least one row that was
  // added on-device and has NOT yet adopted a server id (rowId undefined). Such
  // a row autosaves as an id-less `upsert_exercise` ("insert"); after that
  // insert lands the server has assigned it a real id we do not yet hold, so we
  // MUST refetch to adopt it before the next edit/delete/reorder of that row —
  // otherwise the diff treats it as brand-new again (duplicate insert) or skips
  // its delete (no row_id to remove). This is the P1 data-integrity trigger.
  const hasIdlessRows = useMemo(
    () => workingCopy.rows.some((r) => r.rowId === undefined),
    [workingCopy.rows],
  );
  const hasIdlessRowsRef = useRef(hasIdlessRows);
  hasIdlessRowsRef.current = hasIdlessRows;

  // After a successful autosave that included an id-less insert, refetch the
  // plan so the server-assigned row ids flow back in. The re-baseline effect
  // below then folds them into `rows` (once pending clears) and re-anchors the
  // autosave diff baseline, so a follow-up edit/delete/reorder of that row
  // names the real id instead of re-inserting it. We only refetch when an
  // id-less row was actually in play — a pure metadata/known-row save needs no
  // id adoption, so we avoid a needless network round-trip.
  // Bumped each time we ASK for a post-save/post-conflict refetch to fold
  // server-assigned row ids back in. It is a STATE (not a ref) on purpose: the
  // id-only merge adoption below lists it as a dependency, so the merge effect
  // re-runs the moment a refetch is requested even when `existingPlan`'s
  // reference is otherwise stable. The bump also gates the merge so it only
  // ever runs in response to a genuine refetch we triggered — never an
  // incidental `existingPlan` churn — matching production, where `existingPlan`
  // changes only when a refetch resolves.
  const [refetchSeq, setRefetchSeq] = useState(0);
  const refetchSeqRef = useRef(0);
  const adoptedRefetchSeqRef = useRef(0);
  // MWB-4 #237 R11 (P1): the conflict handler must AWAIT authoritative server
  // truth (refetch + re-anchor the autosave diff baseline) BEFORE the hook
  // rebases + re-sends the pending batch, otherwise the resend diffs a stale
  // local baseline and the full-row upsert can erase a concurrent server edit.
  // The re-anchor uses `autosave.rebaselineTo` + `buildServerWorkingCopy`, both
  // declared AFTER the `useAutosave` call that `onAutosaveConflict` is passed
  // into, so we route the re-anchor through this ref (populated once those are
  // in scope) to keep the handler defined before the hook without a TDZ cycle.
  const rebaselineToServerRef = useRef<
    ((exercises: WorkoutPlanExercise[]) => void) | null
  >(null);
  // True once the screen has folded server data into local rows at least once.
  // The very first arrival of `existingPlan` is a legitimate full adopt even
  // though no refetch was requested; after that, only a fresh refetch we
  // triggered re-runs the adoption so incidental renders never clobber.
  const initialLoadDoneRef = useRef(false);

  // MWB-4 #237 R9 (P1): adoption gate for the terminal-200 replay window.
  //
  // LIFECYCLE — `replayAdoptionPending` spans the WHOLE replay reconciliation,
  // not just the in-flight network leg:
  //   RAISE  : `onAutosaveReplay` fires (a mirrored batch was found on mount and
  //            is being replayed). We record the refetchSeq that the replay's
  //            forced refetch bumped (`replayRefetchSeqRef`) and raise the flag.
  //   HOLD   : through the terminal outcome of the replay (200 / 409 / reject)
  //            AND through the post-replay refetch DELIVERING AND the adoption
  //            effect folding refreshed server truth into `rows` AND the
  //            autosave baseline reanchoring to that adopted copy. `canSave`
  //            includes `!replayAdoptionPending`, so an explicit full-replace
  //            Save cannot fire from stale pre-refetch rows in this window (the
  //            terminal-200 race the R8 audit flagged: `replayInFlight` alone
  //            clears on the replay 200, BEFORE adoption completes).
  //   CLEAR  : (1) adoption success — the replay-driven refetch's seq has been
  //            adopted into rows AND the baseline reanchored AND the replay is
  //            no longer in flight (cleared in the rebaseline effect for the
  //            clean path, inline after `rebaselineTo` for the D-045 drop path);
  //            (2) refetch HARD-FAILURE — the forced refetch rejects or resolves
  //            with an error, so refreshed truth will never arrive; we DEGRADE
  //            rather than lock Save forever, clearing the flag and leaving the
  //            existing conflict/offline refresh UX to recover;
  //            (3) unmount/remount — the flag is component state, so a remount
  //            starts clear and the mount-mirror replay re-raises it.
  const [replayAdoptionPending, setReplayAdoptionPending] = useState(false);
  const replayAdoptionPendingRef = useRef(false);
  // The refetchSeq the replay's forced refetch bumped to. Adoption only clears
  // the gate once the adopted sequence has caught up to (>=) this value, so an
  // earlier incidental adoption can never clear a later replay's gate.
  const replayRefetchSeqRef = useRef(0);
  // Set true once the replay-driven refetch has been adopted into `rows` AND the
  // autosave baseline has reanchored to it. A dedicated effect then releases
  // `replayAdoptionPending` once the replay is also no longer in flight. Reset
  // to false whenever the gate is (re)raised so a later replay starts fresh.
  const replayAdoptionAdoptedRef = useRef(false);
  const setReplayAdoptionPendingFlag = useCallback((next: boolean) => {
    if (replayAdoptionPendingRef.current === next) return;
    replayAdoptionPendingRef.current = next;
    setReplayAdoptionPending(next);
  }, []);

  // MWB-4 #237 R10 (P1): the replay's forced refetch HARD-FAILED (rejected or
  // resolved with an error), so refreshed server truth never arrived. We must
  // NOT silently clear the adoption gate into a normal enabled Save — that would
  // reopen the stale full-replace window the gate exists to close (a Save built
  // from pre-refetch rows would erase the rescued edit). Instead we surface a
  // RECOVERABLE refresh state: `canSave` stays false, the status pill shows the
  // calm "Edited elsewhere — tap to refresh" conflict affordance, and tapping it
  // RE-RUNS the refetch. A later refetch success clears this and runs the normal
  // adoption + rebaseline, releasing the gate. The Refresh affordance is the
  // user-visible path out, so Save is never locked forever (fifty-failures
  // #28/#36).
  const [replayRefetchFailed, setReplayRefetchFailed] = useState(false);
  const replayRefetchFailedRef = useRef(false);
  const setReplayRefetchFailedFlag = useCallback((next: boolean) => {
    if (replayRefetchFailedRef.current === next) return;
    replayRefetchFailedRef.current = next;
    setReplayRefetchFailed(next);
  }, []);

  // S-MWB-2 builder undo/redo: session stacks of plan revision indexes (see
  // workoutBuilderUndo.ts). A confirmed save makes "the state before it"
  // (head - 1) undoable and ends any redo branch.
  // Refs are the source of truth (read after an awaited flush); state mirrors
  // them for rendering.
  const undoStackRef = useRef<number[]>([]);
  const redoStackRef = useRef<number[]>([]);
  const [undoStack, setUndoStackState] = useState<number[]>([]);
  const [redoStack, setRedoStackState] = useState<number[]>([]);
  const setUndoStack = useCallback((next: number[]) => {
    undoStackRef.current = next;
    setUndoStackState(next);
  }, []);
  const setRedoStack = useCallback((next: number[]) => {
    redoStackRef.current = next;
    setRedoStackState(next);
  }, []);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);

  const onAutosaveSaved = useCallback((next?: { headRevisionIndex: number }) => {
    if (!autosaveEnabled) return;
    if (next && next.headRevisionIndex > 0) {
      const before = next.headRevisionIndex - 1;
      const cur = undoStackRef.current;
      if (cur[cur.length - 1] !== before) setUndoStack([...cur, before]);
      setRedoStack([]);
    }
    if (!hasIdlessRowsRef.current) return;
    refetchSeqRef.current += 1;
    setRefetchSeq(refetchSeqRef.current);
    void refetchPlan();
  }, [autosaveEnabled, refetchPlan, setUndoStack, setRedoStack]);

  // On a 409 the plan moved ahead (the first-autosave bootstrap, a replay of an
  // already-applied batch, or an edit from another device). The hook has
  // already fast-forwarded its lock token + index from the conflict body AND
  // kept the user's local ops pending; it will RE-DIFF them against the server
  // head and re-submit on the fresh baseline. Our job here is to bring the
  // server head in (refetch) so that re-baseline is honest. We deliberately do
  // NOT clear the local rows: the post-refetch re-baseline effect below is
  // gated on `!autosave.hasPending`, so it never clobbers the coach's in-flight
  // edit — the hook's rebase carries those ops to the server, and the refetch
  // only folds in server-assigned row ids once the pending batch settles.
  // (Note: as of #237 R13 the first-autosave bootstrap stale-lock 409 ALSO
  // calls and AWAITS this handler — it must adopt server truth before rebasing,
  // because a concurrent edit can land between screen load and the coach's
  // first keystroke (see useAutosave.ts bootstrap-409 path). What differs is
  // only the UX/backoff/budget treatment, NOT whether adoption runs: a bootstrap
  // 409 stays in the quiet 'syncing' state, is EXEMPT from the conflict budget
  // and backoff, and re-sends immediately after adoption; a real external-edit
  // conflict surfaces the visible 'conflict' state and is subject to the budget
  // and backoff. The refetch + re-baseline work this handler does is identical
  // for both paths.)
  //
  // MWB-4 #237 R11 (P1): this handler returns a Promise the hook AWAITS before
  // it rebases + re-sends the pending batch. We refetch the plan, and once the
  // authoritative server copy arrives we re-anchor the autosave diff baseline
  // to it (rebaselineToServerRef -> autosave.rebaselineTo). Only after that
  // does the hook re-diff the pending ops, so the resend expresses the coach's
  // delta ON TOP OF server truth rather than a stale full-row upsert that would
  // erase a concurrent server edit (e.g. another field reset to null). If the
  // refetch hard-fails (rejects or resolves with an error) we throw so the hook
  // treats it as a failed adoption and surfaces manual recovery instead of
  // resending over a possibly-stale baseline. A malformed conflict body arrives
  // here as `undefined`; we still refetch so the coach sees the latest server
  // truth, but the hook does not auto-resend that doomed batch.
  const onAutosaveConflict = useCallback(async (): Promise<void> => {
    if (!autosaveEnabled) return;
    refetchSeqRef.current += 1;
    setRefetchSeq(refetchSeqRef.current);
    const result = await refetchPlan();
    if (result?.isError) {
      throw new Error('workout plan refetch failed on autosave conflict');
    }
    const serverExercises = result?.data?.exercises;
    if (serverExercises) {
      // Anchor lastSavedValueRef to the refetched server truth so the hook's
      // subsequent rebase diffs against it, not the stale local baseline.
      rebaselineToServerRef.current?.(serverExercises);
    }
  }, [autosaveEnabled, refetchPlan]);

  // A mirrored batch was found on mount and is being replayed after a force-
  // quit/relaunch (MWB-4 #237 R6 P1). The replay can land the rescued edit on
  // the server, but this freshly-mounted builder may be showing a STALE plan:
  // `useWorkoutPlan` has a 5-minute staleTime and React Query persists the
  // cache for cold-start hydration, so the cached copy can predate the rescued
  // edit. We therefore force-INVALIDATE the single-plan key (and the list) so
  // their staleTime can no longer suppress a network read, then drive an
  // unconditional refetch + bump `refetchSeq` so the adoption effect re-runs
  // and rebaselines the form from refreshed server truth. This is NOT gated on
  // `hasIdlessRows` (unlike `onAutosaveSaved`): on replay we must reconcile the
  // cache even when every local row already has an id, otherwise the stale
  // cached plan survives and the subsequent explicit-Save full-replace would
  // erase the rescued edit. The hook holds `replayInFlight` true until the
  // replay settles, which blocks explicit Save so it cannot race this refetch.
  //
  // R9 P1: `replayInFlight` alone clears the moment the replay lands a 200, but
  // the adoption effect only folds the refreshed truth into `rows` on a LATER
  // render — leaving a window where Save re-enables over stale rows. We close it
  // by ALSO raising `replayAdoptionPending` here (recording the refetchSeq this
  // refetch bumps), which `canSave` honours until the refetch has delivered and
  // been adopted and the baseline reanchored.
  //
  // R10 P1: if the forced refetch HARD-FAILS (rejects or resolves with an
  // error) refreshed server truth never arrives. We must NOT silently clear the
  // gate into a normal enabled Save — that reopens the stale full-replace window
  // the gate exists to close. Instead we KEEP the gate raised and set
  // `replayRefetchFailed`, which surfaces a recoverable refresh affordance on
  // the status pill ("Edited elsewhere — tap to refresh"). Tapping it re-runs
  // this same refetch; a later success clears the failed flag and runs the
  // normal adoption + rebaseline, which releases the gate. The Refresh
  // affordance is the user-visible path out, so Save is never locked forever
  // (fifty-failures #28/#36).
  const runReplayRefetch = useCallback(() => {
    if (!autosaveEnabled) return;
    if (planId) {
      void qc.invalidateQueries({ queryKey: ['workout-plans', planId] });
    }
    void qc.invalidateQueries({ queryKey: ['workout-plans'] });
    refetchSeqRef.current += 1;
    setRefetchSeq(refetchSeqRef.current);
    // Record the seq this replay refetch targets and raise the adoption gate
    // BEFORE awaiting the refetch, so Save is held from the first render after
    // replay detection (not only once the network resolves). A retry after a
    // prior hard-failure clears the failed flag for the duration of the attempt
    // so the pill reads as in-progress rather than still-failed.
    replayRefetchSeqRef.current = refetchSeqRef.current;
    replayAdoptionAdoptedRef.current = false;
    setReplayAdoptionPendingFlag(true);
    setReplayRefetchFailedFlag(false);
    void refetchPlan()
      .then((result) => {
        // React Query's refetch resolves with a QueryObserverResult even on a
        // failed fetch; treat an error result as a hard failure.
        if (result?.isError) {
          // Keep the gate raised (Save stays blocked) and surface the
          // recoverable refresh state instead of reopening a stale Save.
          setReplayRefetchFailedFlag(true);
        }
      })
      .catch(() => {
        // The refetch rejected outright — refreshed truth will not arrive on
        // this attempt. Keep Save blocked and surface the refresh affordance.
        setReplayRefetchFailedFlag(true);
      });
  }, [
    autosaveEnabled,
    planId,
    qc,
    refetchPlan,
    setReplayAdoptionPendingFlag,
    setReplayRefetchFailedFlag,
  ]);

  const onAutosaveReplay = useCallback(() => {
    runReplayRefetch();
  }, [runReplayRefetch]);

  const autosave = useAutosave<WorkoutBuilderWorkingCopy>({
    planId: planId ?? '',
    value: workingCopy,
    diff: diffWorkingCopy,
    baseRevisionIndex: AUTOSAVE_BOOTSTRAP_BASE_INDEX,
    lockToken: AUTOSAVE_BOOTSTRAP_LOCK_TOKEN,
    enabled: autosaveEnabled,
    onSaved: onAutosaveSaved,
    onConflict: onAutosaveConflict,
    onReplay: onAutosaveReplay,
  });
  const autosaveHasPendingRef = useRef(false);
  autosaveHasPendingRef.current = autosave.hasPending;

  // Force a final mirror-first flush before the screen is removed from the
  // stack (back gesture / header back / programmatic goBack). This closes the
  // dirty-guard gap (#12): a coach who edits and immediately navigates away has
  // their last keystroke captured to the offline mirror (and sent if online)
  // before teardown. The hook's `flush` is stable and reads the latest working
  // copy from a ref, so this never fires a stale closure. We do not block the
  // transition (no preventDefault): the mirror write is the durability line, so
  // navigation stays instant while the batch survives.
  const autosaveFlush = autosave.flush;
  useEffect(() => {
    if (!autosaveEnabled) return undefined;
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      // The history barrier owns the plan while it is up (S-MWB-3 B-328-5).
      if (historyGateRef.current) return;
      void autosaveFlush();
    });
    return unsubscribe;
  }, [autosaveEnabled, navigation, autosaveFlush]);

  // Server exercise-set identity: the joined row-id list. When this changes a
  // refetch (post-409, post-insert id adoption, or initial load) has brought in
  // a different set of persisted rows, so the local rows must re-baseline to it.
  const serverRowSignature = useMemo(
    () => (existingPlan?.exercises ?? []).map((e) => e.id).join(','),
    [existingPlan?.exercises],
  );

  // After we adopt server rows into local state we must ALSO re-anchor the
  // autosave hook's diff baseline to that adopted copy (otherwise the next diff
  // runs id-less-saved-baseline vs has-ids and re-inserts the row). The adopt
  // is a `setRows` (async state update), so we record the signature we are
  // adopting here and let a follow-up effect call `autosave.rebaseline()` once
  // the working copy actually reflects it.
  const pendingRebaselineSigRef = useRef<string | null>(null);
  const autosaveRebaseline = autosave.rebaseline;
  const autosaveRebaselineTo = autosave.rebaselineTo;
  const autosaveRebaselineToConflict = autosave.rebaselineToConflict;

  // Build the FULL server working copy (every server row, with its real
  // row_id). Used as the explicit diff baseline when the non-pending adoption
  // DROPS a resurrected-then-deleted row from the local rows (D-045): anchoring
  // the baseline to the full server truth makes the very next diff emit a
  // remove_exercise for the dropped row's now-known row_id, re-deleting it on
  // the server instead of letting the refetch resurrect it.
  const buildServerWorkingCopy = useCallback(
    (
      exercises: WorkoutPlanExercise[],
      // MWB-4 #237 R10 (P1): the diff baseline's meta. Defaults to the LOCAL
      // `name`/`type` (the D-045 non-replay drop path preserves the coach's
      // local meta edits), but the replay-adoption drop path passes the
      // refreshed SERVER meta so the inline rebaseline anchors to the same
      // server truth we fold into local state — otherwise a follow-up edit would
      // diff against stale baseline meta and emit a spurious plan_meta op.
      metaOverride?: WorkoutBuilderWorkingCopy['meta'],
    ): WorkoutBuilderWorkingCopy => ({
      meta: metaOverride ?? { name, type },
      rows: exercises.map((e) => ({
        rowId: e.id,
        exerciseExternalId: e.exercise_external_id,
        sets: e.sets,
        repsOrDurationSeconds: e.reps_or_duration_seconds,
        restSeconds: e.rest_seconds,
        weightLbs: e.weight_lbs,
        supersetGroupId: e.superset_group_id,
        notes: e.notes,
      })),
    }),
    [name, type],
  );

  // MWB-4 #237 R11 (P1): publish the server-truth re-anchor through the ref the
  // (earlier-declared) `onAutosaveConflict` reads. After the conflict refetch
  // resolves, the handler anchors the autosave diff baseline to the refetched
  // server copy via `autosave.rebaselineTo`, so the hook's subsequent rebase
  // diffs the coach's pending ops against authoritative server truth (never a
  // stale local baseline that would emit field-erasing full-row upserts). The
  // rebaseline refuses to run while a batch is in flight/queued.
  //
  // MWB-4 #237 R13 (D-002): the conflict-adoption anchor MUST use
  // `rebaselineToConflict`, NOT `rebaselineTo`. During the conflict await the
  // in-flight slot is already vacated by the failed send, but the coach may
  // have made an edit WHILE request A was in flight, leaving `pendingNextRef`
  // non-null. `rebaselineTo` refuses to run with a queued edit (it must never
  // discard a genuine pending edit), so it would SILENTLY NO-OP here and the
  // hook's subsequent rebase would diff the STALE baseline and re-clobber the
  // concurrent server field. `rebaselineToConflict` instead adopts server truth
  // AND re-derives the queued local delta on top of it, so the queued edit
  // survives and the concurrent server field is preserved.
  useEffect(() => {
    rebaselineToServerRef.current = (exercises: WorkoutPlanExercise[]) => {
      autosaveRebaselineToConflict(buildServerWorkingCopy(exercises));
    };
    return () => {
      rebaselineToServerRef.current = null;
    };
  }, [autosaveRebaselineToConflict, buildServerWorkingCopy]);

  // Adopt server rows when a refetch (post-409, post-insert id adoption, or
  // initial load) brings in fresh server rows WITH their ids.
  //
  // Two modes, chosen by `autosave.hasPending`:
  //   - NOT pending (no unsaved coach edit): a full replace from server truth.
  //     The server copy IS the truth, so we mirror it verbatim and record the
  //     adopted signature for the rebaseline below.
  //   - PENDING (the D-042 race: the coach edited the just-inserted row before
  //     this refetch resolved): a full replace would CLOBBER the coach's edit.
  //     Instead we MERGE only the server-assigned row_ids into the matching
  //     id-less local rows — preserving every locally-edited field and the
  //     local order. That way the coach's edit survives AND the next autosave
  //     names the adopted server row id (a single upsert WITH the id, never a
  //     duplicate id-less insert). We do NOT record a rebaseline signature in
  //     this mode: the pending batch still owns the delta, and the rebaseline
  //     effect's own guard would refuse mid-flight anyway.
  // `autosave.hasPending` stays in the dependency array so a refetch that
  // landed while a batch was pending is adopted the moment that batch clears.
  useEffect(() => {
    if (!autosaveEnabled) return;
    if (!existingPlan) return;
    const serverExercises = existingPlan.exercises;
    // Only adopt when there is a FRESH reason to: the very first time server
    // data arrives (initial load) OR a refetch WE triggered has advanced the
    // sequence. Re-running on every incidental render would let a stale
    // `existingPlan` clobber locally-saved-but-not-yet-refetched edits — the
    // exact regression the D-042 race exposes once an edit settles and the
    // post-flush render fires this effect again with `hasPending` back to
    // false.
    const hasFreshRefetch = refetchSeq !== adoptedRefetchSeqRef.current;
    if (initialLoadDoneRef.current && !hasFreshRefetch) return;

    if (!autosave.hasPending) {
      // MWB-4 #237 R10 (P1): on the REPLAY-adoption path, adopt the full server
      // truth — plan metadata as well as rows. A replayed `plan_meta` rename
      // lands on the server during the replay, but `name`/`type` were
      // initialised once from the pre-replay `existingPlan` (:178-181) and the
      // row-only adoption below never refreshes them, so the rebaseline anchors
      // to stale meta and the next explicit full-replace Save reverts the
      // rescued rename. We therefore fold the refreshed server `name`/`type`
      // into local state here so they ride into the working copy the rebaseline
      // re-anchors to. Scope: ONLY when this clean adoption is satisfying an
      // active replay gate whose forced refetch seq this render covers — a
      // normal (non-replay) refetch must NOT clobber unsaved local meta edits
      // the coach made after it was requested. (duration stays on the
      // explicit-Save path per the autosave-meta note at :319-324, so it is not
      // part of the streamed truth and is left untouched here.)
      const isReplayAdoption =
        replayAdoptionPendingRef.current &&
        refetchSeqRef.current >= replayRefetchSeqRef.current;
      if (isReplayAdoption) {
        setName(existingPlan.name ?? '');
        setType(existingPlan.type ?? 'strength');
      }
      // D-045 — delete-before-adoption guard. A server row is DROPPED from the
      // adopted local rows when it is the resurrection of a row the coach
      // deleted in the id-less insert/adoption window. We recognise it two
      // ways: (1) a server row_id we already mapped to a clientId now in
      // `deletedKeysRef`, or (2) a server row_id we have never seen whose
      // composite signature matches a row removed while still id-less
      // (`deletedSignaturesRef`). Matching consumes one entry per signature so
      // identical rows are dropped one-for-one. Kept rows are mapped verbatim
      // from server truth (the FULL replace); dropped rows are re-deleted by
      // the rebaselineTo below.
      const sigPool = new Map<string, string[]>();
      for (const [sig, list] of deletedSignaturesRef.current) {
        sigPool.set(sig, list.slice());
      }
      const keptExercises: WorkoutPlanExercise[] = [];
      const droppedRowIds: string[] = [];
      for (const e of serverExercises) {
        // (1) Known server row_id whose clientId was deleted.
        const mappedClientId = rowIdToClientIdRef.current.get(e.id);
        if (mappedClientId && deletedKeysRef.current.has(mappedClientId)) {
          droppedRowIds.push(e.id);
          continue;
        }
        // (2) Unseen server row_id matching a deleted id-less row by signature.
        if (!mappedClientId) {
          const sig = serverRowCompositeSignature(e);
          const pending = sigPool.get(sig);
          if (pending && pending.length > 0) {
            const clientId = pending.shift() as string;
            // Bind this server row_id to the deleted clientId so a later
            // refetch (before the remove lands) keeps recognising + dropping
            // it, and so the cleanup below can prune it once the server row
            // is gone.
            rowIdToClientIdRef.current.set(e.id, clientId);
            droppedRowIds.push(e.id);
            continue;
          }
        }
        keptExercises.push(e);
      }

      setRows(
        keptExercises.map((e) => ({
          clientId: clientIdForServerRow(e.id),
          row_id: e.id,
          exercise_external_id: e.exercise_external_id,
          display_name: e.exercise_external_id,
          sets: e.sets,
          reps_or_duration_seconds: e.reps_or_duration_seconds,
          rest_seconds: e.rest_seconds,
          weight_lbs: e.weight_lbs,
          superset_group_id: e.superset_group_id,
          notes: e.notes,
        })),
      );

      // Cleanup (D-045 step 6): prune any tracked-deleted clientId whose mapped
      // server row_id is no longer in server truth — the remove_exercise has
      // landed, so the intent is fulfilled and we must stop filtering (else a
      // later re-add of the same exercise could be wrongly dropped).
      const liveServerRowIds = new Set(serverExercises.map((e) => e.id));
      for (const [rowId, clientId] of rowIdToClientIdRef.current) {
        if (
          deletedKeysRef.current.has(clientId) &&
          !liveServerRowIds.has(rowId)
        ) {
          deletedKeysRef.current.delete(clientId);
          rowIdToClientIdRef.current.delete(rowId);
        }
      }

      if (droppedRowIds.length > 0) {
        // We dropped a resurrected-then-deleted row. Anchor the diff baseline to
        // the FULL server copy (which still holds those rows) so the next diff
        // emits a remove_exercise for each dropped row_id and re-deletes it on
        // the server. Do NOT set pendingRebaselineSigRef here: that path would
        // re-anchor to the (filtered) local copy and erase the pending delete.
        // MWB-4 #237 R10 (P1): on the replay-adoption path we just folded the
        // refreshed server `name`/`type` into local state, so anchor the inline
        // baseline to the SAME server meta (not the stale local closure values,
        // which setState has not yet updated this render).
        autosaveRebaselineTo(
          buildServerWorkingCopy(
            serverExercises,
            isReplayAdoption
              ? {
                  name: existingPlan.name ?? '',
                  type: existingPlan.type ?? 'strength',
                }
              : undefined,
          ),
        );
        pendingRebaselineSigRef.current = null;
        // R9 P1: this drop path reanchors the baseline INLINE (no follow-up
        // rebaseline effect, since the signature is cleared). Mark the replay's
        // refetch as adopted-and-reanchored if this adoption covers it; the
        // dedicated clearing effect below releases the gate once the replay is
        // also no longer in flight.
        if (refetchSeqRef.current >= replayRefetchSeqRef.current) {
          replayAdoptionAdoptedRef.current = true;
        }
      } else {
        // Clean full replace (no outstanding delete): re-anchor to the adopted
        // copy once `workingCopy` reflects it, exactly as before.
        pendingRebaselineSigRef.current = serverRowSignature;
      }
      // A full replace fully reconciles to server truth, so any outstanding
      // merge request is satisfied; record the load + adopted sequence.
      initialLoadDoneRef.current = true;
      adoptedRefetchSeqRef.current = refetchSeqRef.current;
      return;
    }
    // Pending AND a fresh refetch we triggered is outstanding: this is the
    // D-042 race — the coach edited the just-inserted row before the post-save
    // refetch resolved. We must NOT clobber that edit, so we MERGE only the
    // server-assigned row ids (preserving every edited field and local order).
    // Build a FIFO pool of server row ids per external id, then consume
    // already-adopted ids first so we never assign one twice, and hand the
    // remaining ids to id-less local rows that match by external id. Order and
    // all edited fields are taken from the LOCAL row.
    setRows((cur) => {
      const idsByExternal = new Map<string, string[]>();
      for (const e of serverExercises) {
        const list = idsByExternal.get(e.exercise_external_id) ?? [];
        list.push(e.id);
        idsByExternal.set(e.exercise_external_id, list);
      }
      // Reserve ids already held by local rows so they are not re-handed out.
      for (const r of cur) {
        if (r.row_id === undefined) continue;
        const list = idsByExternal.get(r.exercise_external_id);
        if (!list) continue;
        const at = list.indexOf(r.row_id);
        if (at !== -1) list.splice(at, 1);
      }
      let mutated = false;
      const merged = cur.map((r) => {
        if (r.row_id !== undefined) return r;
        const list = idsByExternal.get(r.exercise_external_id);
        if (!list || list.length === 0) return r;
        const adoptedId = list.shift() as string;
        mutated = true;
        // Bind the adopted server row_id to this row's stable clientId so the
        // D-045 delete-tracking + cleanup can recognise it on a later refetch.
        rowIdToClientIdRef.current.set(adoptedId, r.clientId);
        return { ...r, row_id: adoptedId };
      });
      // Return the SAME reference when nothing changed so we never spin an
      // extra render / re-arm the debounce on a no-op adoption.
      if (!mutated) return cur;
      return merged;
    });
    // Record the adopted server signature so the rebaseline effect re-anchors
    // the autosave diff baseline to the merged copy once the coach's pending
    // batch clears. Without this the baseline stays at the id-LESS insert
    // snapshot, so a follow-up delete of the merged row has no row_id to name
    // (silent skip) and a follow-up reorder cannot reference it.
    pendingRebaselineSigRef.current = serverRowSignature;
    // The outstanding refetch has now been folded in; record it so a later
    // incidental render does not re-merge.
    initialLoadDoneRef.current = true;
    adoptedRefetchSeqRef.current = refetchSeq;
  }, [
    autosaveEnabled,
    autosave.hasPending,
    existingPlan,
    serverRowSignature,
    refetchSeq,
    clientIdForServerRow,
    autosaveRebaselineTo,
    buildServerWorkingCopy,
  ]);

  // The current local row-id signature, derived from the working copy the hook
  // diffs over. Equals `serverRowSignature` only once the `setRows` adoption
  // above has flushed into state.
  const localRowSignature = useMemo(
    () => workingCopy.rows.map((r) => r.rowId ?? '').join(','),
    [workingCopy.rows],
  );

  // Once the adopted server rows are actually in the working copy AND nothing
  // is pending, re-anchor the autosave diff baseline to that copy. This is the
  // P1 fix: it makes the server's truth (with real row ids) the new "last
  // saved" baseline, so a follow-up edit of a just-inserted row emits a single
  // upsert WITH its row_id (not a duplicate insert), a delete emits
  // remove_exercise, and a reorder names the adopted id. The hook's own guard
  // also refuses to re-anchor mid-flight, so a coach editing during adoption
  // keeps their pending ops.
  //
  // NOTE on the gate: phase-1 above only ran because `hasPending` was false, so
  // the rows we adopted were NOT racing a coach edit. Folding those server rows
  // into the working copy is itself a diff (id-less row -> row-with-id), which
  // now (D-042) flips the hook's dirty signal and therefore `hasPending` true.
  // We must NOT block on `hasPending` here or the baseline could never advance
  // and the row id would never be adopted. Instead we rely on (a) the adopted
  // signature being in place (`pendingRebaselineSigRef === localRowSignature`)
  // and (b) `autosave.rebaseline()`'s OWN internal guard, which refuses to run
  // while a real batch is in flight or queued. That keeps a genuine coach edit
  // made during the refetch window safe (it lands in the queue, rebaseline
  // no-ops) while still letting the pure-adoption case re-anchor.
  useEffect(() => {
    if (!autosaveEnabled) return;
    if (pendingRebaselineSigRef.current === null) return;
    if (pendingRebaselineSigRef.current !== localRowSignature) return;
    pendingRebaselineSigRef.current = null;
    autosaveRebaseline();
    // R9 P1: the baseline has now reanchored to the adopted server truth. If
    // this adoption covers the replay's refetch seq, mark it adopted-and-
    // reanchored; the clearing effect below releases the replay gate once the
    // replay is also no longer in flight.
    if (refetchSeqRef.current >= replayRefetchSeqRef.current) {
      replayAdoptionAdoptedRef.current = true;
    }
  }, [autosaveEnabled, autosave.hasPending, localRowSignature, autosaveRebaseline]);

  // R9 P1: release the replay adoption gate once BOTH (a) the replay-driven
  // refetch has been adopted into `rows` and the baseline reanchored
  // (`replayAdoptionAdoptedRef`, set by whichever adoption path ran) AND (b) the
  // replay is no longer in flight (the hook clears `replayInFlight` at the
  // terminal 200/409/reject). Splitting the clear into this effect decouples it
  // from the ordering of adoption vs. the replay settling: whichever lands last
  // triggers this re-run and the gate drops exactly once both hold.
  //
  // R10 P1: a refetch HARD-FAILURE no longer clears the gate — it keeps the gate
  // raised and sets `replayRefetchFailed` so the pill surfaces a recoverable
  // refresh affordance (Save stays blocked, never reopening a stale full-replace
  // window). A successful retry runs the adoption that sets
  // `replayAdoptionAdoptedRef`, so the gate releases here exactly as on a
  // first-try success.
  useEffect(() => {
    if (!replayAdoptionPending) return;
    if (!replayAdoptionAdoptedRef.current) return;
    if (autosave.replayInFlight) return;
    setReplayAdoptionPendingFlag(false);
  }, [replayAdoptionPending, autosave.replayInFlight, localRowSignature, setReplayAdoptionPendingFlag]);

  // Block explicit Save while a mirrored batch is being replayed on mount
  // (MWB-4 #237 R6 P1) AND through the adoption of the refreshed server truth
  // that the replay drives (R9 P1). Explicit Save sends a full-replace built
  // from the current `rows`; if it fired before the replay settled OR before the
  // forced refetch was folded into `rows` and the autosave baseline reanchored,
  // it would replace the just-rescued server edit with the stale pre-refetch
  // rows and silently revert the rescue.
  //
  // GATE LIFECYCLE (post-R9):
  //   - `replayInFlight` holds from replay start to the terminal network outcome
  //     (200 / 409 / hard reject) — the in-flight leg.
  //   - `replayAdoptionPending` extends the hold PAST that terminal outcome:
  //     raised in `onAutosaveReplay`, it stays set until the post-replay refetch
  //     has DELIVERED, been adopted into `rows`, and the baseline has reanchored
  //     (cleared in the effect above).
  //   - `replayRefetchFailed` (R10 P1) holds the gate when the forced refetch
  //     hard-fails: rather than clearing into a stale full-replace Save, Save
  //     stays blocked and the pill surfaces a recoverable "tap to refresh"
  //     affordance whose tap re-runs the refetch. A later success adopts truth
  //     and releases the gate. A remount re-raises the pending gate from the
  //     mirror. The Refresh affordance guarantees Save is never locked forever.
  // Together they span: replay detection -> terminal outcome -> adoption ->
  // baseline reanchor, exactly the window in which a full-replace Save is unsafe.
  // AUDIT-07-125: never send a full-replace Save for a plan that has not
  // loaded yet; its exercise list would be empty and erase the saved one.
  const canSave =
    name.trim().length > 0 &&
    !planLoading &&
    !editorLocked &&
    !autosave.replayInFlight &&
    !replayAdoptionPending &&
    !replayRefetchFailed &&
    !createMut.isPending &&
    !updateMut.isPending &&
    !setExercisesMut.isPending;

  const onSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const durationParsed = duration.trim() ? parseInt(duration.trim(), 10) : undefined;
    const cleanDuration =
      typeof durationParsed === 'number' &&
      Number.isFinite(durationParsed) &&
      durationParsed > 0
        ? durationParsed
        : undefined;

    try {
      let resolvedPlanId = planId;
      if (isEditing && planId) {
        await updateMut.mutateAsync({
          planId,
          input: {
            name: trimmedName,
            type,
            duration_estimate_minutes: cleanDuration,
          },
        });
      } else {
        const created = await createMut.mutateAsync({
          name: trimmedName,
          type,
          duration_estimate_minutes: cleanDuration,
        });
        resolvedPlanId = created.id;
      }

      if (resolvedPlanId) {
        // MWB-4 #237 R14 (D-001): the fuller payload (incl. weight_lbs +
        // superset_group_id) is gated on `featureFlags.mwbAutosave`. With the
        // flag ON it round-trips those fields so an explicit Save does not erase
        // server-preserved values the coach never re-entered (R11 P1). With the
        // flag OFF the body is byte-identical to the legacy base-branch shape.
        // We pass the raw flag (not the composite `autosaveEnabled`, which also
        // requires isEditing + planId) so a freshly created plan saved under the
        // flag still gets the fuller, parity-correct payload.
        const payload: UpsertExerciseRowInput[] = buildSetExercisesPayload(
          rows,
          featureFlags.mwbAutosave,
        );
        await setExercisesMut.mutateAsync({
          planId: resolvedPlanId,
          rows: payload,
        });
      }
      Alert.alert('Plan saved', 'Workout plan saved successfully.');
      navigation.goBack();
    } catch (err) {
      Alert.alert(
        'Could not save plan',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  }, [
    createMut,
    duration,
    isEditing,
    name,
    navigation,
    planId,
    rows,
    setExercisesMut,
    type,
    updateMut,
  ]);

  // MWB-4 #237 R10 (P1): the status pill renders the hook's own `autosave.status`
  // EXCEPT when the replay's forced refetch has hard-failed — then we render the
  // recoverable 'conflict' state ("Edited elsewhere — tap to refresh") so the
  // coach has a visible, calm path out while Save stays blocked. The hook's
  // status does not model a refetch failure (it tracks the send lifecycle), so
  // the screen owns this overlay. When the failed state is active the pill's tap
  // re-runs the refetch (`runReplayRefetch`); otherwise it retries the flush as
  // before.
  // Adopt a server head the history request produced (or found), then fold
  // the matching server copy into the screen. The order is the B-328-5 fix:
  // the hook adopts first, and the screen state changes ONLY when the hook
  // accepted it, so a refused adoption can never overwrite live edits.
  const settleHistoryHead = useCallback(
    async (args: {
      direction: HistoryDirection;
      head: number;
      lockToken: string;
      expectedHead: number;
      outcome: HistoryOutcome;
    }): Promise<void> => {
      const fresh = await refetchPlan().catch(() => null);
      const plan = fresh && !fresh.isError ? fresh.data : undefined;
      if (!plan) {
        // The server moved but its copy did not load: stay read-only and offer
        // Check again (the same refetch).
        setHistoryGate({ phase: 'reload', ...args });
        setHistoryNotice(
          args.outcome === 'applied'
            ? HISTORY_REFRESH_FAILED
            : 'This workout was changed in another session, and the latest version did not load. Editing is paused so nothing is lost. Check your connection, then tap Check again.',
        );
        return;
      }
      const meta = { name: plan.name ?? '', type: plan.type ?? 'strength' };
      const adopted = autosave.adoptServerHead({
        headRevisionIndex: args.head,
        lockToken: args.lockToken,
        serverCopy: buildServerWorkingCopy(plan.exercises, meta),
      });
      if (!adopted) {
        // A save is still in flight or queued. Leave the screen as it is and
        // let the replay-adoption path fold server truth in once it settles.
        runReplayRefetch();
        setHistoryNotice(
          'The change went through on the server. The latest saved version loads as soon as your last edit finishes saving.',
        );
        setHistoryGate(null);
        return;
      }
      if (args.outcome === 'applied') {
        // The head this request left becomes the opposite step's target.
        if (args.direction === 'undo') {
          setUndoStack(undoStackRef.current.slice(0, -1));
          setRedoStack([...redoStackRef.current, args.expectedHead]);
        } else {
          setRedoStack(redoStackRef.current.slice(0, -1));
          setUndoStack([...undoStackRef.current, args.expectedHead]);
        }
      } else {
        // Another session moved the plan: the session history no longer
        // describes it.
        setUndoStack([]);
        setRedoStack([]);
      }
      deletedKeysRef.current.clear();
      deletedSignaturesRef.current.clear();
      setName(meta.name);
      setType(meta.type);
      setRows(
        plan.exercises.map((e) => ({
          clientId: clientIdForServerRow(e.id),
          row_id: e.id,
          exercise_external_id: e.exercise_external_id,
          display_name: e.exercise_external_id,
          sets: e.sets,
          reps_or_duration_seconds: e.reps_or_duration_seconds,
          rest_seconds: e.rest_seconds,
          weight_lbs: e.weight_lbs,
          superset_group_id: e.superset_group_id,
          notes: e.notes,
        })),
      );
      setHistoryNotice(
        args.outcome === 'elsewhere'
          ? HISTORY_EDITED_ELSEWHERE
          : args.direction === 'undo'
            ? HISTORY_CONFIRMED_UNDO
            : HISTORY_CONFIRMED_REDO,
      );
      setHistoryGate(null);
    },
    [
      refetchPlan,
      autosave,
      buildServerWorkingCopy,
      runReplayRefetch,
      setHistoryGate,
      setUndoStack,
      setRedoStack,
      clientIdForServerRow,
    ],
  );

  // Send one fenced history request and resolve its outcome. `isRetry` marks a
  // Check again after an unknown outcome: there a 409 `undo_head_moved` whose
  // head is exactly one step ahead means the earlier request landed.
  const sendHistoryRequest = useCallback(
    async (args: {
      direction: HistoryDirection;
      target: number;
      expectedHead: number;
      isRetry: boolean;
    }): Promise<void> => {
      if (!planId) return;
      const { direction, target, expectedHead, isRetry } = args;
      let res: { head_revision_index: number; lock_token: string };
      try {
        res = await workoutAutosaveApi.undo(planId, {
          to_revision_index: target,
          expected_head_index: expectedHead,
        });
      } catch (err) {
        if (err instanceof WorkoutAutosaveApiError && err.headMoved) {
          const moved = err.headMoved;
          await settleHistoryHead({
            direction,
            head: moved.head_revision_index,
            lockToken: moved.lock_token,
            expectedHead,
            outcome:
              isRetry && moved.head_revision_index === expectedHead + 1
                ? 'applied'
                : 'elsewhere',
          });
          return;
        }
        // B-356-2: on Check again the earlier request may have landed, so
        // only a 200 or a parsed head-moved answer settles it. Any refusal of
        // the retry keeps editing paused; it says nothing about the first.
        if (isRetry || isUnknownHistoryOutcome(err)) {
          setHistoryGate({ phase: 'unconfirmed', direction, target, expectedHead });
          setHistoryNotice(describeUnconfirmedHistory(err, direction).message);
          return;
        }
        const f = describeHistoryFailure(err, direction);
        setHistoryNotice(f.message);
        if (f.dropHistory) {
          if (direction === 'undo') setUndoStack([]);
          else setRedoStack([]);
        }
        setHistoryGate(null);
        return;
      }
      await settleHistoryHead({
        direction,
        head: res.head_revision_index,
        lockToken: res.lock_token,
        expectedHead,
        outcome: 'applied',
      });
    },
    [planId, settleHistoryHead, setHistoryGate, setUndoStack, setRedoStack],
  );

  const runHistoryStep = useCallback(
    async (direction: HistoryDirection) => {
      if (!autosaveEnabled || !planId || historyGateRef.current) return;
      // Raise the barrier BEFORE the flush (B-328-5): from here on nothing the
      // coach does can change the working copy until the outcome is known.
      setHistoryGate({ phase: 'running' });
      setHistoryNotice(null);
      let sent: { target: number; expectedHead: number } | null = null;
      try {
        // Land any buffered edit first so the undo never discards it (that
        // save becomes the newest undo step, read below from the ref).
        await autosave.flush();
        if (autosaveHasPendingRef.current) {
          setHistoryNotice(HISTORY_WAIT_FOR_SAVE);
          return;
        }
        const stack = direction === 'undo' ? undoStackRef.current : redoStackRef.current;
        const target = stack[stack.length - 1];
        if (target === undefined) return;
        sent = { target, expectedHead: autosave.readHead().index };
        await sendHistoryRequest({ direction, ...sent, isRetry: false });
      } catch (err) {
        if (sent) {
          // The request may have landed: keep the barrier and offer Check again.
          setHistoryGate({ phase: 'unconfirmed', direction, ...sent });
          setHistoryNotice(describeUnconfirmedHistory(err, direction).message);
        } else {
          setHistoryNotice(describeHistoryFailure(err, direction).message);
        }
      } finally {
        // Read the ref through a helper: the entry guard narrowed
        // `historyGateRef.current` to null, but the awaits above moved it.
        if (historyGatePhase(historyGateRef) === 'running') setHistoryGate(null);
      }
    },
    [autosaveEnabled, planId, autosave, sendHistoryRequest, setHistoryGate],
  );

  // Check again: resolve an unknown outcome with the SAME fence (never a fresh
  // restore), or retry loading the copy of a head that already moved.
  const checkHistoryAgain = useCallback(async () => {
    const gate = historyGateRef.current;
    if (!gate || gate.phase === 'running') return;
    setHistoryGate({ phase: 'running' });
    try {
      if (gate.phase === 'unconfirmed') {
        await sendHistoryRequest({
          direction: gate.direction,
          target: gate.target,
          expectedHead: gate.expectedHead,
          isRetry: true,
        });
      } else {
        await settleHistoryHead({
          direction: gate.direction,
          head: gate.head,
          lockToken: gate.lockToken,
          expectedHead: gate.expectedHead,
          outcome: gate.outcome,
        });
      }
    } catch (err) {
      setHistoryNotice(describeUnconfirmedHistory(err, gate.direction).message);
      setHistoryGate(gate);
    } finally {
      if (historyGateRef.current?.phase === 'running') setHistoryGate(gate);
    }
  }, [sendHistoryRequest, settleHistoryHead, setHistoryGate]);

  // AIB-5 Ask AI: flush edits before a proposal. After apply adopt the AWAITED fresh plan (never the cached copy): a head token lets the header
  // Undo revert it; without one (b#809: plan id only) the fresh copy is the baseline and history resets. A failed read uses the refresh path.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiToast, setAiToast] = useState<{ text: string; undo: boolean } | null>(null);
  const aiPrepare = useCallback(async () => {
    if (!autosaveEnabled || historyGateRef.current) return { ok: false };
    await autosave.flush();
    if (autosaveHasPendingRef.current) return { ok: false };
    const token = autosave.readHead().lockToken;
    return { ok: true, lockToken: token && token !== AUTOSAVE_BOOTSTRAP_LOCK_TOKEN ? token : undefined };
  }, [autosaveEnabled, autosave]);
  const aiOnApplied = useCallback(
    async (ref: AiBuilderRef, count: number) => {
      const before = autosave.readHead().index;
      const [token, head] = [ref?.lock_token, ref?.revision_index];
      const fresh = await refetchPlan().catch(() => null);
      const plan = fresh && !fresh.isError ? fresh.data : undefined;
      const meta = { name: plan?.name ?? '', type: plan?.type ?? 'strength' };
      const serverCopy = plan ? buildServerWorkingCopy(plan.exercises, meta) : null;
      const adopted = !!serverCopy && !!token && head !== undefined && autosave.adoptServerHead({ headRevisionIndex: head, lockToken: token, serverCopy });
      setAiToast({ text: appliedToast(count), undo: adopted });
      if (!plan || !serverCopy) return runReplayRefetch();
      if (!adopted) autosave.rebaselineTo(serverCopy);
      setUndoStack(adopted ? [...undoStackRef.current, before] : []);
      setRedoStack([]);
      deletedKeysRef.current.clear();
      deletedSignaturesRef.current.clear();
      setName(meta.name);
      setType(meta.type);
      setRows(plan.exercises.map((e) => ({ clientId: clientIdForServerRow(e.id), row_id: e.id, exercise_external_id: e.exercise_external_id, display_name: e.exercise_external_id,
        sets: e.sets, reps_or_duration_seconds: e.reps_or_duration_seconds, rest_seconds: e.rest_seconds, weight_lbs: e.weight_lbs, superset_group_id: e.superset_group_id, notes: e.notes })));
    },
    [autosave, refetchPlan, buildServerWorkingCopy, runReplayRefetch, setUndoStack, setRedoStack, clientIdForServerRow],
  );
  const ai = useAiBuilder({ planId, isBlank: rows.length === 0, prepare: aiPrepare, onApplied: aiOnApplied });
  useEffect(() => {
    const t = aiToast ? setTimeout(() => setAiToast(null), 10_000) : undefined;
    return () => clearTimeout(t);
  }, [aiToast]);
  const openAi = useCallback(() => {
    if (!autosaveEnabled) return;
    fireAiHaptic('light');
    setAiOpen(true);
  }, [autosaveEnabled]);

  const historyBlocked =
    editorLocked ||
    autosave.replayInFlight ||
    replayAdoptionPending ||
    replayRefetchFailed;
  // AIB-6: revision history sheet. Shown with Ask AI: the status and revisions routes ship together (b#808).
  const [revisionsOpen, setRevisionsOpen] = useState(false);

  const pillStatus = replayRefetchFailed ? 'conflict' : autosave.status;
  const onPillPress = useCallback(() => {
    if (historyGateRef.current) return;
    if (replayRefetchFailedRef.current) {
      runReplayRefetch();
      return;
    }
    void autosave.flush();
  }, [runReplayRefetch, autosave]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={[typography.h2, { color: sc.textPrimary }]}>
            {isEditing ? 'Edit workout plan' : 'New workout plan'}
          </Text>
          {/* Save-state pill: only when autosave is active. Flag-off (or a
              brand-new plan) renders NOTHING here — zero UI residue. Tapping a
              recoverable (offline/conflict) pill retries the flush now. */}
          {autosaveEnabled ? (
            <AutosaveStatusPill
              testID="mwb-autosave-pill"
              status={pillStatus}
              lastSavedAt={autosave.lastSavedAt}
              mirrorDegraded={autosave.mirrorDegraded}
              refused={!!autosave.refusal}
              onPress={onPillPress}
            />
          ) : null}
          {ai.visible && autosaveEnabled ? (
            <Pressable testID="ai-header-button" accessibilityRole="button" accessibilityLabel="Ask AI to change this workout" onPress={openAi} style={styles.historyButton}>
              <Text style={[typography.caption, { color: sc.textPrimary }]}>Ask AI</Text>
            </Pressable>
          ) : null}
        </View>
        {autosaveEnabled ? (
          <View style={styles.historyRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Undo last change"
              accessibilityState={{ disabled: historyBlocked || undoStack.length === 0 }}
              disabled={historyBlocked || undoStack.length === 0}
              onPress={() => void runHistoryStep('undo')}
              style={[
                styles.historyButton,
                (historyBlocked || undoStack.length === 0) && styles.historyButtonDisabled,
              ]}
            >
              <Text style={[typography.caption, { color: sc.textPrimary }]}>
                {historyBusy ? 'Working' : 'Undo'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Redo change"
              accessibilityState={{ disabled: historyBlocked || redoStack.length === 0 }}
              disabled={historyBlocked || redoStack.length === 0}
              onPress={() => void runHistoryStep('redo')}
              style={[
                styles.historyButton,
                (historyBlocked || redoStack.length === 0) && styles.historyButtonDisabled,
              ]}
            >
              <Text style={[typography.caption, { color: sc.textPrimary }]}>Redo</Text>
            </Pressable>
            {ai.visible && planId ? (
              <Pressable
                testID="revision-history-button"
                accessibilityRole="button"
                accessibilityLabel="Show the history of this workout"
                onPress={() => {
                  fireAiHaptic('light');
                  setRevisionsOpen(true);
                }}
                style={styles.historyButton}
              >
                <Text style={[typography.caption, { color: sc.textPrimary }]}>History</Text>
              </Pressable>
            ) : null}
            {revisionsOpen && planId ? (
              <RevisionHistorySheet planId={planId} onClose={() => setRevisionsOpen(false)} sc={sc} />
            ) : null}
          </View>
        ) : null}
        {autosaveEnabled && autosave.refusal ? (
          <Text
            testID="mwb-autosave-refusal"
            accessibilityLiveRegion="polite"
            style={[typography.caption, { color: sc.textMuted, marginBottom: spacing.xs }]}
          >
            {describeAutosaveRefusal(autosave.refusal)}
          </Text>
        ) : null}
        {autosaveEnabled && historyNotice ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.caption, { color: sc.textMuted, marginBottom: spacing.xs }]}
          >
            {historyNotice}
          </Text>
        ) : null}
        {autosaveEnabled &&
        (historyGate?.phase === 'unconfirmed' || historyGate?.phase === 'reload') ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check again"
            onPress={() => void checkHistoryAgain()}
            style={[styles.historyButton, { alignSelf: 'flex-start', marginBottom: spacing.xs }]}
          >
            <Text style={[typography.caption, { color: sc.textPrimary }]}>Check again</Text>
          </Pressable>
        ) : null}

        {planLoading ? (
          <View testID="mwb-plan-loading" accessibilityLiveRegion="polite">
            <Text style={[typography.body, { color: sc.textMuted }]}>
              {planLoadFailed
                ? 'This workout plan could not be loaded. Check your connection and try again.'
                : 'Loading workout plan'}
            </Text>
            {planLoadFailed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading the workout plan again"
                onPress={() => void refetchPlan()}
                style={styles.historyButton}
              >
                <Text style={[typography.caption, { color: sc.textPrimary }]}>
                  Try again
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Plan name
        </Text>
        <TextInput
          accessibilityLabel="Plan name"
          value={name}
          onChangeText={(next) => {
            metaTouchedRef.current = true;
            setName(next);
          }}
          editable={!editorLocked}
          placeholder="e.g. Push day A"
          placeholderTextColor={sc.textMuted}
          style={styles.input}
          maxLength={120}
        />

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Type
        </Text>
        <View style={styles.typeRow}>
          {WORKOUT_TYPES.map((t) => (
            <Pressable
              key={t}
              accessibilityRole="button"
              accessibilityState={{ disabled: editorLocked, selected: type === t }}
              disabled={editorLocked}
              onPress={() => {
                metaTouchedRef.current = true;
                setType(t);
              }}
              style={[
                styles.typeChip,
                { borderColor: sc.textMuted },
                type === t && { backgroundColor: sc.accent, borderColor: sc.accent },
              ]}
            >
              <Text
                style={[
                  typography.body,
                  { color: type === t ? sc.bgPrimary : sc.textPrimary },
                ]}
              >
                {t}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Estimated duration (minutes, optional)
        </Text>
        <TextInput
          accessibilityLabel="Estimated duration in minutes"
          value={duration}
          onChangeText={(next) => {
            metaTouchedRef.current = true;
            setDuration(next);
          }}
          editable={!editorLocked}
          keyboardType="number-pad"
          placeholder="45"
          placeholderTextColor={sc.textMuted}
          style={styles.input}
          maxLength={4}
        />

        <Text style={[typography.h3, styles.sectionHeading, { color: sc.textPrimary }]}>
          Exercises
        </Text>

        {rows.length === 0 ? (
          <Text style={[typography.body, { color: sc.textMuted }]}>
            No exercises yet. Search below to add some.
          </Text>
        ) : (
          rows.map((row, idx) => (
            <View
              key={`${row.exercise_external_id}-${idx}`}
              style={[styles.rowCard, { borderColor: sc.border }]}
            >
              <View style={styles.rowHeader}>
                <CoachExerciseName
                  id={row.exercise_external_id}
                  fallback={row.display_name}
                  prefix={`${idx + 1}. `}
                  style={[typography.body, { color: sc.textPrimary, flex: 1 }]}
                />
                <View style={styles.rowControls}>
                  <Pressable
                    accessibilityLabel="Move exercise up"
                    onPress={() => moveRow(idx, -1)}
                    disabled={editorLocked || idx === 0}
                    style={styles.controlBtn}
                  >
                    <Text style={[typography.body, { color: sc.textPrimary }]}>
                      Up
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Move exercise down"
                    onPress={() => moveRow(idx, 1)}
                    disabled={editorLocked || idx === rows.length - 1}
                    style={styles.controlBtn}
                  >
                    <Text style={[typography.body, { color: sc.textPrimary }]}>
                      Down
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Remove exercise"
                    accessibilityState={{ disabled: editorLocked }}
                    disabled={editorLocked}
                    onPress={() => removeRow(idx)}
                    style={styles.controlBtn}
                  >
                    <Text style={[typography.body, { color: sc.textMuted }]}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.rowInputs}>
                <NumberField
                  label="Sets"
                  editable={!editorLocked}
                  value={row.sets}
                  onChange={(v) => updateRow(idx, { sets: v })}
                  sc={sc}
                />
                <NumberField
                  label="Reps / sec"
                  editable={!editorLocked}
                  value={row.reps_or_duration_seconds}
                  onChange={(v) => updateRow(idx, { reps_or_duration_seconds: v })}
                  sc={sc}
                />
                <NumberField
                  label="Rest (s)"
                  editable={!editorLocked}
                  value={row.rest_seconds ?? 0}
                  onChange={(v) => updateRow(idx, { rest_seconds: v })}
                  sc={sc}
                />
              </View>
            </View>
          ))
        )}

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Add exercise (search)
        </Text>
        <TextInput
          accessibilityLabel="Search exercise catalog"
          value={search}
          onChangeText={setSearch}
          editable={!editorLocked}
          placeholder="bench press, squat, ..."
          placeholderTextColor={sc.textMuted}
          style={styles.input}
        />
        {searchEnabled && searchResult?.items?.length ? (
          <View style={styles.searchResults}>
            {searchResult.items.map((ex) => (
              <Pressable
                key={ex.id}
                accessibilityRole="button"
                disabled={editorLocked}
                onPress={() => addExercise(ex)}
                style={[styles.searchHit, { borderColor: sc.border }]}
              >
                <Text style={[typography.body, { color: sc.textPrimary }]}>
                  {ex.name}
                </Text>
                {ex.bodyPart ? (
                  <Text style={[typography.caption, { color: sc.textMuted }]}>
                    {ex.bodyPart}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'Save changes' : 'Create plan'}
          disabled={!canSave}
          onPress={() => {
            void onSave();
          }}
          style={[
            styles.saveBtn,
            { backgroundColor: canSave ? sc.accent : sc.border },
          ]}
        >
          <Text style={[typography.h4, { color: sc.bgPrimary }]}>
            {createMut.isPending || updateMut.isPending || setExercisesMut.isPending
              ? 'Saving...'
              : isEditing
                ? 'Save changes'
                : 'Create plan'}
          </Text>
        </Pressable>
      </ScrollView>
      {aiToast ? (
        <View testID="ai-applied-toast" accessibilityLiveRegion="polite" style={styles.aiBar}>
          <Text style={[typography.body, { color: sc.textPrimary, flex: 1 }]}>{aiToast.text}</Text>
          {aiToast.undo ? (
            <Pressable testID="ai-toast-undo" accessibilityRole="button" accessibilityLabel="Undo the AI change" disabled={historyBlocked}
              onPress={() => { fireAiHaptic('medium'); setAiToast(null); void runHistoryStep('undo'); }} style={styles.historyButton}>
              <Text style={[typography.caption, { color: sc.textPrimary }]}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : ai.visible && (autosaveEnabled || !isEditing) ? (
        <Pressable testID="ai-prompt-bar" accessibilityRole="button" accessibilityLabel={autosaveEnabled ? 'Ask AI to change this workout' : SAVE_FIRST_COPY}
          accessibilityState={{ disabled: !autosaveEnabled }} disabled={!autosaveEnabled} onPress={openAi} style={styles.aiBar}>
          <Text style={[typography.body, { color: sc.textMuted }]}>
            {!autosaveEnabled ? SAVE_FIRST_COPY : rows.length === 0 ? 'Describe the workout to build' : 'Ask AI to change this workout'}
          </Text>
        </Pressable>
      ) : null}
      <AiBuilderSheet open={aiOpen} onClose={() => setAiOpen(false)} ai={ai} isBlank={rows.length === 0} sc={sc} />
    </KeyboardAvoidingView>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  sc: SemanticTokens;
  editable?: boolean;
}) {
  const { label, value, onChange, sc, editable = true } = props;
  return (
    <View style={{ flex: 1 }}>
      <Text style={[typography.caption, { color: sc.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={String(value)}
        editable={editable}
        onChangeText={(t) => {
          const parsed = parseInt(t.replace(/[^0-9]/g, ''), 10);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        keyboardType="number-pad"
        style={{
          borderWidth: 1,
          borderColor: sc.border,
          borderRadius: 6,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          color: sc.textPrimary,
          marginRight: spacing.xs,
        }}
        maxLength={4}
      />
    </View>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: { padding: spacing.lg, paddingBottom: spacing["2xl"] },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    label: { marginTop: spacing.md, marginBottom: spacing.xs },
    historyRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
    aiBar: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, marginHorizontal: spacing.lg, marginBottom: spacing.md,
      paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: 14, borderColor: sc.border, backgroundColor: sc.bgSurface,
    },
    historyButton: {
      minHeight: 44,
      minWidth: 64,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: sc.border,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyButtonDisabled: { opacity: 0.5 },
    input: {
      borderWidth: 1,
      borderColor: sc.border,
      borderRadius: 8,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: sc.textPrimary,
    },
    typeRow: { flexDirection: 'row', gap: spacing.sm },
    typeChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    sectionHeading: { marginTop: spacing.xl, marginBottom: spacing.sm },
    rowCard: {
      borderWidth: 1,
      borderRadius: 10,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    rowHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    rowControls: { flexDirection: 'row', gap: spacing.sm },
    controlBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    rowInputs: { flexDirection: 'row', gap: spacing.sm },
    searchResults: { marginTop: spacing.sm },
    searchHit: {
      borderWidth: 1,
      borderRadius: 8,
      padding: spacing.sm,
      marginBottom: spacing.xs,
    },
    saveBtn: {
      marginTop: spacing.xl,
      borderRadius: 12,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
  });
}
