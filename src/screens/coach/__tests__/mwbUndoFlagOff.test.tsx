/**
 * mwbUndoFlagOff.test — EW2 undo flag-OFF invariance.
 *
 * The whole feature ships dark (EXPO_PUBLIC_FF_MWB_UNDO defaults false). With
 * the flag OFF the screen must be byte-identical to today: NO undo button in the
 * tree, NO toast, and CRUCIALLY no two-finger swipe gesture bound (the
 * GestureDetector/Pan is never constructed because UndoButton never mounts).
 *
 * This is a focused screen test with its own lightweight mock surface (it does
 * NOT import the autosave harness). The undo flag is left unset so `mwbUndo`
 * reads false; autosave is independently left off so the screen is in its
 * calmest legacy state. Single React instance (no resetModules) per the repo's
 * MWB test doctrine.
 *
 * RNTL v14: `await render(...)` (NEVER sync).
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ── featureFlags — live getters reading env, both flags default OFF here. ────
jest.mock('../../../config/featureFlags', () => {
  const truthy = (raw: string | undefined) =>
    raw != null &&
    raw !== '' &&
    ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
  return {
    __esModule: true,
    featureFlags: {
      get mwbAutosave() {
        return truthy(process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE);
      },
      get mwbUndo() {
        return truthy(process.env.EXPO_PUBLIC_FF_MWB_UNDO);
      },
    },
    isFeatureEnabled: () => false,
  };
});

// ── gesture-handler — a SPY Pan factory so we can prove it is NEVER called
// when the flag is off (no gesture bound). jest.setup.js does not mock it. ───
const mockPanFactory = jest.fn(() => {
  const g: Record<string, unknown> = {};
  g.runOnJS = () => g;
  g.minPointers = () => g;
  g.maxPointers = () => g;
  g.onEnd = () => g;
  return g;
});
jest.mock('react-native-gesture-handler', () => {
  const mockReact = require('react');
  return {
    Gesture: { Pan: () => mockPanFactory() },
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      mockReact.createElement(mockReact.Fragment, null, children),
  };
});

// ── @expo/vector-icons — light stub. ─────────────────────────────────────────
jest.mock('@expo/vector-icons', () => {
  const mockReact = require('react');
  return {
    Ionicons: ({ name }: { name: string }) =>
      mockReact.createElement('Ionicons', { name, testID: `icon-${name}` }),
  };
});

// ── ThemeProvider — real light tokens. ───────────────────────────────────────
jest.mock('../../../theme/ThemeProvider', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ semanticColors: lightTokens }) };
});

jest.mock('../../client/wearables/components/useReduceMotion', () => ({
  __esModule: true,
  useReduceMotion: () => true,
}));

// ── navigation. ──────────────────────────────────────────────────────────────
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useRoute: () => ({ params: { planId: 'plan-1' } }),
  useNavigation: () => ({ goBack: jest.fn(), addListener: () => () => {} }),
}));

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

// ── useWorkoutBuilder — stub the hooks, keep the REAL pure action builders. ──
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  __esModule: true,
  ...jest.requireActual('../../../hooks/useWorkoutBuilder'),
  useWorkoutPlan: () => ({ data: EXISTING_PLAN, refetch: jest.fn().mockResolvedValue({}) }),
  useCreateWorkoutPlan: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateWorkoutPlan: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useSetWorkoutExercises: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('../../../hooks/useExerciseLibrary', () => ({
  __esModule: true,
  useExerciseSearch: () => ({ data: { items: [] } }),
}));

// Autosave boundary — inert (flag off means it never fires anyway).
jest.mock('../../../api/workoutAutosaveApi', () => {
  class WorkoutAutosaveApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'WorkoutAutosaveApiError';
      this.status = status;
    }
  }
  return {
    __esModule: true,
    WorkoutAutosaveApiError,
    workoutAutosaveApi: { autosave: jest.fn() },
    AUTOSAVE_DEBOUNCE_MS: 800,
  };
});

jest.mock('../../../storage/autosaveMirror', () => ({
  __esModule: true,
  readAutosaveMirror: jest.fn().mockResolvedValue(null),
  writeAutosaveMirror: jest.fn().mockResolvedValue(undefined),
  clearAutosaveMirrorIfKey: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined) }),
  useMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useQuery: () => ({ data: undefined, refetch: jest.fn() }),
}));

const ORIGINAL_AUTOSAVE = process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;
const ORIGINAL_UNDO = process.env.EXPO_PUBLIC_FF_MWB_UNDO;

beforeEach(() => {
  jest.clearAllMocks();
  // Flag OFF: leave both undo + autosave unset → legacy behaviour.
  delete process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;
  delete process.env.EXPO_PUBLIC_FF_MWB_UNDO;
});

afterEach(() => {
  if (ORIGINAL_AUTOSAVE === undefined) delete process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE;
  else process.env.EXPO_PUBLIC_FF_MWB_AUTOSAVE = ORIGINAL_AUTOSAVE;
  if (ORIGINAL_UNDO === undefined) delete process.env.EXPO_PUBLIC_FF_MWB_UNDO;
  else process.env.EXPO_PUBLIC_FF_MWB_UNDO = ORIGINAL_UNDO;
});

function loadScreen(): React.ComponentType {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../CoachWorkoutBuilderScreen').default;
}

describe('CoachWorkoutBuilderScreen — EW2 undo flag OFF invariance', () => {
  it('renders NO undo button and NO undo toast', async () => {
    const Screen = loadScreen();
    const { queryByTestId } = await render(<Screen />);
    expect(queryByTestId('mwb-undo-button')).toBeNull();
    expect(queryByTestId('mwb-undo-button-container')).toBeNull();
    expect(queryByTestId('mwb-undo-toast')).toBeNull();
  });

  it('binds NO two-finger swipe gesture (Pan factory never constructed)', async () => {
    const Screen = loadScreen();
    await render(<Screen />);
    // UndoButton is the only consumer of Gesture.Pan in this screen; with the
    // flag off it never mounts, so the Pan factory is never called.
    expect(mockPanFactory).not.toHaveBeenCalled();
  });

  it('still renders the plan editor (legacy surface intact)', async () => {
    const Screen = loadScreen();
    const { getByLabelText, getByText } = await render(<Screen />);
    // The plan name input and the seeded exercise row are present.
    expect(getByLabelText('Plan name').props.value).toBe('Push day A');
    expect(getByText('1. bench')).toBeTruthy();
  });
});
