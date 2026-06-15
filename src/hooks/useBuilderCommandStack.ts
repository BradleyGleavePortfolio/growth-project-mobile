/**
 * useBuilderCommandStack — EW2 client-side optimistic undo for the coach
 * workout builder.
 *
 * A small, generic command-stack hook layered over the already-shipped MWB-4
 * autosave (`useAutosave` + `workoutBuilderAutosaveDiff`). Every user-driven
 * mutation in the builder (`addExercise`, `removeExercise`, `reorderExercise`,
 * `editExerciseField`, plan-level `editPlan`) is wrapped so that, at the moment
 * the coach fires it, an `BuilderAction` carrying the SNAPSHOT needed to reverse
 * it is pushed onto an in-memory stack (default depth N=20, FIFO eviction).
 * `undo()` pops the most-recent action, derives its inverse via the inverse-op
 * map, and re-runs that inverse through the SAME mutation channel the forward
 * op used — so the persisted state (autosave) and the on-screen state stay in
 * lock-step.
 *
 * Design invariants (EW2 spec):
 *   1. SNAPSHOT AT GESTURE TIME, not after server confirm. A server failure on
 *      the forward path still leaves the stack consistent with what the screen
 *      showed, and the snapshot is the truth the inverse needs (e.g. the full
 *      row before a remove, the previous field value before an edit).
 *   2. ONE entry per user gesture. The autosave layer's internal 409 retry is
 *      transparent; only the user-driven mutation pushes. The hook never sees a
 *      retry, so it cannot double-push (the screen calls `push` exactly once,
 *      at gesture time).
 *   3. NO POP ON FAILURE. `undo()` awaits the inverse executor; if it throws
 *      (e.g. a network failure during undo) the action is RESTORED to the top
 *      of the stack so the coach can retry, and the error is re-thrown for the
 *      screen to surface the Roman error voice.
 *   4. IN-MEMORY ONLY. The stack lives in component state and is wiped on screen
 *      unmount by design — this is a fearless-experimentation tool, not durable
 *      history (durable history is the deferred WorkoutPlanRevision feature).
 *
 * The hook is deliberately decoupled from the network: it knows the inverse-op
 * SHAPE but delegates EXECUTION to a single injected `applyInverse` callback the
 * screen supplies (which routes the inverse back through `useWorkoutBuilder` /
 * the autosave working copy). That keeps the inverse-op contract directly
 * unit-testable without mounting the screen — the place a subtle "we reversed
 * the wrong op" bug would otherwise hide.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

/** Default stack capacity (EW2 spec: depth N = 20). */
export const DEFAULT_COMMAND_STACK_DEPTH = 20;

/**
 * Thrown by an `applyInverse` executor when the inverse resolved to a no-op
 * (e.g. the target row could not be found because its identity drifted). The
 * hook RESTORES the popped action (treating it like any failure so the coach can
 * retry / the stack stays honest) and re-throws, but tags the error so the
 * screen can emit a distinct `mwb_undo_failed { reason: 'noop' }` event rather
 * than the generic resolve-failure path. (D7B: no-op inverses must not silently
 * pop with a success toast.)
 */
export class CommandNoOpError extends Error {
  readonly isCommandNoOp = true as const;
  constructor(message = 'inverse resolved to a no-op') {
    super(message);
    this.name = 'CommandNoOpError';
  }
}

/** Type guard for {@link CommandNoOpError}. */
export function isCommandNoOpError(err: unknown): err is CommandNoOpError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { isCommandNoOp?: boolean }).isCommandNoOp === true
  );
}

/** The outcome of an `undo()` call (lets the screen emit accurate telemetry). */
export type UndoResult =
  | { status: 'undone'; remaining: number }
  | { status: 'empty' };

/**
 * The server-facing snapshot of a single exercise row, captured at gesture time.
 * Mirrors the builder's working-copy row WITHOUT the transient on-device
 * `clientId`/`display_name` — the inverse only needs the persisted fields plus
 * the server `rowId` (when one exists) to reverse the op through autosave.
 */
export interface CommandRowSnapshot {
  /** Server row uuid, or undefined for a row added on-device this session. */
  rowId?: string;
  exerciseExternalId: string;
  displayName: string;
  sets: number;
  repsOrDurationSeconds: number;
  restSeconds: number | null;
  weightLbs: number | null;
  supersetGroupId: string | null;
  notes: string | null;
}

/** The plan-level fields the builder edits and can therefore reverse. */
export interface CommandPlanPatch {
  name?: string;
  type?: string;
}

/**
 * The five forward ops the builder performs, each carrying the snapshot the
 * inverse needs. A discriminated union keyed by `kind` — the inverse-op map is
 * a total function over this union (every member has exactly one inverse).
 *
 * The snapshot fields are EXACTLY the inverse-op contract from the EW2 spec:
 *
 *   | forward op           | snapshot at push          | inverse op                                   |
 *   |----------------------|---------------------------|----------------------------------------------|
 *   | addExercise(row)     | row.id after server confirm | removeExercise(row.id)                     |
 *   | removeExercise(rowId)| full row BEFORE removal   | addExercise(row) at original position        |
 *   | reorderExercise      | fromIdx, toIdx            | reorderExercise(rowId, toIdx, fromIdx)       |
 *   | editExerciseField    | previousValue BEFORE edit | editExerciseField(rowId, field, prevValue)   |
 *   | editPlan(planId,patch)| full previousPlan patch  | editPlan(planId, previousPatch)              |
 */
export type BuilderAction =
  | {
      kind: 'addExercise';
      /**
       * The stable on-device clientId of the added row. The server `rowId` is
       * only known AFTER autosave confirms the insert, so the inverse resolves
       * the row to remove by its clientId (which the screen maps to the live
       * rowId at undo time). This is why the inverse must run through the
       * screen's executor rather than carry a baked-in rowId.
       */
      clientId: string;
    }
  | {
      kind: 'removeExercise';
      /** The full row snapshot BEFORE removal, plus where it sat. */
      row: CommandRowSnapshot;
      /** The 0-based index the row occupied before it was removed. */
      fromIndex: number;
    }
  | {
      kind: 'reorderExercise';
      clientId: string;
      fromIndex: number;
      toIndex: number;
    }
  | {
      kind: 'editExerciseField';
      clientId: string;
      field: keyof CommandRowSnapshot;
      /** The value the field held BEFORE the edit (the inverse target). */
      previousValue: CommandRowSnapshot[keyof CommandRowSnapshot];
    }
  | {
      kind: 'editPlan';
      planId: string;
      /** The plan fields' values BEFORE the patch (the inverse target). */
      previousPatch: CommandPlanPatch;
    };

/** The inverse op the screen must apply, derived from a popped forward action. */
export type InverseOp =
  | { kind: 'removeExercise'; clientId: string }
  | { kind: 'addExercise'; row: CommandRowSnapshot; atIndex: number }
  | { kind: 'reorderExercise'; clientId: string; fromIndex: number; toIndex: number }
  | {
      kind: 'editExerciseField';
      clientId: string;
      field: keyof CommandRowSnapshot;
      value: CommandRowSnapshot[keyof CommandRowSnapshot];
    }
  | { kind: 'editPlan'; planId: string; patch: CommandPlanPatch };

/**
 * The inverse-op map — the heart of the feature. A pure, total function from a
 * forward action to the inverse op that reverses it. Exported so it is directly
 * unit-testable (no React, no network). Note the deliberate symmetry:
 *
 *   - reorder's inverse swaps from/to (move it back where it came from);
 *   - removeExercise's inverse re-adds the snapshotted row at its ORIGINAL index;
 *   - editExerciseField / editPlan's inverse writes the PREVIOUS value back.
 */
export function inverseOf(action: BuilderAction): InverseOp {
  switch (action.kind) {
    case 'addExercise':
      // Forward added a row; inverse removes it (resolved to its live rowId by
      // the screen executor via the stable clientId).
      return { kind: 'removeExercise', clientId: action.clientId };
    case 'removeExercise':
      // Forward removed a row; inverse re-adds the full snapshot at its old slot.
      return { kind: 'addExercise', row: action.row, atIndex: action.fromIndex };
    case 'reorderExercise':
      // Forward moved from->to; inverse moves to->from.
      return {
        kind: 'reorderExercise',
        clientId: action.clientId,
        fromIndex: action.toIndex,
        toIndex: action.fromIndex,
      };
    case 'editExerciseField':
      // Forward set a new value; inverse writes the previous value back.
      return {
        kind: 'editExerciseField',
        clientId: action.clientId,
        field: action.field,
        value: action.previousValue,
      };
    case 'editPlan':
      // Forward patched plan fields; inverse restores their previous values.
      return { kind: 'editPlan', planId: action.planId, patch: action.previousPatch };
    default: {
      // Exhaustiveness guard — a new action.kind without an inverse is a
      // compile error here, not a silent runtime no-op.
      const _never: never = action;
      return _never;
    }
  }
}

export interface UseBuilderCommandStackOptions {
  /**
   * Applies a derived inverse op back through the builder's mutation channel.
   * MUST resolve on success and REJECT on failure (e.g. a network error during
   * undo) — on rejection the popped action is restored to the stack so the coach
   * can retry, and the rejection propagates so the screen surfaces the Roman
   * error voice. Snapshots are captured at push time, so this executor never
   * needs to read live screen state to know WHAT to reverse.
   */
  applyInverse: (op: InverseOp) => void | Promise<void>;
  /** Stack capacity. Defaults to {@link DEFAULT_COMMAND_STACK_DEPTH} (20). */
  depth?: number;
  /**
   * Called when a `push` overflows capacity and the oldest entries are FIFO-
   * evicted (N3 observability). `evictedCount` is how many entries were dropped
   * (normally 1). Optional so the hook stays usable without telemetry.
   */
  onEvict?: (info: { capacity: number; evictedCount: number }) => void;
}

export interface BuilderCommandStack {
  /** Push a forward action's inverse snapshot. FIFO-evicts the oldest at depth. */
  push: (action: BuilderAction) => void;
  /**
   * Pop + re-apply the most-recent action's inverse. No-op on an empty stack
   * (resolves with `{ status: 'empty' }`). Resolves with
   * `{ status: 'undone', remaining }` once the inverse has been applied; rejects
   * (after RESTORING the popped action) if the inverse executor fails or throws
   * {@link CommandNoOpError}, so the coach can retry.
   */
  undo: () => Promise<UndoResult>;
  /** True when there is at least one action to undo. */
  canUndo: boolean;
  /** Current number of actions on the stack (0..depth). */
  size: number;
  /** The configured capacity (depth N). */
  capacity: number;
  /** Clear the whole stack (used on a deliberate reset; unmount wipes anyway). */
  clear: () => void;
}

/**
 * @see module docstring. The stack is component state (a `useState` array) so a
 * re-render reflects `canUndo`/`size`; the unmount wipes it by design.
 */
export function useBuilderCommandStack(
  options: UseBuilderCommandStackOptions,
): BuilderCommandStack {
  const { applyInverse, depth = DEFAULT_COMMAND_STACK_DEPTH, onEvict } = options;
  const capacity = depth > 0 ? depth : DEFAULT_COMMAND_STACK_DEPTH;

  // Read the evict callback through a ref so `push` stays referentially stable
  // even as the screen rebuilds the closure each render.
  const onEvictRef = useRef(onEvict);
  onEvictRef.current = onEvict;

  // The stack lives in a REF (the synchronous source of truth) mirrored into
  // component state purely to drive re-renders for `canUndo`/`size`. The ref is
  // why `push`/`undo` are deterministic: React does NOT guarantee a `setState`
  // updater runs synchronously (and may double-invoke it under StrictMode), so
  // reading the "current top" out of an updater is unsafe. Reading the ref is
  // always correct, and a single back-to-back `undo()` cannot pop the same
  // entry twice because the ref is mutated before the next call observes it.
  const stackRef = useRef<BuilderAction[]>([]);
  const [size, setSize] = useState(0);

  // Commit the ref to render state (size drives canUndo). Called after every
  // mutation so the button/gesture reflect the live depth.
  const sync = useCallback(() => {
    setSize(stackRef.current.length);
  }, []);

  // The executor is read through a ref so `undo` stays referentially stable even
  // as the screen rebuilds its closure each render (the screen's applyInverse
  // closes over live `rows`/`name`/`type`). Without this, every screen render
  // would hand the gesture/button a new `undo` identity.
  const applyInverseRef = useRef(applyInverse);
  applyInverseRef.current = applyInverse;

  const push = useCallback(
    (action: BuilderAction) => {
      const next = [...stackRef.current, action];
      // FIFO eviction: at capacity, drop the OLDEST entry so the newest
      // gesture is always retained (EW2 edge-case 4).
      if (next.length > capacity) {
        const evictedCount = next.length - capacity;
        next.splice(0, evictedCount);
        // N3: surface the silent overflow so ops can see coaches hitting the
        // depth bound after flag flip.
        onEvictRef.current?.({ capacity, evictedCount });
      }
      stackRef.current = next;
      sync();
    },
    [capacity, sync],
  );

  const undo = useCallback(async (): Promise<UndoResult> => {
    // Optimistically pop the top action from the ref (synchronous + correct).
    const cur = stackRef.current;
    if (cur.length === 0) {
      // Empty-stack undo is a no-op (EW2: button is disabled at empty, but the
      // gesture can still fire — both resolve to a silent no-op here).
      return { status: 'empty' };
    }
    const popped = cur[cur.length - 1];
    stackRef.current = cur.slice(0, -1);
    sync();

    const op = inverseOf(popped);
    try {
      await applyInverseRef.current(op);
      return { status: 'undone', remaining: stackRef.current.length };
    } catch (err) {
      // EW2 edge-case 2: network failure during undo. RESTORE the action so the
      // coach can retry, then re-throw so the screen shows the Roman error voice.
      const next = [...stackRef.current, popped];
      if (next.length > capacity) {
        next.splice(0, next.length - capacity);
      }
      stackRef.current = next;
      sync();
      throw err;
    }
  }, [capacity, sync]);

  const clear = useCallback(() => {
    if (stackRef.current.length === 0) return;
    stackRef.current = [];
    sync();
  }, [sync]);

  return useMemo(
    () => ({
      push,
      undo,
      canUndo: size > 0,
      size,
      capacity,
      clear,
    }),
    [push, undo, size, capacity, clear],
  );
}
