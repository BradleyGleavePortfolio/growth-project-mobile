/**
 * workoutBuilderAutosaveDiff — turn the coach workout-builder working copy
 * (plan meta + the ordered DraftExerciseRow[]) into the ordered AutosaveOp[]
 * the MWB-3 backend applies (MWB-4, MASTER_WORKOUT_BUILDER_SPEC.md §6.3).
 *
 * This is the `diff` the screen hands to useAutosave. Keeping it a pure,
 * dependency-free function (no React, no network) makes the op-derivation
 * directly unit-testable without mounting the screen — the place a subtle
 * "we sent the wrong op" bug would otherwise hide.
 *
 * Op model (mirrors the backend discriminatedUnion('op', …)):
 *   - A row the server already knows (has a server `row_id`, a uuid) whose
 *     fields changed  -> upsert_exercise WITH row_id.
 *   - A row with no server id yet (just added on-device)        -> upsert_exercise
 *     WITHOUT row_id (the server inserts + assigns one; the screen adopts the
 *     id on the next refetch).
 *   - A previously-known row that is gone from the next copy     -> remove_exercise
 *     (needs the server row_id; a never-saved row that is added-then-removed
 *     produces no op at all).
 *   - The live order changed                                     -> reorder over the
 *     surviving server row_ids.
 *   - Plan name / type changed                                   -> plan_meta.
 *
 * Ordering matters: meta first, then upserts (so a row exists before a reorder
 * references it), then removes, then a single trailing reorder. The backend
 * applies ops in array order, so this keeps every row_id a reorder names live
 * at the moment it runs.
 *
 * Why a diff and not "replace all": the autosave endpoint is op-based and
 * optimistic-lock-guarded; sending the minimal delta keeps each batch small
 * (well under the 200-op / 64 KB caps) and lets the backend's revision log read
 * as real edit history rather than a churn of full snapshots. The existing
 * explicit-Save PUT replace-all path stays as the big-save fallback (the screen
 * keeps it), so this never has to express a wholesale plan rewrite.
 */

import type {
  AutosaveOp,
  AutosaveUpsertExerciseRow,
} from '../../api/workoutAutosaveApi';
import type { WorkoutType } from '../../api/workoutBuilderApi';

/**
 * The screen's per-row working copy. `rowId` is the server-assigned uuid for a
 * row the backend already persisted (absent for a row added on-device this
 * session). `weightLbs` / `supersetGroupId` are carried so a future control can
 * set them without changing this contract; today the screen leaves them at
 * their server value (or null for a new row).
 */
export interface AutosaveDraftRow {
  /** Server row uuid, or undefined for an unsaved (just-added) row. */
  rowId?: string;
  exerciseExternalId: string;
  sets: number;
  repsOrDurationSeconds: number;
  restSeconds: number | null;
  weightLbs: number | null;
  supersetGroupId: string | null;
  notes: string | null;
}

/** Plan-level meta the autosave diff can carry. */
export interface AutosaveDraftMeta {
  name: string;
  type: WorkoutType;
}

/** The full working copy the screen owns and hands to useAutosave. */
export interface WorkoutBuilderWorkingCopy {
  meta: AutosaveDraftMeta;
  rows: AutosaveDraftRow[];
}

/** Build the strict-schema row payload from a working-copy row. */
function toRowPayload(
  row: AutosaveDraftRow,
  order: number,
): AutosaveUpsertExerciseRow {
  const payload: AutosaveUpsertExerciseRow = {
    exercise_external_id: row.exerciseExternalId,
    order,
    sets: row.sets,
    reps_or_duration_seconds: row.repsOrDurationSeconds,
    weight_lbs: row.weightLbs,
    rest_seconds: row.restSeconds,
    superset_group_id: row.supersetGroupId,
    notes: row.notes,
  };
  return payload;
}

/** True when two saved rows differ in any field the backend persists. */
function rowFieldsDiffer(a: AutosaveDraftRow, b: AutosaveDraftRow): boolean {
  return (
    a.exerciseExternalId !== b.exerciseExternalId ||
    a.sets !== b.sets ||
    a.repsOrDurationSeconds !== b.repsOrDurationSeconds ||
    a.restSeconds !== b.restSeconds ||
    a.weightLbs !== b.weightLbs ||
    a.supersetGroupId !== b.supersetGroupId ||
    a.notes !== b.notes
  );
}

/**
 * The ordered diff from `prev` (last saved) to `next` (current working copy).
 * Returns [] when nothing the backend cares about changed (the hook no-ops).
 */
export function diffWorkingCopy(
  prev: WorkoutBuilderWorkingCopy,
  next: WorkoutBuilderWorkingCopy,
): AutosaveOp[] {
  const ops: AutosaveOp[] = [];

  // ── plan_meta ──────────────────────────────────────────────────────────────
  const metaPatch: { name?: string; type?: WorkoutType } = {};
  const trimmedNext = next.meta.name.trim();
  const trimmedPrev = prev.meta.name.trim();
  if (trimmedNext.length > 0 && trimmedNext !== trimmedPrev) {
    metaPatch.name = trimmedNext;
  }
  if (next.meta.type !== prev.meta.type) {
    metaPatch.type = next.meta.type;
  }
  if (metaPatch.name !== undefined || metaPatch.type !== undefined) {
    ops.push({ op: 'plan_meta', meta: metaPatch });
  }

  // Index the previous rows by server id for an O(1) "did this row change".
  const prevById = new Map<string, AutosaveDraftRow>();
  for (const r of prev.rows) {
    if (r.rowId) prevById.set(r.rowId, r);
  }
  const nextSavedIds = new Set<string>();
  for (const r of next.rows) {
    if (r.rowId) nextSavedIds.add(r.rowId);
  }

  // ── upsert_exercise ─────────────────────────────────────────────────────────
  // 1-indexed order is the row's position in the NEXT array.
  next.rows.forEach((row, idx) => {
    const order = idx + 1;
    if (!row.rowId) {
      // Brand-new on-device row — insert (no row_id; server assigns one).
      ops.push({ op: 'upsert_exercise', payload: toRowPayload(row, order) });
      return;
    }
    const before = prevById.get(row.rowId);
    if (!before) {
      // Had an id we did not know before (e.g. a rebase brought it in) — upsert
      // it WITH the id so the server replaces rather than duplicates.
      ops.push({
        op: 'upsert_exercise',
        row_id: row.rowId,
        payload: toRowPayload(row, order),
      });
      return;
    }
    // Known row: emit an upsert only if a persisted field OR its order changed.
    const prevOrder = prev.rows.findIndex((p) => p.rowId === row.rowId) + 1;
    if (rowFieldsDiffer(before, row) || prevOrder !== order) {
      ops.push({
        op: 'upsert_exercise',
        row_id: row.rowId,
        payload: toRowPayload(row, order),
      });
    }
  });

  // ── remove_exercise ─────────────────────────────────────────────────────────
  // A previously-saved row that is gone from the next copy. (An unsaved row that
  // was added then removed never had an id, so it correctly produces no op.)
  for (const r of prev.rows) {
    if (r.rowId && !nextSavedIds.has(r.rowId)) {
      ops.push({ op: 'remove_exercise', row_id: r.rowId });
    }
  }

  // ── reorder ──────────────────────────────────────────────────────────────────
  // Only when the order of the SURVIVING server rows actually changed. New rows
  // (no id) cannot appear in a reorder (it requires uuids); they take their
  // order from their upsert payload, and the next refetch folds them into the
  // server-id ordering. We compare the surviving-id sequences prev→next.
  const prevSurvivingIds = prev.rows
    .filter((r) => r.rowId && nextSavedIds.has(r.rowId))
    .map((r) => r.rowId as string);
  const nextSavedIdSeq = next.rows
    .filter((r) => r.rowId)
    .map((r) => r.rowId as string);
  const orderChanged =
    nextSavedIdSeq.length > 1 &&
    (prevSurvivingIds.length !== nextSavedIdSeq.length ||
      prevSurvivingIds.some((id, i) => id !== nextSavedIdSeq[i]));
  if (orderChanged) {
    ops.push({ op: 'reorder', row_ids: nextSavedIdSeq });
  }

  return ops;
}
