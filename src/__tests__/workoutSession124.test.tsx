import React, { useState } from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import type { SessionSet, SessionExercise } from '../screens/client/active-workout/types';
import {
  completedExercisePayload, loggedWorkoutEditPayload, loggedWorkoutExercises,
  moveExercise, newSessionExercise, previousSets, swapExercise, workoutSummary,
  type LoggedWorkout,
} from '../screens/client/active-workout/sessionQuality';
import WorkoutHistoryEditScreen from '../screens/client/WorkoutHistoryEditScreen';
import CoachExerciseName from '../components/coach/workout-builder/CoachExerciseName';
import { exerciseLibraryApi } from '../api/exerciseLibraryApi';
import api from '../services/api';

const mockGoBack = jest.fn();
const mockInvalidate = jest.fn().mockResolvedValue(undefined);
const mockHistory: LoggedWorkout[] = [{
  id: 'saved-workout', workout_name: 'Push A', notes: 'Felt good',
  exercises: [{
    exercise_name: 'Bench Press', muscle_group: 'chest', sets_completed: 2,
    weight_per_set: [135, 145], reps_per_set: [8, 6], rpe: 8,
    notes: 'Controlled tempo', video_url: 'https://test.local/video',
  }],
}];
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { workout: JSON.stringify(mockHistory[0]) } }),
  useNavigation: () => ({ goBack: mockGoBack }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../theme/tokens').lightTokens }),
}));
jest.mock('../services/api', () => ({ __esModule: true, default: { put: jest.fn() } }));
jest.mock('../api/exerciseLibraryApi', () => ({ exerciseLibraryApi: { getById: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const styles = new Proxy({}, { get: () => ({}) }) as never;
const colors = new Proxy({}, { get: () => 'transparent' }) as never;
const exercise: SessionExercise = {
  exerciseId: 'bench', exerciseName: 'Bench Press', muscleGroup: 'chest', restSec: 90, notes: 'Slow',
  sets: [{ weight: 155, reps: 8, completed: true }, { weight: 145, reps: 6, completed: false }],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.put).mockResolvedValue({ data: {} } as never);
  jest.mocked(exerciseLibraryApi.getById).mockResolvedValue({ data: { name: 'Bench Press' } } as never);
});

describe('saved workout corrections (B-SESSION-1)', () => {
  it('edits an actual saved weight, persists to its PUT endpoint and refreshes workouts', async () => {
    const screen = await render(<WorkoutHistoryEditScreen />);
    await fireEvent.changeText(screen.getByTestId('set-weight-0-0'), '137.5');
    await fireEvent.changeText(screen.getByLabelText('Workout notes'), 'Corrected the first set');
    await fireEvent.press(screen.getByLabelText('Save workout changes'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/workouts/saved-workout', {
      notes: 'Corrected the first set', exercises: [{
        exercise_name: 'Bench Press', muscle_group: 'chest', sets_completed: 2,
        weight_per_set: [137.5, 145], reps_per_set: [8, 6], notes: 'Controlled tempo',
        rpe: 8, video_url: 'https://test.local/video',
      }],
    }));
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['workouts'] });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('keeps edits on screen after the save fails, then allows a retry', async () => {
    jest.mocked(api.put).mockRejectedValueOnce(new Error('No connection'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      const screen = await render(<WorkoutHistoryEditScreen />);
      await fireEvent.changeText(screen.getByTestId('set-reps-0-0'), '9');
      await fireEvent.press(screen.getByLabelText('Save workout changes'));
      await waitFor(() => expect(alert).toHaveBeenCalledWith('Workout changes not saved', expect.stringContaining('entries stay on this screen')));
      expect(screen.getByTestId('set-reps-0-0').props.value).toBe('9');
      expect(mockGoBack).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByLabelText('Save workout changes'));
      await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    } finally { alert.mockRestore(); }
  });

  it('uses DTO allowlisted fields and preserves RPE, video and unedited sets', () => {
    const payload = loggedWorkoutEditPayload(mockHistory[0], loggedWorkoutExercises(mockHistory[0]), '');
    expect(Object.keys(payload.exercises[0]).sort()).toEqual([
      'exercise_name', 'muscle_group', 'notes', 'reps_per_set', 'rpe', 'sets_completed', 'video_url', 'weight_per_set',
    ]);
    expect(payload.exercises[0]).toMatchObject({ rpe: 8, weight_per_set: [135, 145], reps_per_set: [8, 6] });
  });
});

describe('coach builder exercise names (B-SESSION-2)', () => {
  it('resolves a server-loaded catalog id into its name without changing its id', async () => {
    const screen = await render(<CoachExerciseName id="seed:push-001" fallback="seed:push-001" prefix="1. " style={{}} />);
    await waitFor(() => expect(screen.getByText('1. Bench Press')).toBeTruthy());
    expect(exerciseLibraryApi.getById).toHaveBeenCalledWith('seed:push-001');
  });
  it('keeps a freshly selected name without needing a lookup', async () => {
    const screen = await render(<CoachExerciseName id="bench" fallback="Bench Press" prefix="1. " style={{}} />);
    expect(screen.getByText('1. Bench Press')).toBeTruthy();
    expect(exerciseLibraryApi.getById).not.toHaveBeenCalled();
  });
});

describe('active session controls', () => {
  it('uses the latest matching exercise and copies a previous set in one tap', async () => {
    function Harness() {
      const [set, setSet] = useState<SessionSet>({ weight: 0, reps: 10, completed: false });
      return <SetLogger set={set} exIdx={0} setIdx={0} onUpdate={(_e, _s, field, value) => setSet((s) => ({ ...s, [field]: value }))} onToggleComplete={() => undefined} previous={previousSets(mockHistory, 'bench press')[0]} styles={styles} colors={colors} />;
    }
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByLabelText('Use previous set 1: 135 pounds, 8 reps'));
    expect(screen.getByTestId('set-weight-0-0').props.value).toBe('135');
    expect(screen.getByTestId('set-reps-0-0').props.value).toBe('8');
  });
  it('adding an exercise starts pending sets with a working rest default', () => {
    expect(newSessionExercise({ id: 'curl', name: 'Curl', muscle: 'biceps', equipment: 'dumbbell' })).toMatchObject({
      restSec: 60, muscleGroup: 'arms', sets: Array(3).fill({ weight: 0, reps: 10, completed: false }),
    });
  });
  it('reordering keeps logged numbers and coach row identity attached to the exercise', () => {
    const second = { ...exercise, exerciseId: 'squat', workoutPlanExerciseId: 'plan-row' };
    expect(moveExercise([exercise, second], 1, -1)).toEqual([second, exercise]);
  });
  it('swapping keeps completed sets under the original name and uses pending replacement sets', () => {
    const replacement = { id: 'db-press', name: 'Dumbbell Press', muscle: 'chest', equipment: 'dumbbell' };
    const result = swapExercise([{ ...exercise, workoutPlanExerciseId: 'coach-row' }], 0, replacement);
    expect(result[0]).toMatchObject({ exerciseName: 'Bench Press', workoutPlanExerciseId: 'coach-row', notes: 'Slow', sets: [exercise.sets[0]] });
    expect(result[1]).toMatchObject({ exerciseName: 'Dumbbell Press', restSec: 90, sets: [{ weight: 0, reps: 6, completed: false }] });
    expect(result[1].workoutPlanExerciseId).toBeUndefined();
  });
  it('summary counts only completed sets and never invents a first-workout record', () => {
    expect(workoutSummary([exercise], mockHistory)).toEqual({
      exercises: 1, sets: 1, volume: 1240, records: [{ name: 'Bench Press', weight: 155 }],
    });
    expect(workoutSummary([exercise], []).records).toEqual([]);
    expect(workoutSummary([{ ...exercise, sets: [{ weight: 135, reps: 8, completed: true }] }], mockHistory).records).toEqual([]);
    expect(completedExercisePayload(exercise)).toMatchObject({ notes: 'Slow', sets_completed: 1, weight_per_set: [155], reps_per_set: [8] });
  });
});
