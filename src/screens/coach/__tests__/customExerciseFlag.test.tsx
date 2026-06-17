/**
 * customExerciseFlag.test — EXPO_PUBLIC_FF_CUSTOM_EXERCISE gating on the coach
 * workout builder.
 *
 * The custom-move authoring surface ships dark (flag defaults false). With the
 * flag OFF the builder must be byte-identical to today: NO "Author your own
 * move" affordance, NO composer, and the catalog-search path is the only way to
 * add a move. With the flag ON the affordance appears and opening it reveals the
 * free-text name + instructions + media-attach composer.
 *
 * Focused screen test with its own lightweight mock surface (no autosave
 * harness). RNTL v14: `await render(...)`, then drive with fireEvent.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ── featureFlags — live getter reading env so the flag flips per test. ───────
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
      get customExercise() {
        return truthy(process.env.EXPO_PUBLIC_FF_CUSTOM_EXERCISE);
      },
    },
    isFeatureEnabled: () => false,
  };
});

jest.mock('@expo/vector-icons', () => {
  const mockReact = require('react');
  return {
    Ionicons: ({ name }: { name: string }) =>
      mockReact.createElement('Ionicons', { name, testID: `icon-${name}` }),
  };
});

jest.mock('../../../theme/ThemeProvider', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ semanticColors: lightTokens }) };
});

jest.mock('../../client/wearables/components/useReduceMotion', () => ({
  __esModule: true,
  useReduceMotion: () => true,
}));

jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useRoute: () => ({ params: { planId: 'plan-1' } }),
  useNavigation: () => ({ goBack: jest.fn(), addListener: () => () => {} }),
}));

jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true }),
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
  exercises: [],
};

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

jest.mock('../../../hooks/useCoachExerciseLibrary', () => ({
  __esModule: true,
  useAuthorExercise: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useCoachExerciseLibrary: () => ({ data: [] }),
}));

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

const ORIGINAL = process.env.EXPO_PUBLIC_FF_CUSTOM_EXERCISE;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_FF_CUSTOM_EXERCISE;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_FF_CUSTOM_EXERCISE;
  else process.env.EXPO_PUBLIC_FF_CUSTOM_EXERCISE = ORIGINAL;
});

function loadScreen(): React.ComponentType {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../CoachWorkoutBuilderScreen').default;
}

describe('CoachWorkoutBuilderScreen — custom exercise flag', () => {
  it('renders NO author-your-own-move affordance when the flag is OFF', async () => {
    const Screen = loadScreen();
    const { queryByLabelText } = await render(<Screen />);
    expect(queryByLabelText('Author your own move')).toBeNull();
    // The legacy catalog search is still present.
    expect(queryByLabelText('Search exercise catalog')).toBeTruthy();
  });

  it('reveals the composer when the flag is ON and the affordance is tapped', async () => {
    process.env.EXPO_PUBLIC_FF_CUSTOM_EXERCISE = 'true';
    const Screen = loadScreen();
    const { getByLabelText, queryByLabelText, findByLabelText } = await render(<Screen />);

    const entry = getByLabelText('Author your own move');
    expect(entry).toBeTruthy();
    // Composer is not mounted until opened.
    expect(queryByLabelText('Custom move name')).toBeNull();

    fireEvent.press(entry);
    // RNTL v14 + React 18: the press schedules a state update; await the
    // composer mounting rather than asserting synchronously in the same tick.
    expect(await findByLabelText('Custom move name')).toBeTruthy();
    expect(getByLabelText('Custom move instructions')).toBeTruthy();
    expect(getByLabelText('Attach an image or video')).toBeTruthy();
  });
});
