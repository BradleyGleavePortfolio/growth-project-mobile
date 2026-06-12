/**
 * CoachWorkoutBuilderScreen — P1 row-ID adoption on autosave insert (MWB-4 #237).
 *
 * The data-integrity bug this guards: a brand-new exercise row is inserted via
 * an id-less `upsert_exercise`. The autosave 200 response carries only
 * head_revision_index/lock_token/saved_at — NOT the new server row id. Without
 * adoption the autosave diff baseline advances to the id-less snapshot, so the
 * NEXT edit/delete/reorder of that same row diffs as brand-new again:
 *   - edit   -> a SECOND id-less upsert (a DUPLICATE insert),
 *   - delete -> NO remove_exercise (the row_id is falsy, so it is skipped),
 *   - reorder-> the row cannot be named (id-less rows are filtered out).
 *
 * The fix: after a successful autosave that inserted an id-less row, the screen
 * refetches the plan (onSaved), folds the server-assigned row id into the local
 * rows once pending clears, and re-anchors the autosave diff baseline to that
 * adopted copy (rebaseline). These tests drive that full flow through a
 * stateful useWorkoutPlan mock whose refetch promotes the inserted row to a
 * server-id'd row, then assert the FOLLOW-UP edit/delete/reorder emits the
 * correct, non-duplicating op.
 */

import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

// Flag read live from the env var (mirrors coachWorkoutBuilderAutosave.test).
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

jest.mock('@expo/vector-icons', () => {
  function Icon() {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});

jest.mock('../theme/ThemeProvider', () => {
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

jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({
  __esModule: true,
  useReduceMotion: () => false,
}));

const mockGoBack = jest.fn();
const mockAddListener = jest.fn(() => jest.fn());
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useRoute: () => ({ params: { planId: 'plan-1' } }),
  useNavigation: () => ({ goBack: mockGoBack, addListener: mockAddListener }),
}));

// ─── Stateful plan mock ──────────────────────────────────────────────────────
// `mockServerPlan` is the canonical server truth. `refetch` re-reads it and forces
// a re-render of the consuming screen (mirrors react-query's refetch updating
// the cached data). A registered force-update bumps a counter so the screen
// re-renders with the adopted server rows.
const SERVER_ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_SERVER_ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface ServerExercise {
  id: string;
  workout_plan_id: string;
  exercise_external_id: string;
  order: number;
  sets: number;
  reps_or_duration_seconds: number;
  weight_lbs: number | null;
  rest_seconds: number | null;
  superset_group_id: string | null;
  notes: string | null;
}

let mockServerPlan: {
  id: string;
  coach_id: string;
  name: string;
  type: 'strength';
  duration_estimate_minutes: number;
  created_at: string;
  updated_at: string;
  archived_at: null;
  exercises: ServerExercise[];
};

function freshServerPlan() {
  return {
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
        id: SERVER_ROW_ID,
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
}

// Force-update registry: the screen subscribes (via the mocked hook) and the
// refetch bumps the counter to re-render with the latest mockServerPlan.
let forceUpdate: (() => void) | null = null;
const mockRefetch = jest.fn(async () => {
  // The server has now assigned an id to the row that was inserted id-less.
  forceUpdate?.();
  return { data: mockServerPlan };
});

jest.mock('../hooks/useWorkoutBuilder', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    useWorkoutPlan: () => {
      const [, setTick] = ReactActual.useState(0);
      ReactActual.useEffect(() => {
        forceUpdate = () => setTick((t) => t + 1);
        return () => {
          forceUpdate = null;
        };
      }, []);
      return { data: mockServerPlan, refetch: mockRefetch };
    },
    useCreateWorkoutPlan: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useUpdateWorkoutPlan: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useSetWorkoutExercises: () => ({ mutateAsync: jest.fn(), isPending: false }),
  };
});

// Search returns one catalog item so the test can add an exercise via the UI.
jest.mock('../hooks/useExerciseLibrary', () => ({
  __esModule: true,
  useExerciseSearch: () => ({
    data: { items: [{ id: 'squat', name: 'Squat', bodyPart: 'legs' }] },
  }),
}));

// Autosave API boundary — count calls + inspect bodies, no real axios.
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

jest.mock('../storage/autosaveMirror', () => ({
  __esModule: true,
  writeAutosaveMirror: jest.fn().mockResolvedValue(undefined),
  readAutosaveMirror: jest.fn().mockResolvedValue(null),
  clearAutosaveMirror: jest.fn().mockResolvedValue(undefined),
  clearAutosaveMirrorIfKey: jest.fn().mockResolvedValue(true),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;

function loadScreen(): React.ComponentType {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../screens/coach/CoachWorkoutBuilderScreen').default;
}

/** Find the most recent autosave call body that contained an upsert op. */
function lastOpsBody(): { op: string; row_id?: string }[] {
  const calls = mockAutosaveCall.mock.calls;
  const last = calls[calls.length - 1][0] as { body: { ops: { op: string; row_id?: string }[] } };
  return last.body.ops;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockServerPlan = freshServerPlan();
  forceUpdate = null;
  process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE = 'true';
  mockAutosaveCall.mockResolvedValue({
    head_revision_index: 1,
    lock_token: 'feedfacefeedface',
    saved_at: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  if (ORIGINAL_FLAG === undefined) delete process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;
  else process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE = ORIGINAL_FLAG;
});

/**
 * Drive: add a new exercise -> debounce -> autosave 200 (id-less insert) ->
 * refetch promotes the inserted row to a server-id'd row. Leaves the screen in
 * the adopted-baseline state. Returns the testing-library queries.
 */
async function addAndAdopt() {
  jest.useFakeTimers();
  const Screen = loadScreen();
  const utils = render(<Screen />);
  const { getByLabelText } = utils;

  // Add the catalog item -> a new id-less row.
  await act(async () => {
    fireEvent.changeText(getByLabelText('Search exercise catalog'), 'squat');
  });
  await act(async () => {
    fireEvent.press(utils.getByText('Squat'));
  });

  // Before the insert lands the server gains the new row WITH an id (what the
  // post-save refetch will read). Promote it on the refetch.
  mockServerPlan = {
    ...mockServerPlan,
    exercises: [
      ...mockServerPlan.exercises,
      {
        id: NEW_SERVER_ROW_ID,
        workout_plan_id: 'plan-1',
        exercise_external_id: 'squat',
        order: 2,
        sets: 3,
        reps_or_duration_seconds: 10,
        weight_lbs: null,
        rest_seconds: 60,
        superset_group_id: null,
        notes: null,
      },
    ],
  };

  // Debounce -> autosave 200 -> onSaved refetch -> adopt + rebaseline.
  await act(async () => {
    jest.advanceTimersByTime(900);
  });
  await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
  // The first autosave was the id-less insert.
  const firstOps = (mockAutosaveCall.mock.calls[0][0] as {
    body: { ops: { op: string; row_id?: string }[] };
  }).body.ops;
  const firstUpsert = firstOps.find((o) => o.op === 'upsert_exercise');
  expect(firstUpsert).toBeDefined();
  expect(firstUpsert?.row_id).toBeUndefined();

  // The save triggered a refetch to adopt the server id.
  await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
  // Let the adoption setRows + rebaseline effects settle.
  await act(async () => {
    jest.advanceTimersByTime(50);
  });

  return utils;
}

describe('CoachWorkoutBuilderScreen — P1 row-ID adoption on autosave insert', () => {
  it('add -> autosave 200 -> edit same row: a SINGLE upsert WITH the adopted row_id (no duplicate insert)', async () => {
    const { getAllByLabelText } = await addAndAdopt();
    mockAutosaveCall.mockClear();

    // Edit the just-inserted (now adopted) row's Sets field. The row is the
    // 2nd in the list; Sets is the first numeric field per row.
    const setsInputs = getAllByLabelText('Sets');
    await act(async () => {
      fireEvent.changeText(setsInputs[setsInputs.length - 1], '7');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const ops = lastOpsBody();
    const upserts = ops.filter((o) => o.op === 'upsert_exercise');
    // Exactly one upsert, and it NAMES the adopted server row id (not id-less).
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row_id).toBe(NEW_SERVER_ROW_ID);
  });

  it('add -> autosave 200 -> delete same row: emits remove_exercise for the adopted id (not a silent skip)', async () => {
    const { getAllByLabelText } = await addAndAdopt();
    mockAutosaveCall.mockClear();

    // Remove the just-inserted (now adopted) row — the 2nd Remove button.
    const removeButtons = getAllByLabelText('Remove exercise');
    await act(async () => {
      fireEvent.press(removeButtons[removeButtons.length - 1]);
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const ops = lastOpsBody();
    expect(ops).toContainEqual({ op: 'remove_exercise', row_id: NEW_SERVER_ROW_ID });
  });

  it('add -> autosave 200 -> reorder: the reorder names the now-adopted id', async () => {
    const { getAllByLabelText } = await addAndAdopt();
    mockAutosaveCall.mockClear();

    // Move the just-inserted (now adopted) row up — the 2nd "Move up" button.
    const upButtons = getAllByLabelText('Move exercise up');
    await act(async () => {
      fireEvent.press(upButtons[upButtons.length - 1]);
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const ops = lastOpsBody();
    const reorder = ops.find((o) => o.op === 'reorder') as
      | { op: 'reorder'; row_ids: string[] }
      | undefined;
    expect(reorder).toBeDefined();
    // The adopted id is present in the reorder (it could not be before adoption).
    expect(reorder?.row_ids).toContain(NEW_SERVER_ROW_ID);
    expect(reorder?.row_ids).toContain(SERVER_ROW_ID);
  });

  it('a metadata-only save does NOT trigger a row-id refetch (no needless round-trip)', async () => {
    jest.useFakeTimers();
    const Screen = loadScreen();
    const { getByLabelText } = render(<Screen />);

    // Edit only the plan name (no id-less rows present). No refetch should fire.
    await act(async () => {
      fireEvent.changeText(getByLabelText('Plan name'), 'Push day B');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    expect(mockRefetch).not.toHaveBeenCalled();
  });
});
