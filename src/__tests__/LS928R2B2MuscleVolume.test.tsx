import React from 'react';
import { AppState } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

// Real WorkoutScreen, chart aggregation and MuscleBreakdown/QuietBar.
// API responses mirror backend main 1016add4 workout.service.ts:421-444:
// getVolume sums weight_per_set * reps_per_set without asked_unit.
jest.mock('../config/featureFlags', () => ({
  featureFlags: {
    clientTrainV2: true, romanChat: true, romanP3Lock: true,
    clientTutorial: true, learnCourses: true, shareSheetV2: true,
  },
}));
const mockUser = { id: 'client-a', role: 'client', coach_id: 'coach-a' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
const mockNavigation = { navigate: jest.fn(), setParams: jest.fn(), getParent: () => undefined };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const ReactLib = jest.requireActual('react');
  return {
    ...actual,
    useNavigation: () => mockNavigation,
    useRoute: () => ({ params: {} }),
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      ReactLib.useEffect(() => cb(), []);
    },
  };
});
let mockUnit: 'seconds' | 'reps' | null = 'seconds';
const mockGetAll = jest.fn(async (..._args: unknown[]) => ({
  data: [{
    id: 'session-a',
    workout_name: 'Carry and crunch',
    date: new Date().toISOString(),
    created_at: new Date().toISOString(),
    duration_minutes: 15,
    exercises: [
      {
        exercise_name: 'Weighted carry', muscle_group: 'core',
        sets_completed: 1, reps_per_set: [60], weight_per_set: [20],
        asked_unit: mockUnit,
      },
      {
        exercise_name: 'Weighted crunch', muscle_group: 'core',
        sets_completed: 1, reps_per_set: [10], weight_per_set: [20],
        asked_unit: 'reps',
      },
    ],
  }],
}));
jest.mock('../services/api', () => ({
  workoutApi: {
    getRoutines: async () => ({ data: [] }),
    getAll: (...args: unknown[]) => mockGetAll(...args),
    getVolume: async () => ({
      data: [{ muscle_group: 'core', total_volume: 1400, period: 'week' }],
    }),
    deleteWorkout: jest.fn(),
  },
}));
const mockRefetch = jest.fn(async () => ({}));
jest.mock('../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: [], isLoading: false, refetch: mockRefetch }),
}));
jest.mock('../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [] }) }));
jest.mock('../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: {}, loading: false }),
}));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: async () => null,
}));
jest.mock('../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../components/roman/RomanWorkoutCompleteCard', () => () => null);
jest.mock('../screens/client/learn/CourseBanner', () => () => null);
jest.mock('../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({
  CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true],
}));

import WorkoutScreen from '../screens/client/WorkoutScreen';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

it.each([
  ['seconds', 200],
  ['reps', 1400],
  [null, 1400],
] as const)('muscle breakdown treats %s with the same rep-volume rule as the weekly chart', async (unit, expected) => {
  mockUnit = unit;
  const view = await render(<WorkoutScreen />);
  await waitFor(() => expect(view.getByText('Muscle breakdown')).toBeTruthy());
  // Confirm the real weekly chart already applies the new timed-set rule.
  expect(view.getAllByText(`${expected.toLocaleString()} lb`).length).toBeGreaterThan(0);
  expect(view.getByLabelText('Core progress').props.accessibilityValue.text)
    .toBe(`${expected.toLocaleString()} lb`);
});
