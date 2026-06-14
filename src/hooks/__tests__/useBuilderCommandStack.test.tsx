/**
 * useBuilderCommandStack.test — EW2 command-stack unit coverage.
 *
 * Exercises the pure inverse-op map AND the stateful hook contract:
 *   - inverseOf() is a total, correct function for EVERY forward op;
 *   - push/undo round-trips each inverse through the injected executor;
 *   - FIFO eviction at capacity (N = 20 default, and a small custom depth);
 *   - canUndo flips false at an empty stack and depth tracks size;
 *   - NO POP ON FAILURE — a rejecting executor restores the action and re-throws;
 *   - empty-stack undo is a silent no-op (never calls the executor).
 *
 * RNTL v14: `await renderHook(...)` (NEVER sync), `await waitFor(...)` after an
 * async act. No screen mount, no network — this is the contract's truth table.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import {
  useBuilderCommandStack,
  inverseOf,
  DEFAULT_COMMAND_STACK_DEPTH,
  type BuilderAction,
  type CommandRowSnapshot,
  type InverseOp,
} from '../useBuilderCommandStack';

const snapshot = (over: Partial<CommandRowSnapshot> = {}): CommandRowSnapshot => ({
  rowId: 'row-1',
  exerciseExternalId: 'bench',
  displayName: 'Bench Press',
  sets: 3,
  repsOrDurationSeconds: 8,
  restSeconds: 90,
  weightLbs: 185,
  supersetGroupId: null,
  notes: null,
  ...over,
});

describe('inverseOf — pure inverse-op map (truth table)', () => {
  it('addExercise → removeExercise by clientId', () => {
    const inv = inverseOf({ kind: 'addExercise', clientId: 'c-1' });
    expect(inv).toEqual({ kind: 'removeExercise', clientId: 'c-1' });
  });

  it('removeExercise → addExercise of the full row at its original index', () => {
    const row = snapshot({ displayName: 'Squat' });
    const inv = inverseOf({ kind: 'removeExercise', row, fromIndex: 2 });
    expect(inv).toEqual({ kind: 'addExercise', row, atIndex: 2 });
  });

  it('reorderExercise → reorderExercise with from/to swapped', () => {
    const inv = inverseOf({
      kind: 'reorderExercise',
      clientId: 'c-9',
      fromIndex: 1,
      toIndex: 4,
    });
    expect(inv).toEqual({
      kind: 'reorderExercise',
      clientId: 'c-9',
      fromIndex: 4,
      toIndex: 1,
    });
  });

  it('editExerciseField → editExerciseField writing the previous value back', () => {
    const inv = inverseOf({
      kind: 'editExerciseField',
      clientId: 'c-3',
      field: 'sets',
      previousValue: 5,
    });
    expect(inv).toEqual({
      kind: 'editExerciseField',
      clientId: 'c-3',
      field: 'sets',
      value: 5,
    });
  });

  it('editPlan → editPlan restoring the previous patch', () => {
    const inv = inverseOf({
      kind: 'editPlan',
      planId: 'plan-1',
      previousPatch: { name: 'Old name' },
    });
    expect(inv).toEqual({
      kind: 'editPlan',
      planId: 'plan-1',
      patch: { name: 'Old name' },
    });
  });
});

describe('useBuilderCommandStack — stateful contract', () => {
  it('starts empty: canUndo false, size 0, capacity default', async () => {
    const applyInverse = jest.fn();
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse }),
    );
    expect(result.current.canUndo).toBe(false);
    expect(result.current.size).toBe(0);
    expect(result.current.capacity).toBe(DEFAULT_COMMAND_STACK_DEPTH);
  });

  it('push flips canUndo true and tracks depth accurately', async () => {
    const applyInverse = jest.fn();
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse }),
    );
    await act(async () => {
      result.current.push({ kind: 'addExercise', clientId: 'a' });
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.size).toBe(1);
    await act(async () => {
      result.current.push({ kind: 'addExercise', clientId: 'b' });
    });
    expect(result.current.size).toBe(2);
  });

  it('undo pops the top action and applies its inverse through the executor', async () => {
    const applied: InverseOp[] = [];
    const applyInverse = jest.fn((op: InverseOp) => {
      applied.push(op);
    });
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse }),
    );
    await act(async () => {
      result.current.push({ kind: 'addExercise', clientId: 'a' });
      result.current.push({ kind: 'reorderExercise', clientId: 'b', fromIndex: 0, toIndex: 2 });
    });
    await act(async () => {
      await result.current.undo();
    });
    // LIFO: the reorder (last pushed) is undone first.
    expect(applied).toEqual([
      { kind: 'reorderExercise', clientId: 'b', fromIndex: 2, toIndex: 0 },
    ]);
    expect(result.current.size).toBe(1);
    await act(async () => {
      await result.current.undo();
    });
    expect(applied[1]).toEqual({ kind: 'removeExercise', clientId: 'a' });
    expect(result.current.canUndo).toBe(false);
  });

  it('applies the correct inverse for every forward op kind', async () => {
    const applied: InverseOp[] = [];
    const applyInverse = jest.fn((op: InverseOp) => {
      applied.push(op);
    });
    const row = snapshot();
    const forwards: BuilderAction[] = [
      { kind: 'addExercise', clientId: 'c-add' },
      { kind: 'removeExercise', row, fromIndex: 1 },
      { kind: 'reorderExercise', clientId: 'c-r', fromIndex: 0, toIndex: 3 },
      { kind: 'editExerciseField', clientId: 'c-e', field: 'weightLbs', previousValue: 135 },
      { kind: 'editPlan', planId: 'p', previousPatch: { type: 'strength' } },
    ];
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse }),
    );
    for (const f of forwards) {
      await act(async () => {
        result.current.push(f);
      });
    }
    // Undo all — should produce each inverse in LIFO order.
    for (let i = 0; i < forwards.length; i += 1) {
      await act(async () => {
        await result.current.undo();
      });
    }
    expect(applied).toEqual([
      { kind: 'editPlan', planId: 'p', patch: { type: 'strength' } },
      { kind: 'editExerciseField', clientId: 'c-e', field: 'weightLbs', value: 135 },
      { kind: 'reorderExercise', clientId: 'c-r', fromIndex: 3, toIndex: 0 },
      { kind: 'addExercise', row, atIndex: 1 },
      { kind: 'removeExercise', clientId: 'c-add' },
    ]);
    expect(result.current.canUndo).toBe(false);
  });

  it('FIFO-evicts the oldest entry at the default capacity (N = 20)', async () => {
    const applied: InverseOp[] = [];
    const applyInverse = jest.fn((op: InverseOp) => {
      applied.push(op);
    });
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse }),
    );
    // Push 21 distinct adds — the very first (oldest) must be evicted.
    await act(async () => {
      for (let i = 0; i < DEFAULT_COMMAND_STACK_DEPTH + 1; i += 1) {
        result.current.push({ kind: 'addExercise', clientId: `c-${i}` });
      }
    });
    expect(result.current.size).toBe(DEFAULT_COMMAND_STACK_DEPTH);
    // The newest (c-20) is at the top; undo it first.
    await act(async () => {
      await result.current.undo();
    });
    expect(applied[0]).toEqual({ kind: 'removeExercise', clientId: 'c-20' });
    // Drain the rest; the LAST inverse should be c-1 (c-0 was evicted), proving
    // the oldest entry — not the newest — was dropped.
    await act(async () => {
      for (let i = 0; i < DEFAULT_COMMAND_STACK_DEPTH - 1; i += 1) {
        await result.current.undo();
      }
    });
    expect(applied[applied.length - 1]).toEqual({
      kind: 'removeExercise',
      clientId: 'c-1',
    });
    expect(result.current.canUndo).toBe(false);
  });

  it('honours a custom depth and FIFO-evicts at it', async () => {
    const applied: InverseOp[] = [];
    const applyInverse = jest.fn((op: InverseOp) => {
      applied.push(op);
    });
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse, depth: 2 }),
    );
    expect(result.current.capacity).toBe(2);
    await act(async () => {
      result.current.push({ kind: 'addExercise', clientId: 'x0' });
      result.current.push({ kind: 'addExercise', clientId: 'x1' });
      result.current.push({ kind: 'addExercise', clientId: 'x2' });
    });
    expect(result.current.size).toBe(2);
    await act(async () => {
      await result.current.undo();
      await result.current.undo();
    });
    // x0 was evicted; the two survivors undo to x2 then x1.
    expect(applied).toEqual([
      { kind: 'removeExercise', clientId: 'x2' },
      { kind: 'removeExercise', clientId: 'x1' },
    ]);
  });

  it('empty-stack undo is a silent no-op (executor never called)', async () => {
    const applyInverse = jest.fn();
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse }),
    );
    await act(async () => {
      await result.current.undo();
    });
    expect(applyInverse).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
  });

  it('does NOT pop on failure: restores the action and re-throws', async () => {
    const applyInverse: jest.Mock<Promise<void>, [InverseOp]> = jest.fn();
    applyInverse.mockRejectedValueOnce(new Error('network down during undo'));
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse }),
    );
    await act(async () => {
      result.current.push({ kind: 'addExercise', clientId: 'keep-me' });
    });
    let caught: unknown;
    await act(async () => {
      await result.current.undo().catch((e) => {
        caught = e;
      });
    });
    expect(caught).toBeInstanceOf(Error);
    // The action was RESTORED — coach can retry.
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(result.current.size).toBe(1);
    // A retry that succeeds drains it.
    applyInverse.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.canUndo).toBe(false);
  });

  it('clear empties the stack', async () => {
    const applyInverse = jest.fn();
    const { result } = await renderHook(() =>
      useBuilderCommandStack({ applyInverse }),
    );
    await act(async () => {
      result.current.push({ kind: 'addExercise', clientId: 'a' });
      result.current.push({ kind: 'addExercise', clientId: 'b' });
    });
    expect(result.current.size).toBe(2);
    await act(async () => {
      result.current.clear();
    });
    expect(result.current.size).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });
});
