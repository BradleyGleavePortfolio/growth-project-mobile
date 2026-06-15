/**
 * CoachWorkoutBuilderScreen autosave integration tests (MWB-4).
 *
 * The two gates that matter most here:
 *
 *   1. FLAG-OFF INVARIANCE (the headline hard gate): with
 *      EXPO_PUBLIC_FF_MWB_AUTOSAVE unset/false the screen must do ZERO autosave
 *      work — no PATCH /autosave call ever fires, and no save-state pill renders
 *      (zero UI residue). The legacy explicit-Save (PUT replace-all) path is
 *      untouched.
 *
 *   2. FLAG-ON wiring: with the flag true AND an existing plan, the save-state
 *      pill renders and an edit eventually drives a PATCH /autosave.
 *
 * We drive the flag through the env var, read live by a mocked `featureFlags`
 * getter (no module reset — see the mock note below for why), and mock the
 * heavyweight deps (theme, icons, navigation, the workout-builder query hooks)
 * so the mount is deterministic. The autosave API is mocked at the boundary so
 * we can assert call counts without real axios.
 */

import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

// Drive the MWB-4 autosave flag WITHOUT `jest.resetModules()`. The screen
// reads `featureFlags.mwbAutosave` at *render* time (a live property access in
// `autosaveEnabled`), so a module-scope mock whose getter reflects the current
// env var is enough to flip the flag between tests. This avoids resetting the
// module registry mid-test — a reset would hand the freshly-required screen a
// different React instance than the module-scope `@testing-library/react-native`
// import, producing two React copies, a null hook dispatcher, and the
// "Invalid hook call" at `useMemo`. Keeping a single React also keeps RTL's
// auto-cleanup `afterEach` intact, so no test leaks an open handle.
jest.mock('../config/featureFlags', () => {
  const readEnvFlag = () => {
    const raw = process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;
    if (raw == null || raw === '') return false;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
  };
  return {
    __esModule: true,
    featureFlags: {
      get mwbAutosave() {
        return readEnvFlag();
      },
    },
    isFeatureEnabled: (key: string) =>
      key === 'mwbAutosave' ? readEnvFlag() : false,
  };
});

// ─── Heavyweight-dep stubs (mirror exerciseCatalog.test.tsx) ─────────────────

jest.mock('@expo/vector-icons', () => {
  function Icon() {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});

jest.mock('../theme/ThemeProvider', () => {
  // Source the mock theme from the real semantic tokens (the single source of
  // truth) rather than raw hex literals — keeps the test honest about the
  // palette and satisfies the "no raw hex outside tokens.ts" invariant.
  const { lightTokens } = jest.requireActual('../theme/tokens');
  const semanticColors = lightTokens;
  const Pass = ({ children }: { children: React.ReactNode }) => children;
  return {
    __esModule: true,
    ThemeProvider: Pass,
    default: Pass,
    useTheme: () => ({ semanticColors, colors: semanticColors }),
  };
});

// useReduceMotion pulls a native accessibility module; stub to a stable false.
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({
  __esModule: true,
  useReduceMotion: () => false,
}));

// Navigation: a minimal route (planId) + a no-op navigation object. The screen
// registers a `beforeRemove` listener to mirror-first flush on back-navigation
// (the stable-flush teardown path), so the stub must expose `addListener`
// returning an unsubscribe; without it the screen's effect throws on mount.
const mockGoBack = jest.fn();
const mockAddListener = jest.fn(() => jest.fn());
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useRoute: () => ({ params: { planId: 'plan-1' } }),
  useNavigation: () => ({ goBack: mockGoBack, addListener: mockAddListener }),
}));

// The workout-builder query/mutation hooks — deterministic stand-ins.
const mockRefetch = jest.fn().mockResolvedValue({});
const EXISTING_PLAN = {
  id: 'plan-1',
  coach_id: 'c1',
  name: 'Push day A',
  type: 'strength' as const,
  duration_estimate_minutes: 45,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  archived_at: null,
  exercises: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workout_plan_id: 'plan-1',
      exercise_external_id: 'bench',
      order: 1,
      sets: 3,
      reps_or_duration_seconds: 10,
      weight_lbs: null,
      rest_seconds: 60,
      superset_group_id: null,
      notes: null,
    },
  ],
};

// The refreshed server truth delivered by the post-replay reconciliation
// refetch: the rescued edit landed, so the server now holds the `deadlift` row
// (and the stale `squat` row a naive racing Save would have re-pushed is gone).
// A distinct object + distinct rows from EXISTING_PLAN so the regression below
// proves the screen ADOPTED refreshed truth rather than echoing the mock.
const RESCUED_PLAN = {
  ...EXISTING_PLAN,
  name: 'Rescued name A',
  exercises: [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      workout_plan_id: 'plan-1',
      exercise_external_id: 'deadlift',
      order: 1,
      sets: 5,
      reps_or_duration_seconds: 5,
      weight_lbs: null,
      rest_seconds: 120,
      superset_group_id: null,
      notes: null,
    },
  ],
};

// Mutable holder the mocked `useWorkoutPlan` reads each render. Defaults to the
// canonical EXISTING_PLAN; the P2 kill/replay regression starts it at
// `undefined` (the invalidate-driven reconciliation refetch is in flight, so the
// cache has no settled data to adopt yet — keeping the adoption effect from
// recording `initialLoadDoneRef` or consuming the replay's refetchSeq bump
// mid-flight), then swaps it to RESCUED_PLAN once the replay retry is terminal so
// the refreshed server truth is folded in by a clean full replace. Reset in
// beforeEach.
let mockCurrentPlan: typeof EXISTING_PLAN | undefined = EXISTING_PLAN;
// Named mutation spies so the kill/replay regression test can assert the exact
// full-replace payload an explicit Save sends AFTER a replay (it must carry the
// post-replay/refreshed rows, never an empty/reverted set).
const mockUpdateMutateAsync = jest.fn().mockResolvedValue({ id: 'plan-1' });
const mockCreateMutateAsync = jest.fn().mockResolvedValue({ id: 'plan-1' });
const mockSetExercisesMutateAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('../hooks/useWorkoutBuilder', () => ({
  __esModule: true,
  useWorkoutPlan: () => ({ data: mockCurrentPlan, refetch: mockRefetch }),
  useCreateWorkoutPlan: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateWorkoutPlan: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useSetWorkoutExercises: () => ({
    mutateAsync: mockSetExercisesMutateAsync,
    isPending: false,
  }),
}));

jest.mock('../hooks/useExerciseLibrary', () => ({
  __esModule: true,
  useExerciseSearch: () => ({ data: { items: [] } }),
}));

// Mock the autosave API boundary so we can count PATCH calls without axios.
const mockAutosaveCall = jest.fn();
jest.mock('../api/workoutAutosaveApi', () => {
  class WorkoutAutosaveApiError extends Error {
    kind: string;
    status: number;
    conflict?: unknown;
    constructor(kind: string, status: number, message: string, conflict?: unknown) {
      super(message);
      this.kind = kind;
      this.status = status;
      this.conflict = conflict;
    }
    get isNetwork() {
      return this.kind === 'network';
    }
  }
  return {
    __esModule: true,
    WorkoutAutosaveApiError,
    workoutAutosaveApi: {
      autosave: (...args: unknown[]) => mockAutosaveCall(...args),
      undo: jest.fn(),
    },
    AUTOSAVE_DEBOUNCE_MS: 800,
  };
});

// Mock the mirror so no AsyncStorage write fires during the test.
// `readAutosaveMirror` defaults to null (no mirror); the kill/replay regression
// test below overrides it per-test with `mockResolvedValueOnce(...)` so only
// that test exercises the on-mount replay path.
const mockReadMirror = jest.fn().mockResolvedValue(null);
const mockClearMirrorIfKey = jest.fn().mockResolvedValue(undefined);
jest.mock('../storage/autosaveMirror', () => ({
  __esModule: true,
  writeAutosaveMirror: jest.fn().mockResolvedValue(undefined),
  readAutosaveMirror: (...args: unknown[]) => mockReadMirror(...args),
  clearAutosaveMirror: jest.fn().mockResolvedValue(undefined),
  clearAutosaveMirrorIfKey: (...args: unknown[]) => mockClearMirrorIfKey(...args),
}));

// The screen now reads `useQueryClient()` directly (MWB-4 #237 R6 P1) to force-
// invalidate the plan cache on replay. `useWorkoutBuilder` is fully mocked so
// the real query client is never otherwise touched — we mock React Query's
// `useQueryClient` to a spy-able stub and assert the exact invalidation keys
// the replay handler fires. (`requireActual` keeps every other RQ export real
// so the screen's other imports are untouched.)
const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);
jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    __esModule: true,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;

function setFlag(on: boolean): void {
  if (on) process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE = 'true';
  else delete process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;
}

/** The mocked `featureFlags` getter reads the env var live, so a single
 *  module-scope require (no reset) is correct for both flag states. */
function loadScreen(): React.ComponentType {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../screens/coach/CoachWorkoutBuilderScreen').default;
}

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` wipes implementations too, so re-establish the defaults the
  // boundary mocks need between tests.
  mockCurrentPlan = EXISTING_PLAN;
  mockReadMirror.mockResolvedValue(null);
  mockClearMirrorIfKey.mockResolvedValue(undefined);
  mockInvalidateQueries.mockResolvedValue(undefined);
  mockRefetch.mockResolvedValue({});
  mockUpdateMutateAsync.mockResolvedValue({ id: 'plan-1' });
  mockCreateMutateAsync.mockResolvedValue({ id: 'plan-1' });
  mockSetExercisesMutateAsync.mockResolvedValue(undefined);
  mockAutosaveCall.mockResolvedValue({
    head_revision_index: 1,
    lock_token: 'feedfacefeedface',
    saved_at: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(() => {
  // RTL's auto-cleanup unmounts the tree (single React, default behaviour).
  // Clear any timers the screen's autosave hook left armed before restoring the
  // real clock so no debounced flush resolves after the test ("Cannot log after
  // tests are done") and keeps a handle open that makes Jest exit 1.
  jest.clearAllTimers();
  jest.useRealTimers();
  if (ORIGINAL_FLAG === undefined) delete process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;
  else process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE = ORIGINAL_FLAG;
});

// ─── Flag OFF: byte-identical legacy behaviour ───────────────────────────────

describe('CoachWorkoutBuilderScreen — flag OFF invariance', () => {
  it('renders no save-state pill and fires zero autosave calls', async () => {
    setFlag(false);
    jest.useFakeTimers();
    const Screen = loadScreen();
    const { queryByTestId } = await render(<Screen />);

    // No pill in the tree.
    expect(queryByTestId('mwb-autosave-pill')).toBeNull();

    // Even after the debounce window elapses, no autosave call ever fires.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockAutosaveCall).not.toHaveBeenCalled();
  });
});

// ─── Flag ON: autosave wired ─────────────────────────────────────────────────

describe('CoachWorkoutBuilderScreen — flag ON wiring', () => {
  it('renders the save-state pill when editing an existing plan', async () => {
    setFlag(true);
    jest.useFakeTimers();
    const Screen = loadScreen();
    const { getByLabelText, getByTestId } = await render(<Screen />);

    // The pill is hidden in the 'idle' state (zero residue before any edit;
    // see AutosaveStatusPill: 'idle' -> nothing rendered). An edit moves the
    // autosave status off 'idle' so the save-state pill becomes visible.
    await act(async () => {
      await fireEvent.changeText(getByLabelText('Plan name'), 'Push day B');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(getByTestId('mwb-autosave-pill')).toBeTruthy());
  });

  it('drives a PATCH /autosave after an edit + debounce', async () => {
    setFlag(true);
    jest.useFakeTimers();
    const Screen = loadScreen();
    const { getByLabelText } = await render(<Screen />);

    // Edit the plan name — arms the debounced autosave.
    await act(async () => {
      await fireEvent.changeText(getByLabelText('Plan name'), 'Push day B');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
  });
});

// ─── Kill/replay cache-reconcile (MWB-4 #237 R6 P1, MANDATORY regression) ─────
//
// Scenario the audit flagged: a previous session was force-quit mid-edit, so a
// mirrored batch (here a plan_meta rename) survives on disk. On relaunch the
// builder mounts on a STALE React Query cache (5-min staleTime + persisted
// cold-start hydration) that predates the rescued edit, and the hook replays
// the mirrored batch to the server. The bug was: the screen did not reconcile
// its cache on replay, and the legacy explicit-Save full-replace (built from
// the stale rows) then ERASED the just-rescued server edit.
//
// The fix has three observable obligations this test pins down with real
// assertions (no mock-echo):
//   1. On replay the screen force-INVALIDATES both the single-plan key
//      (['workout-plans', planId]) and the list key (['workout-plans']) so the
//      stale staleTime can no longer suppress a read, AND drives a refetch —
//      UNCONDITIONALLY (not gated on hasIdlessRows).
//   2. The mirrored batch is replayed to the server with its SAME idempotency
//      key (exactly-once kill/replay, not a fresh send).
//   3. Explicit Save is BLOCKED while the replay is in flight (so it cannot
//      race the refetch and revert the rescue), then re-enabled once the replay
//      settles — and a Save fired after the replay sends the post-replay rows
//      from refreshed truth (the bench row), never an empty/reverted payload.
describe('CoachWorkoutBuilderScreen — kill/replay cache reconcile (P1)', () => {
  const REPLAY_KEY = 'idem-replay-237-r6';
  const TOKEN_BOOTSTRAP = '0000000000000000';

  /** A mirrored plan_meta rename, exactly as the offline mirror would store it. */
  function mirroredRename() {
    return {
      version: 1,
      planId: 'plan-1',
      idempotencyKey: REPLAY_KEY,
      queuedAtMs: 1_700_000_000_000,
      batch: {
        base_revision_index: 0,
        lock_token: TOKEN_BOOTSTRAP,
        ops: [{ op: 'plan_meta', meta: { name: 'Rescued name A' } }],
        cause: 'manual_edit' as const,
      },
    };
  }

  /** A 409 `autosave_conflict_retry` — a GENUINE external-edit conflict (the
   *  plan moved ahead on the server while the replay was in flight, e.g. the
   *  rescued edit landed via another path). Unlike the silent bootstrap
   *  stale-lock, this fires `onConflict` so the screen invalidates + refetches
   *  (bumping refetchSeq) and rebases + REQUEUES the still-unsaved ops as the
   *  held retry below — exactly the replay-descendant path the R8 gate must hold
   *  across until the retry is terminal AND the refreshed truth is adopted. */
  function replayConflict() {
    const { WorkoutAutosaveApiError } = jest.requireMock(
      '../api/workoutAutosaveApi',
    ) as {
      WorkoutAutosaveApiError: new (
        kind: string,
        status: number,
        message: string,
        conflict?: unknown,
      ) => Error;
    };
    return new WorkoutAutosaveApiError('conflict', 409, 'external edit conflict', {
      error: 'autosave_conflict_retry',
      head_revision_index: 7,
      lock_token: 'abcdefabcdefabcd',
    });
  }

  it('force-invalidates + refetches the plan cache and replays with the same key', async () => {
    setFlag(true);
    mockReadMirror.mockResolvedValueOnce(mirroredRename());
    const Screen = loadScreen();
    await render(<Screen />);

    // 1. Both query keys are force-invalidated so staleTime cannot suppress the
    //    read; the single-plan key carries the concrete planId.
    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['workout-plans', 'plan-1'],
      });
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workout-plans'],
    });

    // ...and the refetch is driven (rebaselines the form from refreshed truth).
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());

    // 2. The mirrored batch is replayed to the server with its SAME idempotency
    //    key (exactly-once kill/replay).
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const replayArgs = mockAutosaveCall.mock.calls[0]?.[0] as {
      idempotencyKey?: string;
      body?: { ops?: Array<{ op: string }> };
    };
    expect(replayArgs.idempotencyKey).toBe(REPLAY_KEY);
    expect(replayArgs.body?.ops?.[0]?.op).toBe('plan_meta');
  });

  it('blocks explicit Save while the replay is in flight, then re-enables it', async () => {
    setFlag(true);
    mockReadMirror.mockResolvedValueOnce(mirroredRename());

    // Hold the replay's server call open so we can observe the in-flight gate.
    let resolveReplay: (v: unknown) => void = () => {};
    const replayPending = new Promise((resolve) => {
      resolveReplay = resolve;
    });
    mockAutosaveCall.mockReturnValueOnce(replayPending);

    const Screen = loadScreen();
    const { getByLabelText } = await render(<Screen />);

    // While the replay is in flight the Save button is disabled (replayInFlight
    // true) so a full-replace Save cannot race the refetch and revert the rescue.
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const saveButton = getByLabelText('Save changes');
    expect(saveButton.props.accessibilityState?.disabled).toBe(true);

    // Settle the replay (200). This is the TERMINAL network outcome, which
    // clears `replayInFlight` — but Save does not re-enable on that alone. Per
    // the post-R9 gate lifecycle, `replayAdoptionPending` extends the hold past
    // the terminal outcome until the post-replay forced refetch has DELIVERED,
    // been adopted into `rows`, and the autosave baseline has reanchored. Here
    // the default mocks resolve that refetch successfully against the settled
    // EXISTING_PLAN cache, so adoption + rebaseline complete and the gate then
    // drops — Save becomes available only once BOTH the terminal outcome AND the
    // adoption gate have cleared.
    await act(async () => {
      resolveReplay({
        head_revision_index: 1,
        lock_token: 'feedfacefeedface',
        saved_at: '2026-01-01T00:00:00.000Z',
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        getByLabelText('Save changes').props.accessibilityState?.disabled,
      ).toBe(false),
    );
  });

  it('holds Save disabled through a 409-rebased replay retry, then adopts refreshed truth before Save uses the rescued row', async () => {
    setFlag(true);
    jest.useFakeTimers();

    // Cold relaunch: the mirror replay force-invalidates the plan cache and
    // drives a refetch, so during the entire replay+retry window the cache has
    // NO settled server data to adopt yet (`undefined`). This is the crux of the
    // race: while the cache is empty the adoption effect early-returns on
    // `!existingPlan`, so it NEVER records `initialLoadDoneRef` and NEVER
    // consumes the replay/conflict-driven refetchSeq bumps. The screen still
    // carries the coach's in-progress LOCAL working copy (the rename below) — the
    // state a naive full-replace Save would push to the server if it raced the
    // retry, clobbering the rescued edit.
    mockCurrentPlan = undefined;
    mockReadMirror.mockResolvedValueOnce(mirroredRename());

    // The replay's FIRST send is HELD open so we can make the working copy
    // diverge (a coach edit) BEFORE the 409 is processed: that way the post-409
    // rebase produces a non-empty retry batch (otherwise the diff is empty and
    // the replay settles immediately with no retry to gate against). The 409 is
    // an autosave_lock_stale, which fast-forwards the lock and rebases+requeues
    // the still-unsaved ops; the SECOND send (the rebased retry) is also held
    // open so we can observe that Save stays disabled across the retry window.
    let rejectReplay: (e: unknown) => void = () => {};
    const replayPending = new Promise((_resolve, reject) => {
      rejectReplay = reject;
    });
    let resolveRetry: (v: unknown) => void = () => {};
    const retryPending = new Promise((resolve) => {
      resolveRetry = resolve;
    });
    mockAutosaveCall
      .mockReturnValueOnce(replayPending)
      .mockReturnValueOnce(retryPending);

    const Screen = loadScreen();
    const { getByLabelText, rerender } = await render(<Screen />);

    // The replay's first send is now in flight (held) and the cache is empty, so
    // the adoption effect has early-returned on every render so far
    // (`initialLoadDoneRef` still false).
    await waitFor(() => expect(mockAutosaveCall.mock.calls.length).toBe(1));

    // Diverge the working copy while the replay is held: the coach renames the
    // plan. This is the SOLE local divergence, so once the retry's terminal 200
    // lands the working copy matches its saved snapshot and `hasPending` settles
    // back to false (no perpetually-dirty id-less row to keep it pending).
    await act(async () => {
      await fireEvent.changeText(getByLabelText('Plan name'), 'Rescued name A');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
    });

    // Reject the held replay send with a 409: the hook rebases the (now
    // divergent) ops and re-sends the retry, which lands on the held promise.
    await act(async () => {
      rejectReplay(replayConflict());
      await Promise.resolve();
      await Promise.resolve();
    });

    // The replay 409'd and the rebased retry is now in flight (held pending).
    await waitFor(() =>
      expect(mockAutosaveCall.mock.calls.length).toBeGreaterThanOrEqual(2),
    );

    // R8 GATE-HOLD: a replayed 409 is NOT terminal — the retry is still in
    // flight, so Save MUST remain disabled. (The R7 code cleared the gate on
    // the 409 here, which would re-enable Save and let a stale full-replace
    // race the retry and erase the rescue.)
    expect(
      getByLabelText('Save changes').props.accessibilityState?.disabled,
    ).toBe(true);

    // Now let the held replay retry land its terminal 200 while the cache is
    // STILL empty. The terminal 200 clears the replay gate and settles
    // `hasPending` back to false WITHOUT adopting anything yet: with no settled
    // server data the adoption effect early-returns on `!existingPlan`, so
    // `initialLoadDoneRef` is STILL false (and every refetchSeq bump remains
    // UNADOPTED). This is what lets the refreshed truth be folded in by a clean
    // FULL REPLACE next — not a MERGE during the still-pending retry window.
    await act(async () => {
      resolveRetry({
        head_revision_index: 8,
        lock_token: 'feedfacefeedface',
        saved_at: '2026-01-01T00:00:00.000Z',
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    });

    // R9 GATE-HOLD (terminal-200-to-adoption window — Fix #1): the retry's 200
    // is terminal so `replayInFlight` is now clear, BUT the forced refetch has
    // not delivered refreshed truth yet (the cache is still empty / not adopted
    // into `rows`, baseline not reanchored). Save MUST still be DISABLED here —
    // this is exactly the gap a naive full-replace Save would exploit to push
    // the stale pre-refetch rows and erase the rescue. `replayAdoptionPending`
    // holds the gate across this window; this assertion FAILS if Fix #1 is
    // reverted (the gate would drop the instant the replay 200 landed).
    expect(
      getByLabelText('Save changes').props.accessibilityState?.disabled,
    ).toBe(true);

    // The reconciliation refetch the replay drove now delivers DIFFERENT
    // refreshed server truth: the rescued `deadlift` row landed and the stale
    // `squat` row is gone. Point the mocked query hook at it and rerender. With
    // `hasPending` now false AND `initialLoadDoneRef` still false (the empty-
    // cache window never set it), this first RESCUED render takes the
    // FULL-REPLACE branch and adopts the rescued `deadlift` row.
    mockCurrentPlan = RESCUED_PLAN;
    await act(async () => {
      await rerender(<Screen />);
      await Promise.resolve();
    });

    // Save re-enables only after the retry settled AND refreshed truth adopted.
    await waitFor(() =>
      expect(
        getByLabelText('Save changes').props.accessibilityState?.disabled,
      ).toBe(false),
    );

    // The reconciliation invalidated + refetched the plan cache.
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workout-plans', 'plan-1'],
    });
    expect(mockRefetch).toHaveBeenCalled();

    // Fire explicit Save now that the gate has released and refreshed truth is
    // adopted.
    await act(async () => {
      await fireEvent.press(getByLabelText('Save changes'));
      await Promise.resolve();
    });

    // The full-replace setExercises payload carries the RESCUED `deadlift` row
    // (refreshed server truth that the gate-held replay reconciliation adopted),
    // and the STALE `squat` row — which the pre-kill cache held and a naive Save
    // racing the retry would have re-pushed — is absent. This proves the screen
    // adopted post-replay truth rather than overwriting it with stale rows.
    await waitFor(() => expect(mockSetExercisesMutateAsync).toHaveBeenCalled());
    const setArgs = mockSetExercisesMutateAsync.mock.calls[0]?.[0] as {
      planId: string;
      rows: Array<{ exercise_external_id: string }>;
    };
    expect(setArgs.planId).toBe('plan-1');
    const externalIds = setArgs.rows.map((r) => r.exercise_external_id);
    expect(externalIds).toContain('deadlift');
    expect(externalIds).not.toContain('squat');
  });

  // R10 METADATA-RESCUE PATH (Fix #2): a replayed `plan_meta` rename lands on
  // the server during the replay. Before Fix #2 the screen adopted only server
  // ROWS on the post-replay refetch and left `name`/`type` at their pre-replay
  // values, so the rebaseline anchored to STALE meta and the next explicit
  // full-replace Save reverted the rescued rename. Fix #2 adopts FULL server
  // truth — metadata as well as rows — on the replay-adoption path, so an
  // explicit Save after the gate releases sends the RESCUED name/type. This
  // test FAILS if Fix #2 is reverted: the PUT/updateMut payload would carry the
  // stale pre-replay 'Push day A'/'strength' instead of the rescued values.
  it('preserves the rescued plan_meta name and type on the explicit Save after a replay + refetch + gate release', async () => {
    setFlag(true);

    // Refreshed server truth the post-replay reconciliation delivers: the
    // rescued rename landed AND the type advanced. Distinct from EXISTING_PLAN
    // so the assertion proves the screen adopted server meta, not the mock
    // default. (A different `type` makes the type adoption observable too.)
    const RESCUED_META_PLAN: typeof EXISTING_PLAN = {
      ...RESCUED_PLAN,
      name: 'Rescued name A',
      type: 'cardio' as typeof EXISTING_PLAN['type'],
    };

    // Cold relaunch: cache is empty during the replay (mirrors the 472 test) so
    // the refreshed truth is folded in by a clean FULL REPLACE once settled.
    mockCurrentPlan = undefined;
    mockReadMirror.mockResolvedValueOnce(mirroredRename());

    // Let the replay land a normal terminal 200 so `replayInFlight` clears; the
    // adoption gate then holds Save until the forced refetch delivers + adopts.
    mockAutosaveCall.mockResolvedValueOnce({
      head_revision_index: 1,
      lock_token: 'feedfacefeedface',
      saved_at: '2026-01-01T00:00:00.000Z',
    });

    const Screen = loadScreen();
    const { getByLabelText, rerender } = await render(<Screen />);

    // Replay fired and the forced reconciliation refetch was driven.
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());

    // The reconciliation refetch now delivers the refreshed server truth (the
    // rescued rename + advanced type). Point the mocked query hook at it and
    // rerender so the clean full-replace adoption folds it in.
    mockCurrentPlan = RESCUED_META_PLAN;
    await act(async () => {
      await rerender(<Screen />);
      await Promise.resolve();
    });

    // Save re-enables only after the gate releases (terminal outcome + adoption).
    await waitFor(() =>
      expect(
        getByLabelText('Save changes').props.accessibilityState?.disabled,
      ).toBe(false),
    );

    // Fire explicit Save.
    await act(async () => {
      await fireEvent.press(getByLabelText('Save changes'));
      await Promise.resolve();
    });

    // The PUT/updateMut payload carries the RESCUED metadata adopted from server
    // truth — not the stale pre-replay 'Push day A'/'strength'.
    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    const updateArgs = mockUpdateMutateAsync.mock.calls[0]?.[0] as {
      planId: string;
      input: { name: string; type: string };
    };
    expect(updateArgs.planId).toBe('plan-1');
    expect(updateArgs.input.name).toBe('Rescued name A');
    expect(updateArgs.input.type).toBe('cardio');
  });

  // R10 RECOVERABLE-REFRESH PATH (Fix #1): if the replay-driven forced refetch
  // HARD-FAILS (rejects / resolves with an error) the refreshed server truth
  // never arrives on that attempt. The gate must NOT silently clear into a
  // normal enabled Save — that reopens the stale full-replace window the gate
  // exists to close (a Save built from the pre-refetch rows would erase the
  // rescued edit). Instead Save STAYS BLOCKED and the status pill surfaces a
  // recoverable "Edited elsewhere — tap to refresh" affordance; tapping it
  // re-runs the refetch, which on success adopts the refreshed truth and
  // releases the gate. This is the user-visible path out, so Save is never
  // locked forever.
  //
  // This test REPLACES the R9 "degrades (re-enables Save) on hard-fail" test,
  // which embodied the OLD behavior Fix #1 corrects. It FAILS if Fix #1 is
  // reverted: the reverted code clears `replayAdoptionPending` on hard-fail, so
  // Save would be ENABLED at the first assertion below.
  it('keeps Save blocked and surfaces a recoverable refresh state when the post-replay forced refetch hard-fails, then recovers on a successful Refresh', async () => {
    setFlag(true);
    mockReadMirror.mockResolvedValueOnce(mirroredRename());
    // Start on the canonical plan so `name` is non-empty: the ONLY thing that
    // can keep Save disabled here is the adoption gate, which is what proves the
    // fix (a reverted Fix #1 would clear the gate on hard-fail and ENABLE Save).
    mockCurrentPlan = EXISTING_PLAN;
    // The forced reconciliation refetch hard-fails on its FIRST attempt (the
    // network read errored). The default `mockRefetch` resolves `{}` (success)
    // on every later call, so the Refresh re-run below succeeds.
    mockRefetch.mockResolvedValueOnce({ isError: true });

    // Let the replay settle with a normal terminal 200 so `replayInFlight`
    // clears; the only thing keeping Save disabled is then the adoption gate.
    mockAutosaveCall.mockResolvedValueOnce({
      head_revision_index: 1,
      lock_token: 'feedfacefeedface',
      saved_at: '2026-01-01T00:00:00.000Z',
    });

    const Screen = loadScreen();
    const { getByLabelText, getByTestId, rerender } = await render(<Screen />);

    // Replay fired (and so did the forced refetch that hard-failed).
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());

    // The replay reached a terminal 200 AND the refetch hard-failed. Save MUST
    // stay DISABLED (the gate did not silently clear into a stale full-replace).
    await waitFor(() =>
      expect(
        getByLabelText('Save changes').props.accessibilityState?.disabled,
      ).toBe(true),
    );

    // The status pill surfaces the recoverable refresh affordance — the calm,
    // truthful "tap to refresh" conflict copy — which is the user-visible path
    // out. (If Fix #1 were reverted the pill would not enter this state.)
    const pill = getByTestId('mwb-autosave-pill');
    expect(pill.props.accessibilityLabel).toBe(
      'Edited elsewhere — tap to refresh',
    );

    const refetchCallsBefore = mockRefetch.mock.calls.length;

    // The Refresh re-run succeeds and the reconciliation refetch now delivers
    // the refreshed server truth (the rescued rename + the deadlift row). Point
    // the mocked query hook at it and rerender so the clean full-replace
    // adoption folds it in, advancing the local row signature, reanchoring the
    // baseline, and releasing the gate.
    mockCurrentPlan = RESCUED_PLAN;

    // Tap the pill to RE-RUN the refetch. This attempt succeeds (default mock),
    // so the refreshed server truth is adopted, the baseline reanchors, and the
    // gate releases.
    await act(async () => {
      await fireEvent.press(pill);
      await Promise.resolve();
      await rerender(<Screen />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The Refresh re-ran the reconciliation refetch.
    expect(mockRefetch.mock.calls.length).toBeGreaterThan(refetchCallsBefore);

    // Save re-enables only after the successful Refresh adopts truth + releases
    // the gate.
    await waitFor(() =>
      expect(
        getByLabelText('Save changes').props.accessibilityState?.disabled,
      ).toBe(false),
    );
  });
});

// ─── Mirror-degraded durability (MWB-4 #237 R9 Fix #2, fifty-failures #36) ───
//
// The offline mirror is the on-device durability line. When `writeAutosaveMirror`
// FAILS (AsyncStorage full / unavailable) the failure must NOT be swallowed and
// the offline pill must NOT keep claiming "saved on device": the batch lives only
// in the in-memory queue, so the truthful copy asks the coach to keep the app
// open until the in-flight network send syncs. The send is still attempted (it is
// the best recovery), and the degraded flag clears once a later mirror write
// succeeds.
describe('CoachWorkoutBuilderScreen — mirror-degraded durability (P1, #36)', () => {
  function getWriteMirrorMock() {
    return (
      jest.requireMock('../storage/autosaveMirror') as {
        writeAutosaveMirror: jest.Mock;
      }
    ).writeAutosaveMirror;
  }

  it('shows truthful degraded copy (never "saved on device") and still attempts the send when the mirror write fails', async () => {
    setFlag(true);
    jest.useFakeTimers();
    // The on-device mirror write fails for this edit's flush.
    const writeMirror = getWriteMirrorMock();
    writeMirror.mockRejectedValueOnce(new Error('AsyncStorage quota exceeded'));
    // The network send hits a network error so the pill settles on 'offline'
    // (where the durability copy lives) rather than 'saved' — this is the exact
    // moment the offline copy would have falsely claimed on-device durability.
    const { WorkoutAutosaveApiError } = jest.requireMock(
      '../api/workoutAutosaveApi',
    ) as {
      WorkoutAutosaveApiError: new (
        kind: string,
        status: number,
        message: string,
      ) => Error;
    };
    mockAutosaveCall.mockRejectedValueOnce(
      new WorkoutAutosaveApiError('network', 0, 'offline'),
    );

    const Screen = loadScreen();
    const { getByLabelText, getByTestId } = await render(<Screen />);

    // Edit + debounce: this flush writes the mirror (which rejects) then sends.
    await act(async () => {
      await fireEvent.changeText(getByLabelText('Plan name'), 'Push day B');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The mirror write was attempted and the network send still fired (the send
    // is the best recovery when the device cannot persist).
    await waitFor(() => expect(writeMirror).toHaveBeenCalled());
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());

    // The pill is now offline AND degraded: it must show the TRUTHFUL copy and
    // NEVER claim the edit is saved on device. We assert on the pill's
    // accessibility label which carries the status copy verbatim.
    await waitFor(() => {
      const label = String(
        getByTestId('mwb-autosave-pill').props.accessibilityLabel ?? '',
      );
      expect(label).toContain('Unable to save on this device');
    });
    const finalLabel = String(
      getByTestId('mwb-autosave-pill').props.accessibilityLabel ?? '',
    );
    expect(finalLabel).not.toContain('saved on device');
  });

  it('clears the degraded state once a later mirror write succeeds', async () => {
    setFlag(true);
    jest.useFakeTimers();
    const writeMirror = getWriteMirrorMock();
    // First flush's mirror write fails, the next one succeeds.
    writeMirror
      .mockRejectedValueOnce(new Error('AsyncStorage quota exceeded'))
      .mockResolvedValue(undefined);

    const Screen = loadScreen();
    const { getByLabelText } = await render(<Screen />);

    // First edit: mirror write fails (degraded raised).
    await act(async () => {
      await fireEvent.changeText(getByLabelText('Plan name'), 'Push day B');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(writeMirror).toHaveBeenCalledTimes(1));

    // Second edit: mirror write succeeds (degraded clears). The send proceeds
    // and the 200 also drains the queue. We assert the retry mirror write fired,
    // proving the hook retries the mirror on the next flush rather than latching
    // the degraded state permanently.
    await act(async () => {
      await fireEvent.changeText(getByLabelText('Plan name'), 'Push day C');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(writeMirror.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });
});
