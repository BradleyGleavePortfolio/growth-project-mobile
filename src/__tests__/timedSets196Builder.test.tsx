/**
 * TIMED-SETS-M (agent 196): the coach builder row counts in Reps or Seconds
 * (K3-S-40 "Reps", K3-S-41 "Seconds", under K3-C-19 "Count by"). The choice is
 * saved by the explicit Save (PUT, a full replace, so every row sends the unit
 * it has) and by autosave (only the row that changed). A row the server sent
 * without a unit reads Reps and is sent back without one.
 *
 * The screen mocks are copied from coachWorkoutBuilderAutosave.test.tsx.
 */
import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';
import { buildSetExercisesPayload, type DraftExerciseRow } from '../screens/coach/CoachWorkoutBuilderScreen';
import { diffWorkingCopy, type WorkoutBuilderWorkingCopy } from '../screens/coach/workoutBuilderAutosaveDiff';

// AIB-5: Ask AI status reads 404 (current production backend), so the entry stays hidden.
jest.mock('../api/aiBuilderApi', () => ({ ...jest.requireActual('../api/aiBuilderApi'), aiBuilderApi: { getStatus: () => Promise.resolve(null) } }));
jest.mock('../api/exerciseLibraryApi', () => ({
  exerciseLibraryApi: { getById: jest.fn().mockRejectedValue(new Error('Catalog unavailable in this isolated autosave test')) },
}));

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
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      workout_plan_id: 'plan-1',
      exercise_external_id: 'plank',
      order: 2,
      sets: 3,
      reps_or_duration_seconds: 60,
      unit: 'seconds' as const,
      weight_lbs: null,
      rest_seconds: 30,
      superset_group_id: null,
      notes: null,
    },
  ],
};

// The plan the mocked `useWorkoutPlan` returns.
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

// ─── Pure payloads ───────────────────────────────────────────────────────────


const { UpsertExerciseRowSchema, AutosaveOpSchema } = jest.requireActual('../api/workoutAutosaveApi') as typeof import('../api/workoutAutosaveApi');

const UID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function draft(over: Partial<DraftExerciseRow> = {}): DraftExerciseRow {
  return {
    clientId: 'c-1', row_id: UID_A, exercise_external_id: 'bench', display_name: 'Bench', sets: 3,
    reps_or_duration_seconds: 10, rest_seconds: 60, weight_lbs: null, superset_group_id: null, notes: null, ...over,
  };
}
type WRow = WorkoutBuilderWorkingCopy['rows'][number];
const wrow = (over: Partial<WRow> = {}): WRow => ({
  rowId: UID_A, exerciseExternalId: 'bench', sets: 3, repsOrDurationSeconds: 10, restSeconds: 60,
  weightLbs: null, supersetGroupId: null, notes: null, ...over,
});
const wcopy = (rows: WRow[]): WorkoutBuilderWorkingCopy => ({ meta: { name: 'Core day', type: 'strength' }, rows });

describe('explicit Save (PUT, full replace) sends each row the unit it has', () => {
  it.each([true, false])('autosave flag %s: a seconds row sends unit seconds, a row with no unit sends none', (flag) => {
    const out = buildSetExercisesPayload([draft({ unit: 'seconds', reps_or_duration_seconds: 60 }), draft({ row_id: UID_E })], flag);
    expect(out[0]).toMatchObject({ reps_or_duration_seconds: 60, unit: 'seconds' });
    expect('unit' in out[1]).toBe(false);
    const reps = buildSetExercisesPayload([draft({ unit: 'reps' })], flag);
    expect(reps[0].unit).toBe('reps');
  });

  it('flag off: a row with no unit keeps the byte-identical legacy keys', () => {
    expect(Object.keys(buildSetExercisesPayload([draft()], false)[0])).toEqual([
      'exercise_external_id', 'order', 'sets', 'reps_or_duration_seconds', 'rest_seconds', 'notes',
    ]);
  });
});

describe('autosave sends the unit only for the row that changed', () => {
  it('switching a row to Seconds upserts that row with unit seconds', () => {
    const ops = diffWorkingCopy(wcopy([wrow(), wrow({ rowId: UID_E })]), wcopy([wrow(), wrow({ rowId: UID_E, unit: 'seconds' })]));
    expect(ops).toEqual([expect.objectContaining({ op: 'upsert_exercise', row_id: UID_E, payload: expect.objectContaining({ unit: 'seconds' }) })]);
    for (const op of ops) expect(AutosaveOpSchema.safeParse(op).success).toBe(true);
  });

  it('an untouched row sends nothing; a row read without a unit equals a reps row', () => {
    const c = wcopy([wrow({ unit: 'seconds' }), wrow({ rowId: UID_E })]);
    expect(diffWorkingCopy(c, c)).toEqual([]);
    expect(diffWorkingCopy(wcopy([wrow()]), wcopy([wrow({ unit: 'reps' })]))).toEqual([]);
  });

  it('an older row without a unit, edited in another field, sends no unit (the server keeps its unit)', () => {
    const ops = diffWorkingCopy(wcopy([wrow()]), wcopy([wrow({ sets: 4 })]));
    expect(ops).toHaveLength(1);
    expect('unit' in (ops[0] as { payload: object }).payload).toBe(false);
  });

  it('the strict row schema takes reps or seconds and refuses anything else', () => {
    const base = { exercise_external_id: 'plank', order: 1, sets: 3, reps_or_duration_seconds: 60 };
    expect(UpsertExerciseRowSchema.safeParse({ ...base, unit: 'seconds' }).success).toBe(true);
    expect(UpsertExerciseRowSchema.safeParse({ ...base, unit: 'reps' }).success).toBe(true);
    expect(UpsertExerciseRowSchema.safeParse(base).success).toBe(true);
    expect(UpsertExerciseRowSchema.safeParse({ ...base, unit: 'minutes' }).success).toBe(false);
  });
});

// ─── The builder row ─────────────────────────────────────────────────────────

describe('the builder row: Count by Reps | Seconds', () => {
  it('reads the server unit: the plank row is on Seconds, the older bench row on Reps', async () => {
    setFlag(false);
    const Screen = loadScreen();
    const view = await render(<Screen />);
    await waitFor(() => expect(view.getByTestId('row-1-count-seconds')).toBeTruthy());
    expect(view.getByTestId('row-1-count-seconds').props.accessibilityState).toMatchObject({ selected: true });
    expect(view.getByTestId('row-0-count-reps').props.accessibilityState).toMatchObject({ selected: true });
    expect(view.getAllByText('Count by')).toHaveLength(2);
    expect(view.getAllByLabelText('Seconds')).toHaveLength(1); // the plank count field
    expect(view.getAllByLabelText('Reps')).toHaveLength(1); // the bench count field
    expect(view.queryByText('Reps / sec')).toBeNull();
  });

  it('explicit Save (flag off) sends the plank row as seconds and the bench row as main', async () => {
    setFlag(false);
    const Screen = loadScreen();
    const view = await render(<Screen />);
    await waitFor(() => expect(view.getByTestId('row-1-count-seconds')).toBeTruthy());
    await act(async () => {
      await fireEvent.press(view.getByTestId('row-0-count-seconds'));
    });
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Save changes'));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockSetExercisesMutateAsync).toHaveBeenCalled());
    const { rows } = mockSetExercisesMutateAsync.mock.calls[0][0] as { rows: Array<Record<string, unknown>> };
    expect(rows.map((r) => [r.exercise_external_id, r.unit])).toEqual([['bench', 'seconds'], ['plank', 'seconds']]);
  });

  it('autosave (flag on): tapping Reps on the plank row upserts only that row with unit reps', async () => {
    setFlag(true);
    jest.useFakeTimers();
    const Screen = loadScreen();
    const view = await render(<Screen />);
    await act(async () => {
      await fireEvent.press(view.getByTestId('row-1-count-reps'));
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const { body } = mockAutosaveCall.mock.calls[0][0] as { body: { ops: Array<{ op: string; row_id?: string; payload?: Record<string, unknown> }> } };
    expect(body.ops).toEqual([expect.objectContaining({ op: 'upsert_exercise', row_id: UID_E })]);
    expect(body.ops[0].payload).toMatchObject({ exercise_external_id: 'plank', unit: 'reps' });
    expect(view.getAllByLabelText('Reps')).toHaveLength(2);
  });
});

describe('Adjust for client copies the unit', () => {
  it('a timed row stays timed in the client copy; a row without a unit sends none', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { workoutBuilderApi } = require('../api/workoutBuilderApi') as typeof import('../api/workoutBuilderApi');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { copyWorkoutForClient } = require('../components/coach/ai-entry/AdjustForClient') as typeof import('../components/coach/ai-entry/AdjustForClient');
    jest.spyOn(workoutBuilderApi, 'getPlan').mockResolvedValue({ data: EXISTING_PLAN } as never);
    jest.spyOn(workoutBuilderApi, 'createPlan').mockResolvedValue({ data: { id: 'copy-1' } } as never);
    const put = jest.spyOn(workoutBuilderApi, 'setExercises').mockResolvedValue({ data: {} } as never);
    await copyWorkoutForClient('plan-1', 'Jordan');
    const rows = put.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.exercise_external_id, r.unit])).toEqual([['bench', undefined], ['plank', 'seconds']]);
    expect('unit' in rows[0]).toBe(false);
  });
});
