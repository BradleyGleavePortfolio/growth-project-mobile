/** LS-917R4 B3: the picked C1 text-row logger includes its edit instruction. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { colors } from '../theme/tokens';
import { ExerciseCard } from '../screens/client/active-workout/ExerciseCard';
import { makeStyles } from '../screens/client/active-workout/styles';
import type { SessionExercise } from '../screens/client/active-workout/types';

jest.mock('../components/HapticPressable', () => ({
  __esModule: true, default: jest.requireActual('react-native').Pressable,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui', () => {
  const { Text } = jest.requireActual('react-native');
  return { Headline: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text> };
});

const exercise: SessionExercise = {
  exerciseId: 'seed:bench-fixture', exerciseName: 'Bench press',
  coachNote: 'Elbows tucked, bar to the lower chest.',
  sets: [
    { weight: 155, reps: 6, completed: true },
    { weight: 155, reps: 6, completed: false },
    { weight: 155, reps: 6, completed: false },
  ],
};
const toggle = jest.fn();
const start = () => render(<ExerciseCard exercise={exercise} exIdx={1} active
  colors={colors} styles={makeStyles(colors)} onUpdateSet={jest.fn()}
  onToggleSetComplete={toggle} onAddSet={jest.fn()} onRemoveExercise={jest.fn()}
  onOpenExerciseDetail={jest.fn()} />);
beforeEach(() => jest.clearAllMocks());

it('control: the active card has its coach cue and a working As planned action', async () => {
  const view = await start();
  expect(view.getByTestId('coach-note-1')).toHaveTextContent(exercise.coachNote!);
  await fireEvent.press(view.getByTestId('set-done-1-1'));
  expect(toggle).toHaveBeenCalledWith(1, 1);
});

it('LS-917R4 B3: the compact C1 logger keeps Different from the plan? Tap the numbers.', async () => {
  const view = await start();
  expect(view.getByTestId('exercise-active-1')).toBeTruthy();
  expect(view.getByText('Different from the plan? Tap the numbers.')).toBeTruthy();
});
