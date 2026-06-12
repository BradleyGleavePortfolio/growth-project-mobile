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

// Navigation: a minimal route (planId) + a no-op navigation object.
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useRoute: () => ({ params: { planId: 'plan-1' } }),
  useNavigation: () => ({ goBack: mockGoBack }),
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
jest.mock('../hooks/useWorkoutBuilder', () => ({
  __esModule: true,
  useWorkoutPlan: () => ({ data: EXISTING_PLAN, refetch: mockRefetch }),
  useCreateWorkoutPlan: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateWorkoutPlan: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useSetWorkoutExercises: () => ({ mutateAsync: jest.fn(), isPending: false }),
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
jest.mock('../storage/autosaveMirror', () => ({
  __esModule: true,
  writeAutosaveMirror: jest.fn().mockResolvedValue(undefined),
  readAutosaveMirror: jest.fn().mockResolvedValue(null),
  clearAutosaveMirror: jest.fn().mockResolvedValue(undefined),
}));

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
  mockAutosaveCall.mockResolvedValue({
    head_revision_index: 1,
    lock_token: 'feedfacefeedface',
    saved_at: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(() => {
  // RTL's auto-cleanup unmounts the tree (single React, default behaviour).
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
    const { queryByTestId } = render(<Screen />);

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
    const { getByLabelText, getByTestId } = render(<Screen />);

    // The pill is hidden in the 'idle' state (zero residue before any edit;
    // see AutosaveStatusPill: 'idle' -> nothing rendered). An edit moves the
    // autosave status off 'idle' so the save-state pill becomes visible.
    await act(async () => {
      fireEvent.changeText(getByLabelText('Plan name'), 'Push day B');
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
    const { getByLabelText } = render(<Screen />);

    // Edit the plan name — arms the debounced autosave.
    await act(async () => {
      fireEvent.changeText(getByLabelText('Plan name'), 'Push day B');
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await waitFor(() => expect(mockAutosaveCall).toHaveBeenCalled());
  });
});
