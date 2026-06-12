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
import AutosaveStatusPill from '../../components/workout/AutosaveStatusPill';
import {
  diffWorkingCopy,
  type WorkoutBuilderWorkingCopy,
} from './workoutBuilderAutosaveDiff';

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

interface DraftExerciseRow {
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

export default function CoachWorkoutBuilderScreen() {
  const route = useRoute<RouteProp<Record<string, RouteParam>, string>>();
  const navigation = useNavigation();
  const planId = route.params?.planId;
  const isEditing = Boolean(planId);

  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

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
  const [rows, setRows] = useState<DraftExerciseRow[]>(
    (existingPlan?.exercises ?? []).map((e) => ({
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

  // Search box state — local-only.
  const [search, setSearch] = useState<string>('');
  const searchEnabled = search.trim().length >= 2;
  const { data: searchResult } = useExerciseSearch(
    { q: search.trim(), limit: 8 },
    { enabled: searchEnabled },
  );

  const addExercise = useCallback((ex: Exercise) => {
    setRows((cur) => [
      ...cur,
      {
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

  const removeRow = useCallback((idx: number) => {
    setRows((cur) => cur.filter((_, i) => i !== idx));
  }, []);

  const updateRow = useCallback(
    (idx: number, patch: Partial<DraftExerciseRow>) => {
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
  // True once the screen has folded server data into local rows at least once.
  // The very first arrival of `existingPlan` is a legitimate full adopt even
  // though no refetch was requested; after that, only a fresh refetch we
  // triggered re-runs the adoption so incidental renders never clobber.
  const initialLoadDoneRef = useRef(false);

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
  // (Note: the by-design first-autosave bootstrap stale-lock recovery is silent
  // and does NOT call this — the hook handles it internally; only a real
  // external-edit conflict routes here.)
  const onAutosaveConflict = useCallback(() => {
    if (!autosaveEnabled) return;
    refetchSeqRef.current += 1;
    setRefetchSeq(refetchSeqRef.current);
    void refetchPlan();
  }, [autosaveEnabled, refetchPlan]);

  const autosave = useAutosave<WorkoutBuilderWorkingCopy>({
    planId: planId ?? '',
    value: workingCopy,
    diff: diffWorkingCopy,
    baseRevisionIndex: AUTOSAVE_BOOTSTRAP_BASE_INDEX,
    lockToken: AUTOSAVE_BOOTSTRAP_LOCK_TOKEN,
    enabled: autosaveEnabled,
    onSaved: onAutosaveSaved,
    onConflict: onAutosaveConflict,
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
      setRows(
        serverExercises.map((e) => ({
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
      // Mark the adopted server signature so the follow-up effect re-anchors
      // the autosave baseline to this copy once `workingCopy` reflects it.
      pendingRebaselineSigRef.current = serverRowSignature;
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
  }, [autosaveEnabled, autosave.hasPending, existingPlan, serverRowSignature, refetchSeq]);

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
  }, [autosaveEnabled, autosave.hasPending, localRowSignature, autosaveRebaseline]);

  const canSave =
    name.trim().length > 0 &&
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
        const payload: UpsertExerciseRowInput[] = rows.map((r, idx) => ({
          exercise_external_id: r.exercise_external_id,
          order: idx + 1,
          sets: r.sets,
          reps_or_duration_seconds: r.reps_or_duration_seconds,
          rest_seconds: r.rest_seconds ?? undefined,
          notes: r.notes ?? undefined,
        }));
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
              status={autosave.status}
              lastSavedAt={autosave.lastSavedAt}
              onPress={() => {
                void autosave.flush();
              }}
            />
          ) : null}
        </View>

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Plan name
        </Text>
        <TextInput
          accessibilityLabel="Plan name"
          value={name}
          onChangeText={setName}
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
              onPress={() => setType(t)}
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
