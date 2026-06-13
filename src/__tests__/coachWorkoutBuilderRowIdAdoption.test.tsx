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
// When `deferRefetch` is true a refetch does NOT immediately fold the server
// rows in (it does not bump `forceUpdate`); instead it stashes the settle into
// `settleRefetch` so a test can drive the RACE: edit the just-inserted row
// AFTER the autosave 200 (which dispatched the refetch) but BEFORE the refetch
// resolves, then settle it. This reproduces the D-042 adoption-clobber window.
let deferRefetch = false;
let settleRefetch: (() => void) | null = null;
const mockRefetch = jest.fn(async () => {
  if (deferRefetch) {
    // Hold the adoption until the test explicitly settles it.
    settleRefetch = () => forceUpdate?.();
    return { data: mockServerPlan };
  }
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

// The screen reads `useQueryClient()` directly (MWB-4 #237 R6 P1) to force-
// invalidate the plan cache on a kill/replay. `useWorkoutBuilder` is fully
// mocked here so the real query client is never otherwise touched and there is
// no QueryClientProvider in the tree; stub `useQueryClient` to a no-op client
// so the mount does not throw "No QueryClient set". These row-id-adoption tests
// never trigger a replay (readAutosaveMirror returns null), so the stub is
// never exercised — it only keeps the hook call from throwing.
jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    __esModule: true,
    useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined) }),
  };
});

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
  deferRefetch = false;
  settleRefetch = null;
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
      await fireEvent.changeText(setsInputs[setsInputs.length - 1], '7');
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
      await fireEvent.press(removeButtons[removeButtons.length - 1]);
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
      await fireEvent.press(upButtons[upButtons.length - 1]);
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
    const { getByLabelText } = await render(<Screen />);

    // Edit only the plan name (no id-less rows present). No refetch should fire.
    await act(async () => {
      await fireEvent.changeText(getByLabelText('Plan name'), 'Push day B');
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

/**
 * D-042 race coverage. The four tests above settle the post-insert refetch
 * BEFORE the coach touches the row again (via `addAndAdopt`). The blocking R4
 * audit gap is the OPPOSITE order: the coach edits/deletes/reorders the
 * just-inserted row in the window AFTER the insert autosave 200 (which
 * dispatched the refetch) but BEFORE that refetch resolves. Before D-042 the
 * hook's `hasPending` stayed false in that window, so the screen's adoption
 * effect ran on the resolving refetch and CLOBBERED the coach's in-flight edit
 * with refetched server data. These tests assert the edit/delete/reorder is
 * PRESERVED and the subsequent autosave names the adopted server row id.
 */
describe('CoachWorkoutBuilderScreen — P1 row-ID adoption RACE (edit before refetch resolves)', () => {
  /**
   * Add a row, then drive its insert autosave 200 with the post-save refetch
   * DEFERRED (not yet resolved). Returns the testing-library queries with the
   * screen parked in the exact race window: server has assigned the id, the
   * refetch is dispatched, but the rows have NOT yet been adopted. The caller
   * mutates the row, THEN calls `settleRefetch()` to resolve the adoption.
   */
  async function addThenDeferRefetch() {
    jest.useFakeTimers();
    deferRefetch = true;
    const Screen = loadScreen();
    const utils = render(<Screen />);
    const { getByLabelText } = utils;

    await act(async () => {
      fireEvent.changeText(getByLabelText('Search exercise catalog'), 'squat');
    });
    await act(async () => {
      fireEvent.press(utils.getByText('Squat'));
    });

    // The server gains the new row WITH an id (what the refetch WILL read once
    // it settles). We stage it now but do NOT bump forceUpdate, so the screen
    // does not see it until `settleRefetch()` resolves the adoption.
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

    // Debounce -> insert autosave 200 -> onSaved dispatches the (deferred)
    // refetch. Adoption is HELD pending settleRefetch().
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const firstOps = (mockAutosaveCall.mock.calls[0][0] as {
      body: { ops: { op: string; row_id?: string }[] };
    }).body.ops;
    const firstUpsert = firstOps.find((o) => o.op === 'upsert_exercise');
    expect(firstUpsert).toBeDefined();
    expect(firstUpsert?.row_id).toBeUndefined();
    // The refetch was dispatched but is parked (deferred): no adoption yet.
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
    expect(settleRefetch).not.toBeNull();

    return utils;
  }

  it('edit before refetch resolves: the edit is preserved AND the next autosave names the adopted id (no clobber)', async () => {
    const utils = await addThenDeferRefetch();
    const { getAllByLabelText } = utils;

    // Coach edits the just-inserted row's Sets to 7 WHILE the refetch is parked.
    const setsInputs = getAllByLabelText('Sets');
    await act(async () => {
      await fireEvent.changeText(setsInputs[setsInputs.length - 1], '7');
    });

    // NOW settle the refetch — adoption runs while the local edit is unsaved.
    await act(async () => {
      settleRefetch?.();
    });
    mockAutosaveCall.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());

    // The local edit survived: the value 7 is still on the row.
    const setsAfter = getAllByLabelText('Sets');
    expect(setsAfter[setsAfter.length - 1].props.value).toBe('7');
    // The subsequent autosave is a SINGLE upsert that NAMES the adopted server
    // id and carries the edited value — not a duplicate id-less insert.
    const ops = lastOpsBody();
    const upserts = ops.filter((o) => o.op === 'upsert_exercise') as {
      op: string;
      row_id?: string;
      payload?: { sets?: number };
    }[];
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row_id).toBe(NEW_SERVER_ROW_ID);
    // The edited value is carried in the upsert payload (not clobbered to 3).
    expect(upserts[0].payload?.sets).toBe(7);
  });

  it('delete before refetch resolves: the delete is preserved AND emits remove_exercise for the adopted id', async () => {
    const utils = await addThenDeferRefetch();
    const { getAllByLabelText, queryAllByLabelText } = utils;

    // Coach removes the just-inserted row WHILE the refetch is parked.
    const removeButtons = getAllByLabelText('Remove exercise');
    await act(async () => {
      await fireEvent.press(removeButtons[removeButtons.length - 1]);
    });

    // NOW settle the refetch — adoption must not resurrect the deleted row.
    await act(async () => {
      settleRefetch?.();
    });
    mockAutosaveCall.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());

    // The delete survived: only the original (bench) row remains.
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(1);
    // The subsequent autosave names the adopted id in a remove_exercise.
    const ops = lastOpsBody();
    expect(ops).toContainEqual({ op: 'remove_exercise', row_id: NEW_SERVER_ROW_ID });
  });

  it('reorder before refetch resolves: the reorder is preserved AND names the adopted id', async () => {
    const utils = await addThenDeferRefetch();
    const { getAllByLabelText } = utils;

    // Coach moves the just-inserted row up WHILE the refetch is parked.
    const upButtons = getAllByLabelText('Move exercise up');
    await act(async () => {
      await fireEvent.press(upButtons[upButtons.length - 1]);
    });

    // NOW settle the refetch.
    await act(async () => {
      settleRefetch?.();
    });
    mockAutosaveCall.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());

    // The subsequent autosave names the adopted id in the reorder (it could not
    // be referenced before adoption), and the original row id is present too.
    const ops = lastOpsBody();
    const reorder = ops.find((o) => o.op === 'reorder') as
      | { op: 'reorder'; row_ids: string[] }
      | undefined;
    expect(reorder).toBeDefined();
    expect(reorder?.row_ids).toContain(NEW_SERVER_ROW_ID);
    expect(reorder?.row_ids).toContain(SERVER_ROW_ID);
  });
});

/**
 * D-045 — delete-BEFORE-adoption resurrection (MWB-4 #237 R5 P1).
 *
 * The blocking gap the prior race tests miss: the coach deletes a row that was
 * inserted id-less and whose insert autosave has ALREADY 200'd, but BEFORE the
 * post-insert refetch resolves. Deleting an id-less row produces NO
 * remove_exercise op (the diff needs a row_id), so the hook's dirty signal
 * stays FALSE — `hasPending` is false in this window. When the deferred refetch
 * then resolves, the adoption effect takes the NON-pending full-replace path
 * and, before D-045, RESURRECTED the deleted row from server truth.
 *
 * With D-045 the screen tracks the deleted row's stable clientId, the adoption
 * filters the resurrected server row out by composite signature, anchors the
 * diff baseline to the FULL server copy, and the next autosave emits a
 * remove_exercise for the now-known server row_id — re-deleting it server-side.
 */
describe('CoachWorkoutBuilderScreen — D-045 delete-before-adoption (op-empty window)', () => {
  /**
   * Add a new row, drive its insert autosave 200, with the post-insert refetch
   * DEFERRED (parked, not yet resolved). The server has staged the new row WITH
   * an id (`NEW_SERVER_ROW_ID`) that the refetch WILL read once settled, but the
   * screen has NOT adopted it. Returns the testing-library queries parked in the
   * exact op-empty window; the caller deletes the id-less row, then settles.
   */
  async function addThenInsert200DeferRefetch() {
    jest.useFakeTimers();
    deferRefetch = true;
    const Screen = loadScreen();
    const utils = render(<Screen />);
    const { getByLabelText } = utils;

    await act(async () => {
      fireEvent.changeText(getByLabelText('Search exercise catalog'), 'squat');
    });
    await act(async () => {
      fireEvent.press(utils.getByText('Squat'));
    });

    // Stage the server-side row WITH its id (what the refetch reads on settle).
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

    // Debounce -> insert autosave 200 -> onSaved dispatches the deferred refetch.
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const firstOps = (mockAutosaveCall.mock.calls[0][0] as {
      body: { ops: { op: string; row_id?: string }[] };
    }).body.ops;
    const firstUpsert = firstOps.find((o) => o.op === 'upsert_exercise');
    expect(firstUpsert).toBeDefined();
    // It was an id-less insert: the server assigned the id we have NOT adopted.
    expect(firstUpsert?.row_id).toBeUndefined();
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
    expect(settleRefetch).not.toBeNull();
    return utils;
  }

  it('add -> insert 200 -> delete id-less row -> settle refetch: row stays deleted AND next autosave emits remove_exercise for the server id', async () => {
    const utils = await addThenInsert200DeferRefetch();
    const { getAllByLabelText, queryAllByLabelText } = utils;

    // Two rows present (bench + the just-inserted squat), insert already 200'd.
    expect(getAllByLabelText('Remove exercise')).toHaveLength(2);

    // Delete the id-less squat row WHILE the refetch is parked. This produces
    // NO remove_exercise op (no row_id), so the autosave dirty signal stays
    // false — the exact op-empty window the audit flagged.
    const removeButtons = getAllByLabelText('Remove exercise');
    await act(async () => {
      await fireEvent.press(removeButtons[removeButtons.length - 1]);
    });
    // Only the original bench row remains locally.
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(1);

    // NOW settle the refetch: the full-replace adoption MUST NOT resurrect the
    // deleted row.
    mockAutosaveCall.mockClear();
    await act(async () => {
      settleRefetch?.();
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });

    // The delete survived adoption: still only the bench row in the UI.
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(1);

    // The post-adoption diff (baseline = full server incl the resurrected row,
    // working copy = bench only) emits a remove_exercise naming the server id.
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const ops = lastOpsBody();
    expect(ops).toContainEqual({ op: 'remove_exercise', row_id: NEW_SERVER_ROW_ID });
  });

  it('double-delete: deleting the id-less row TWICE across two refetch settles stays deleted (no resurrection, idempotent remove)', async () => {
    const utils = await addThenInsert200DeferRefetch();
    const { getAllByLabelText, queryAllByLabelText } = utils;

    // First delete in the op-empty window.
    await act(async () => {
      const buttons = getAllByLabelText('Remove exercise');
      await fireEvent.press(buttons[buttons.length - 1]);
    });
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(1);

    // Settle the FIRST refetch — must not resurrect.
    await act(async () => {
      settleRefetch?.();
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(1);

    // A SECOND refetch resolves while the remove has not yet been confirmed on
    // the server (mockServerPlan still holds the row). The row must STILL be
    // dropped — the clientId stays tracked until the server confirms removal.
    settleRefetch = () => forceUpdate?.();
    mockAutosaveCall.mockClear();
    await act(async () => {
      settleRefetch?.();
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(1);

    // The diff continues to express the remove for the server id (re-issued, not
    // resurrected).
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
    const ops = lastOpsBody();
    expect(ops).toContainEqual({ op: 'remove_exercise', row_id: NEW_SERVER_ROW_ID });
  });

  it('add-delete-add interleaving: re-adding the SAME exercise after a delete-before-adoption keeps the new row (only the deleted one is dropped)', async () => {
    const utils = await addThenInsert200DeferRefetch();
    const { getAllByLabelText, queryAllByLabelText, getByLabelText } = utils;

    // Delete the id-less squat row in the op-empty window.
    await act(async () => {
      const buttons = getAllByLabelText('Remove exercise');
      await fireEvent.press(buttons[buttons.length - 1]);
    });
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(1);

    // Re-add a NEW squat row (a distinct clientId) BEFORE the refetch settles.
    await act(async () => {
      await fireEvent.changeText(getByLabelText('Search exercise catalog'), 'squat');
    });
    await act(async () => {
      await fireEvent.press(utils.getByText('Squat'));
    });
    // Bench + the freshly re-added squat = two rows locally.
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(2);

    // Settle the refetch: the server still has only the ORIGINAL resurrected
    // squat (NEW_SERVER_ROW_ID). The deleted clientId must drop THAT row by
    // signature, NOT the freshly re-added local row.
    mockAutosaveCall.mockClear();
    await act(async () => {
      settleRefetch?.();
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });

    // Two rows still present: bench + the new squat (the resurrected one stayed
    // dropped). The new row is NOT erroneously dropped by the signature match.
    expect(queryAllByLabelText('Remove exercise')).toHaveLength(2);
  });
});
