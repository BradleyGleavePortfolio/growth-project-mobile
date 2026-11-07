import React from 'react';
import { render } from '@testing-library/react-native';
import WorkoutHistoryEditScreen from '../screens/client/WorkoutHistoryEditScreen';
import { loggedWorkoutExercises } from '../screens/client/active-workout/sessionQuality';

const mockSavedWorkout = {
  id: 'saved-timed',
  workout_name: 'Core day',
  notes: '',
  exercises: [{
    exercise_name: 'Plank',
    muscle_group: 'core',
    sets_completed: 1,
    weight_per_set: [0],
    reps_per_set: [60],
    asked_unit: 'seconds',
    asked_count: 60,
  }],
};
const mockPut = jest.fn().mockResolvedValue({});
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { workout: JSON.stringify(mockSavedWorkout) } }),
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../theme/tokens').lightTokens,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { put: (...args: unknown[]) => mockPut(...args) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => mockPut.mockClear());

it('keeps the known seconds unit when mapping a saved timed workout into edit state', () => {
  const [exercise] = loggedWorkoutExercises(mockSavedWorkout);
  expect(exercise.sets).toEqual([{ weight: 0, reps: 60, completed: true }]);
  expect(exercise.unit).toBe('seconds');
});

it('shows the known seconds unit in the history edit header and input label', async () => {
  const view = await render(<WorkoutHistoryEditScreen />);
  expect(view.getByText('Plank')).toBeTruthy();
  expect(view.getByDisplayValue('60')).toBeTruthy();
  expect(view.getByText('Seconds')).toBeTruthy();
  expect(view.getByLabelText('Set 1 seconds')).toBeTruthy();
  expect(view.queryByLabelText('Set 1 reps')).toBeNull();
});
