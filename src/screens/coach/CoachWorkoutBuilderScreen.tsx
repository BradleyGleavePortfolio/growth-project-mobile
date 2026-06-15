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
  AccessibilityInfo,
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
  actionForAddExercise,
  actionForEditExerciseField,
  actionForEditPlan,
  actionForRemoveExercise,
  actionForReorderExercise,
  useCreateWorkoutPlan,
  useSetWorkoutExercises,
  useUpdateWorkoutPlan,
  useWorkoutPlan,
} from '../../hooks/useWorkoutBuilder';
import {
  useBuilderCommandStack,
  CommandNoOpError,
  isCommandNoOpError,
  type BuilderAction,
  type CommandRowSnapshot,
  type InverseOp,
} from '../../hooks/useBuilderCommandStack';
import { useCanonicalDeleteSet } from '../../hooks/useCanonicalDeleteSet';
import { useExerciseSearch } from '../../hooks/useExerciseLibrary';
import { track } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import { spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import { useAutosave } from '../../hooks/useAutosave';
import { generateClientId } from '../../utils/clientId';
import AutosaveStatusPill from '../../components/workout/AutosaveStatusPill';
import UndoButton from '../../components/coach/workout-builder/UndoButton';
import { romanBuilderUndoToast, romanGenericError } from '../../lib/roman/copy';
import {
  diffWorkingCopy,
  type WorkoutBuilderWorkingCopy,
} from './workoutBuilderAutosaveDiff';

/** EW2 undo: the in-screen toast lingers ~1.4 s, then self-dismisses. */
const UNDO_TOAST_MS = 1400;

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

/**
 * EW2 undo: maps an editable `DraftExerciseRow` field to the matching
 * `CommandRowSnapshot` field (the snapshot uses camelCase server-facing names).
 * Non-persisted draft fields (clientId, display_name, row_id) are absent, so a
 * patch touching them pushes no edit action.
 */
const DRAFT_TO_SNAPSHOT_FIELD: Partial<
  Record<keyof DraftExerciseRow, keyof CommandRowSnapshot>
> = {
  exercise_external_id: 'exerciseExternalId',
  sets: 'sets',
  reps_or_duration_seconds: 'repsOrDurationSeconds',
  rest_seconds: 'restSeconds',
  weight_lbs: 'weightLbs',
  superset_group_id: 'supersetGroupId',
  notes: 'notes',
};

/**
 * EW2 undo: the reverse map — a snapshot field back to the draft field the
 * inverse `editExerciseField` writes. `rowId` / `displayName` have no editable
 * draft counterpart through `updateRow`, so they are absent (and undefined-guarded).
 */
const SNAPSHOT_TO_DRAFT_FIELD: Partial<
  Record<keyof CommandRowSnapshot, keyof DraftExerciseRow>
> = {
  exerciseExternalId: 'exercise_external_id',
  sets: 'sets',
  repsOrDurationSeconds: 'reps_or_duration_seconds',
  restSeconds: 'rest_seconds',
  weightLbs: 'weight_lbs',
  supersetGroupId: 'superset_group_id',
  notes: 'notes',
};

/** Reads a snapshot field's CURRENT value off a draft row (the pre-edit value). */
const SNAPSHOT_VALUE_OF: Record<
  keyof CommandRowSnapshot,
  (r: DraftExerciseRow) => CommandRowSnapshot[keyof CommandRowSnapshot]
> = {
  rowId: (r) => r.row_id,
  exerciseExternalId: (r) => r.exercise_external_id,
  displayName: (r) => r.display_name,
  sets: (r) => r.sets,
  repsOrDurationSeconds: (r) => r.reps_or_duration_seconds,
  restSeconds: (r) => r.rest_seconds,
  weightLbs: (r) => r.weight_lbs,
  supersetGroupId: (r) => r.superset_group_id,
  notes: (r) => r.notes,
};

export default function CoachWorkoutBuilderScreen() {
  const route = useRoute<RouteProp<Record<string, RouteParam>, string>>();
  const navigation = useNavigation();
  const planId = route.params?.planId;
  const isEditing = Boolean(planId);

  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const qc = useQueryClient();
  const { data: existingPlan, refetch: refetchPlan } = useWorkoutPlan(planId);
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
  // N2: a render-synced mirror of `rows` so the gesture callbacks can read the
  // live rows and compute their undo snapshot/inverse OUTSIDE the setRows
  // updater (updaters may be replayed under StrictMode; reading the ref is
  // always correct and keeps each gesture's push to exactly one entry).
  const rowsRef = useRef<DraftExerciseRow[]>(rows);
  rowsRef.current = rows;

  // MWB-4 #237 (D-045) / D7B: the canonical delete-set — the single owner of the
  // removed-row bookkeeping (clientId key set + per-signature FIFO lists). A row
  // deleted BEFORE its server row_id was adopted produces NO remove_exercise op
  // (the diff needs a row_id), so the dirty signal can stay false and the
  // post-insert refetch's full-replace adoption would otherwise RESURRECT it.
  // `markDeleted` records the stable clientId on removal (regardless of row_id
  // presence); the adoption effect filters server rows through this set so the
  // delete is preserved — then re-issued as a remove_exercise once the server
  // row_id is known; the undo restore path `unmarkDeleted`s the row so a re-add
  // is not silently re-dropped (prior audit F1).
  const deleteSet = useCanonicalDeleteSet();

  // Search box state — local-only.
  const [search, setSearch] = useState<string>('');
  const searchEnabled = search.trim().length >= 2;
  const { data: searchResult } = useExerciseSearch(
    { q: search.trim(), limit: 8 },
    { enabled: searchEnabled },
  );

  // EW2 undo: a ref the mutation callbacks call to push an inverse-op snapshot
  // onto the command stack AT GESTURE TIME. It is populated below once the stack
  // exists (the stack's `applyInverse` closes over these same mutation setters,
  // so the ref breaks the declaration cycle). When undo is OFF the ref stays
  // null and every mutation is byte-identical to today — zero push work.
  const pushUndoActionRef = useRef<((action: BuilderAction) => void) | null>(
    null,
  );

  const addExercise = useCallback((ex: Exercise) => {
    // Mint the stable clientId up front so the SAME id is on the new row AND in
    // the undo snapshot — the inverse (removeExercise) resolves the row by it.
    const clientId = generateClientId();
    setRows((cur) => [
      ...cur,
      {
        // Stable client identity for this on-device row, minted once at
        // creation. Tracks the row across the id-less insert / adoption window
        // (D-045) and is never serialized to the server.
        clientId,
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
    // EW2: snapshot at gesture time (the row.id is adopted from the server later;
    // the inverse resolves it via this clientId, so we need no server confirm).
    pushUndoActionRef.current?.(actionForAddExercise(clientId));
    setSearch('');
  }, []);

  const moveRow = useCallback((idx: number, dir: -1 | 1) => {
    // N2: compute the inverse from the live rows BEFORE mutating, then push
    // AFTER setRows returns — never from inside the updater (React may
    // double-invoke updaters under StrictMode, which would push twice for one
    // gesture, violating the EW2 "one entry per gesture" invariant).
    const cur = rowsRef.current;
    const target = idx + dir;
    if (idx < 0 || idx >= cur.length || target < 0 || target >= cur.length) {
      return;
    }
    const moved = cur[idx] as DraftExerciseRow;
    setRows((prev) => {
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const tmp = next[idx] as DraftExerciseRow;
      next[idx] = next[target] as DraftExerciseRow;
      next[target] = tmp;
      return next;
    });
    // EW2: snapshot from/to AT GESTURE TIME (inverse swaps them back).
    pushUndoActionRef.current?.(
      actionForReorderExercise(moved.clientId, idx, target),
    );
  }, []);

  const removeRow = useCallback((idx: number) => {
    // N2: read the target + compute the delete-set mutation and the undo
    // snapshot from the live rows BEFORE setRows, so a replayed updater cannot
    // double-mark the delete-set or double-push the undo action.
    const cur = rowsRef.current;
    const target = cur[idx];
    if (!target) return;
    // Record the stable clientId of the removed row REGARDLESS of whether it has
    // a server row_id yet (D-045). If it was deleted in the id-less
    // insert/adoption window the diff cannot emit a remove_exercise, so this is
    // the only durable record of the coach's intent; the adoption effect reads
    // it to keep the row deleted (and re-issue the server-side remove once the
    // row_id is known) instead of letting the refetch resurrect it.
    deleteSet.markDeleted(target.clientId, rowCompositeSignature(target));
    setRows((prev) => prev.filter((_, i) => i !== idx));
    // EW2: snapshot the FULL row + its index BEFORE removal (inverse re-adds it
    // at the original position). Snapshot is taken at gesture time so a server
    // failure on the forward delete still leaves the stack honest.
    pushUndoActionRef.current?.(
      actionForRemoveExercise(
        {
          clientId: target.clientId,
          rowId: target.row_id,
          exerciseExternalId: target.exercise_external_id,
          displayName: target.display_name,
          sets: target.sets,
          repsOrDurationSeconds: target.reps_or_duration_seconds,
          restSeconds: target.rest_seconds,
          weightLbs: target.weight_lbs,
          supersetGroupId: target.superset_group_id,
          notes: target.notes,
        },
        idx,
      ),
    );
  }, [deleteSet]);

  const updateRow = useCallback(
    (idx: number, patch: Partial<DraftExerciseRow>) => {
      // N2: capture the pre-edit row from the live rows and compute the undo
      // actions BEFORE setRows, then push AFTER — never from inside the updater.
      const cur = rowsRef.current;
      const prevRow = cur[idx];
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
      );
      const pushUndo = pushUndoActionRef.current;
      if (pushUndo && prevRow) {
        // EW2: one push per edited field, capturing the PREVIOUS value BEFORE the
        // edit (inverse writes it back). A NumberField edit patches a single
        // field at a time; if a patch carries several we push one action per
        // changed field so each is independently undoable.
        (Object.keys(patch) as (keyof DraftExerciseRow)[]).forEach((key) => {
          const field = DRAFT_TO_SNAPSHOT_FIELD[key];
          if (field === undefined) return; // non-persisted field (e.g. clientId)
          const previousValue = SNAPSHOT_VALUE_OF[field](prevRow);
          pushUndo(
            actionForEditExerciseField(prevRow.clientId, field, previousValue),
          );
        });
      }
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

  const onAutosaveSaved = useCallback(() => {
    if (!autosaveEnabled) return;
    if (!hasIdlessRowsRef.current) return;
    refetchSeqRef.current += 1;
    setRefetchSeq(refetchSeqRef.current);
    void refetchPlan();
  }, [autosaveEnabled, refetchPlan]);

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
      // ways: (1) a server row_id we already mapped to a clientId still marked
      // deleted in the canonical delete-set, or (2) a server row_id we have
      // never seen whose composite signature matches a row removed while still
      // id-less. Matching consumes one entry per signature so identical rows are
      // dropped one-for-one. Kept rows are mapped verbatim from server truth
      // (the FULL replace); dropped rows are re-deleted by the rebaselineTo below.
      const sigPool = deleteSet.snapshotSignatures();
      const keptExercises: WorkoutPlanExercise[] = [];
      const droppedRowIds: string[] = [];
      for (const e of serverExercises) {
        // (1) Known server row_id whose clientId was deleted.
        const mappedClientId = rowIdToClientIdRef.current.get(e.id);
        if (mappedClientId && deleteSet.isDeleted(mappedClientId)) {
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

      // N1: preserve command identity across this clean full-replace adoption.
      // A newly-added id-less local row that the server just confirmed has no
      // `rowIdToClientIdRef` mapping yet, so `clientIdForServerRow` below would
      // MINT a fresh clientId — orphaning the command stack's original clientId
      // and making a later "add then undo" a silent no-op (prior audit N1). We
      // match each kept server row that is still unmapped back to an id-less
      // local row by composite signature (FIFO, order-tolerant like D-045) and
      // seed `rowIdToClientIdRef` with that row's EXISTING clientId BEFORE the
      // full replace, so the adopted row keeps the identity the command holds.
      const idlessLocalBySig = new Map<string, string[]>();
      for (const r of rowsRef.current) {
        if (r.row_id !== undefined) continue;
        const sig = rowCompositeSignature(r);
        const list = idlessLocalBySig.get(sig) ?? [];
        list.push(r.clientId);
        idlessLocalBySig.set(sig, list);
      }
      for (const e of keptExercises) {
        if (rowIdToClientIdRef.current.has(e.id)) continue;
        const sig = serverRowCompositeSignature(e);
        const pending = idlessLocalBySig.get(sig);
        if (pending && pending.length > 0) {
          rowIdToClientIdRef.current.set(e.id, pending.shift() as string);
        }
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
        if (deleteSet.isDeleted(clientId) && !liveServerRowIds.has(rowId)) {
          deleteSet.unmarkByClientId(clientId);
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
    deleteSet,
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
  const canSave =
    name.trim().length > 0 &&
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
  const pillStatus = replayRefetchFailed ? 'conflict' : autosave.status;
  const onPillPress = useCallback(() => {
    if (replayRefetchFailedRef.current) {
      runReplayRefetch();
      return;
    }
    void autosave.flush();
  }, [runReplayRefetch, autosave]);

  // ─── EW2 client-side optimistic undo (flag-gated) ──────────────────────────
  // Purely additive over the existing autosave pipe: NO backend, NO endpoint,
  // NO schema change. When the flag is OFF, `undoEnabled` is false, the command
  // stack is mounted inert (its `applyInverse` is never reached because we never
  // populate `pushUndoActionRef`), NO undo button renders, and NO gesture binds
  // — the screen is byte-identical to today.
  const undoEnabled = featureFlags.mwbUndo;

  // EW2 success toast (Roman voice). In-screen, ~1.4 s, self-dismissing. Errors
  // route through the existing generic error stem (romanGenericError) — the
  // same calm voice every other mutation failure uses.
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const undoToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showUndoToast = useCallback((message: string) => {
    setUndoToast(message);
    // F3: announce to VoiceOver/TalkBack on appearance. The live-region on the
    // toast View covers re-render announcement; this imperative call guarantees
    // the confirmation is spoken even when the toast text is unchanged between
    // consecutive undos (a live region only re-announces on content change).
    AccessibilityInfo.announceForAccessibility(message);
    if (undoToastTimerRef.current) clearTimeout(undoToastTimerRef.current);
    undoToastTimerRef.current = setTimeout(() => {
      setUndoToast(null);
      undoToastTimerRef.current = null;
    }, UNDO_TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (undoToastTimerRef.current) clearTimeout(undoToastTimerRef.current);
    },
    [],
  );

  // Apply a derived inverse op back through the SAME local-state mutations the
  // forward ops use — so the change rides the existing autosave diff to the
  // server (the persisted state matches the on-screen state). Reuses setName /
  // setType / setRows; touches NO network directly.
  const applyInverse = useCallback(
    (op: InverseOp): void => {
      switch (op.kind) {
        case 'removeExercise': {
          // Undo-of-add: remove the row. Mirror removeRow's delete-tracking so
          // the autosave diff/adoption path treats this exactly as a user delete
          // would (D-045). N2: read the row + mutate the delete-set OUTSIDE the
          // updater so a replayed updater cannot double-mark.
          const cur = rowsRef.current;
          const removed = cur.find((r) => r.clientId === op.clientId);
          // D7B: a missing target means the inverse cannot apply — signal a no-op
          // so the stack restores the action and the screen emits the right
          // telemetry instead of showing a false success toast.
          if (!removed) throw new CommandNoOpError();
          deleteSet.markDeleted(removed.clientId, rowCompositeSignature(removed));
          setRows((prev) => prev.filter((r) => r.clientId !== op.clientId));
          return;
        }
        case 'addExercise': {
          // Undo-of-remove: re-add the snapshotted row at its original index. A
          // fresh clientId is minted so the resurrected row has a distinct
          // on-device identity. F1: the original removeRow MARKED the old row
          // deleted in the canonical delete-set; we MUST unmark it here, or the
          // next autosave adoption cycle would re-drop the restored row (silently
          // negating the undo). Resolve the old clientId from the snapshot's
          // server rowId when present, and consume the matching signature entry.
          const restoredClientId = generateClientId();
          const sig = rowCompositeSignature({
            exercise_external_id: op.row.exerciseExternalId,
            sets: op.row.sets,
            reps_or_duration_seconds: op.row.repsOrDurationSeconds,
            rest_seconds: op.row.restSeconds,
            weight_lbs: op.row.weightLbs,
            superset_group_id: op.row.supersetGroupId,
            notes: op.row.notes,
          });
          const oldClientId = op.row.rowId
            ? rowIdToClientIdRef.current.get(op.row.rowId)
            : undefined;
          // Clear the key-based marker (id-known path) AND consume one
          // signature-based marker (id-less path); unmarkDeleted handles both.
          deleteSet.unmarkDeleted(oldClientId ?? restoredClientId, sig);
          setRows((prev) => {
            const next = prev.slice();
            const restored: DraftExerciseRow = {
              clientId: restoredClientId,
              row_id: undefined,
              exercise_external_id: op.row.exerciseExternalId,
              display_name: op.row.displayName,
              sets: op.row.sets,
              reps_or_duration_seconds: op.row.repsOrDurationSeconds,
              rest_seconds: op.row.restSeconds,
              weight_lbs: op.row.weightLbs,
              superset_group_id: op.row.supersetGroupId,
              notes: op.row.notes,
            };
            const at = Math.min(Math.max(op.atIndex, 0), next.length);
            next.splice(at, 0, restored);
            return next;
          });
          return;
        }
        case 'reorderExercise': {
          // D7B: signal a no-op if the target drifted out of the rows.
          if (!rowsRef.current.some((r) => r.clientId === op.clientId)) {
            throw new CommandNoOpError();
          }
          setRows((cur) => {
            const from = cur.findIndex((r) => r.clientId === op.clientId);
            if (from === -1) return cur;
            const next = cur.slice();
            const [moved] = next.splice(from, 1);
            const to = Math.min(Math.max(op.toIndex, 0), next.length);
            next.splice(to, 0, moved as DraftExerciseRow);
            return next;
          });
          return;
        }
        case 'editExerciseField': {
          const draftKey = SNAPSHOT_TO_DRAFT_FIELD[op.field];
          if (draftKey === undefined) return;
          // D7B: signal a no-op if the target drifted out of the rows.
          if (!rowsRef.current.some((r) => r.clientId === op.clientId)) {
            throw new CommandNoOpError();
          }
          setRows((cur) =>
            cur.map((r) =>
              r.clientId === op.clientId
                ? ({ ...r, [draftKey]: op.value } as DraftExerciseRow)
                : r,
            ),
          );
          return;
        }
        case 'editPlan': {
          if (op.patch.name !== undefined) setName(op.patch.name);
          if (op.patch.type !== undefined) setType(op.patch.type as WorkoutType);
          return;
        }
        default: {
          const _never: never = op;
          return _never;
        }
      }
    },
    // F4: stable deps — setRows/setName/setType dispatchers and refs are
    // React-stable; `deleteSet` is a memoized stable object; `rowCompositeSignature`
    // and `generateClientId` are module-level. Listed explicitly so a future
    // non-stable dep is flagged by the linter rather than silently captured stale.
    [deleteSet],
  );

  // N3: emit a telemetry event when the bounded stack FIFO-evicts overflow, so
  // ops can see coaches hitting the depth bound after flag flip. Stable callback.
  const onUndoStackEvict = useCallback(
    ({ capacity, evictedCount }: { capacity: number; evictedCount: number }) => {
      track(AnalyticsEvents.MWB_UNDO_STACK_EVICTED, {
        capacity,
        evicted_count: evictedCount,
        plan_id: planId,
      });
    },
    [planId],
  );

  const commandStack = useBuilderCommandStack({
    applyInverse,
    onEvict: onUndoStackEvict,
  });
  const { push: pushUndoAction, undo: undoStack, canUndo, size: commandSize } =
    commandStack;

  // Populate the push ref ONLY when the flag is on, so a flag-off build does
  // zero push work and every mutation is byte-identical to today. The cleanup
  // nulls it so a flag flip (or unmount) stops capturing.
  useEffect(() => {
    if (!undoEnabled) {
      pushUndoActionRef.current = null;
      return undefined;
    }
    pushUndoActionRef.current = pushUndoAction;
    return () => {
      pushUndoActionRef.current = null;
    };
  }, [undoEnabled, pushUndoAction]);

  // The single undo handler shared by the toolbar button AND the two-finger
  // swipe gesture. Pops + re-applies the inverse; on success shows the Roman
  // success toast; on failure surfaces the generic Roman error and (the stack
  // having already restored the action) leaves it for a retry.
  const onUndo = useCallback(() => {
    // N3: record the invocation with the depth BEFORE the pop.
    track(AnalyticsEvents.MWB_UNDO_INVOKED, {
      stack_depth_before: commandSize,
      plan_id: planId,
    });
    void undoStack()
      .then((result) => {
        if (result.status === 'empty') {
          // Gesture fired on an empty stack (button is disabled at empty).
          track(AnalyticsEvents.MWB_UNDO_FAILED, {
            reason: 'empty',
            plan_id: planId,
          });
          return;
        }
        // F5: show the REMAINING depth (post-pop), not the fixed capacity, so the
        // toast is informative as the history drains.
        showUndoToast(romanBuilderUndoToast.success({ depth: result.remaining }));
      })
      .catch((err: unknown) => {
        // D7B: distinguish a no-op inverse (identity drift) from a real failure.
        track(AnalyticsEvents.MWB_UNDO_FAILED, {
          reason: isCommandNoOpError(err) ? 'noop' : 'resolve_failed',
          plan_id: planId,
        });
        showUndoToast(romanGenericError({ mode: 'default' }));
      });
  }, [undoStack, showUndoToast, commandSize, planId]);

  // Plan-meta edits routed through the command stack (flag-gated push). Each
  // wraps the raw setter and snapshots the PREVIOUS value BEFORE the edit so the
  // inverse (editPlan with previousPatch) restores it.
  const handleNameChange = useCallback(
    (next: string) => {
      const previous = name;
      if (undoEnabled && planId && next !== previous) {
        pushUndoActionRef.current?.(actionForEditPlan(planId, { name: previous }));
      }
      setName(next);
    },
    [name, planId, undoEnabled],
  );
  const handleTypeChange = useCallback(
    (next: WorkoutType) => {
      const previous = type;
      if (undoEnabled && planId && next !== previous) {
        pushUndoActionRef.current?.(actionForEditPlan(planId, { type: previous }));
      }
      setType(next);
    },
    [type, planId, undoEnabled],
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeading}>
            {/* EW2 undo: left-justified, hairline-divided from the title. Only
                mounted when the flag is ON — flag-off renders NOTHING here and
                binds NO gesture (zero UI residue, byte-identical to today). */}
            {undoEnabled ? (
              <UndoButton onUndo={onUndo} canUndo={canUndo} />
            ) : null}
            <Text style={[typography.h2, { color: sc.textPrimary }]}>
              {isEditing ? 'Edit workout plan' : 'New workout plan'}
            </Text>
          </View>
          {/* Save-state pill: only when autosave is active. Flag-off (or a
              brand-new plan) renders NOTHING here — zero UI residue. Tapping a
              recoverable (offline/conflict) pill retries the flush now. */}
          {autosaveEnabled ? (
            <AutosaveStatusPill
              testID="mwb-autosave-pill"
              status={pillStatus}
              lastSavedAt={autosave.lastSavedAt}
              mirrorDegraded={autosave.mirrorDegraded}
              onPress={onPillPress}
            />
          ) : null}
        </View>

        {/* EW2 undo toast (Roman voice). Transient (~1.4 s), self-dismissing.
            Only ever shown when undo is active and a revert just completed. */}
        {undoEnabled && undoToast ? (
          <View
            style={styles.undoToast}
            testID="mwb-undo-toast"
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            <Text style={[typography.caption, { color: sc.textPrimary }]}>
              {undoToast}
            </Text>
          </View>
        ) : null}

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Plan name
        </Text>
        <TextInput
          accessibilityLabel="Plan name"
          value={name}
          onChangeText={handleNameChange}
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
              onPress={() => handleTypeChange(t)}
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
          onChangeText={setDuration}
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
                <Text style={[typography.body, { color: sc.textPrimary }]}>
                  {idx + 1}. {row.display_name}
                </Text>
                <View style={styles.rowControls}>
                  <Pressable
                    accessibilityLabel="Move exercise up"
                    onPress={() => moveRow(idx, -1)}
                    disabled={idx === 0}
                    style={styles.controlBtn}
                  >
                    <Text style={[typography.body, { color: sc.textPrimary }]}>
                      Up
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Move exercise down"
                    onPress={() => moveRow(idx, 1)}
                    disabled={idx === rows.length - 1}
                    style={styles.controlBtn}
                  >
                    <Text style={[typography.body, { color: sc.textPrimary }]}>
                      Down
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Remove exercise"
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
                  value={row.sets}
                  onChange={(v) => updateRow(idx, { sets: v })}
                  sc={sc}
                />
                <NumberField
                  label="Reps / sec"
                  value={row.reps_or_duration_seconds}
                  onChange={(v) => updateRow(idx, { reps_or_duration_seconds: v })}
                  sc={sc}
                />
                <NumberField
                  label="Rest (s)"
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
    </KeyboardAvoidingView>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  sc: SemanticTokens;
}) {
  const { label, value, onChange, sc } = props;
  return (
    <View style={{ flex: 1 }}>
      <Text style={[typography.caption, { color: sc.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={String(value)}
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
    headerLeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexShrink: 1,
    },
    undoToast: {
      backgroundColor: sc.bgSurface,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    label: { marginTop: spacing.md, marginBottom: spacing.xs },
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
