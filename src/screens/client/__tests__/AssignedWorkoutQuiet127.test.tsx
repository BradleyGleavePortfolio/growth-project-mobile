import React from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ClientWorkoutViewerScreen from '../ClientWorkoutViewerScreen';
import WorkoutHistoryEditScreen from '../WorkoutHistoryEditScreen';
import { darkTokens, lightTokens } from '../../../theme/tokens';
import type { ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';

const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockRefetch = jest.fn();
const mockPut = jest.fn();
const mockInvalidate = jest.fn();
let mockDark = false;
let mockLoading = false;
let mockError = false;
let mockAssignments: ClientWorkoutAssignmentWithPlan[] = [];
const mockWorkout = { id: 'saved-1', workout_name: 'Upper A', notes: 'Steady',
  exercises: [{ exercise_name: 'Bench press', muscle_group: 'chest', sets_completed: 1,
    weight_per_set: [95], reps_per_set: [8], notes: 'Pause', rpe: 7, video_url: 'saved-video' }] };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockBack }),
  useRoute: () => ({ params: { workout: JSON.stringify(mockWorkout) } }),
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, isLoading: mockLoading,
    isError: mockError, isRefetching: false, refetch: mockRefetch }),
}));
jest.mock('../../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { bench: 'Bench press' }, loading: false }),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { put: (...args: unknown[]) => mockPut(...args) } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens')[mockDark ? 'darkTokens' : 'lightTokens'] }),
}));
const assignment = (id: string, completed = false): ClientWorkoutAssignmentWithPlan => ({
  id, workout_plan_id: id, client_id: 'client', assigned_by_coach_id: 'coach',
  scheduled_for: '2025-01-08T12:00:00Z', completed_at: completed ? '2025-01-08T13:00:00Z' : null,
  post_rpe: completed ? 7 : null, post_notes: null,
  workout_plan: { id, coach_id: 'coach', name: id, type: 'strength', exercises: [],
    duration_estimate_minutes: 30, created_at: '', updated_at: '', archived_at: null },
});
beforeEach(() => {
  jest.clearAllMocks();
  mockDark = mockLoading = mockError = false;
  mockAssignments = [];
  mockPut.mockResolvedValue({});
});

it('does not invent a coach relationship for an empty assignment list', async () => {
  const view = await render(<ClientWorkoutViewerScreen />);
  expect(view.getByText('No workouts assigned')).toBeTruthy();
  expect(view.queryByText(/Your coach has not assigned/)).toBeNull();
});
it('keeps every pending/completed assignment route and refresh, without calling past work upcoming', async () => {
  mockAssignments = [assignment('Upper A'), assignment('Lower A', true)];
  const view = await render(<ClientWorkoutViewerScreen />);
  expect(view.getByText('To complete')).toBeTruthy();
  expect(view.getByText('Completed RPE 7')).toBeTruthy();
  for (const name of ['Upper A', 'Lower A']) {
    await fireEvent.press(view.getByRole('button', { name: `Open workout ${name}` }));
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutAssignmentDetail', { assignmentId: name });
  }
  await act(async () => { view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh(); });
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});
it('keeps loading and actionable error instructions', async () => {
  mockLoading = true;
  const view = await render(<ClientWorkoutViewerScreen />);
  expect(view.getByText('Loading...')).toBeTruthy();
  mockLoading = false; mockError = true;
  await view.rerender(<ClientWorkoutViewerScreen />);
  expect(view.getByText('Could not load your workouts. Pull to retry.')).toBeTruthy();
});
it.each([false, true])('keeps assignment rows readable and theme-aware (dark=%s)', async (dark) => {
  mockDark = dark; mockAssignments = [assignment('Upper A', true)];
  const view = await render(<ClientWorkoutViewerScreen />);
  const row = StyleSheet.flatten(view.getByRole('button', { name: 'Open workout Upper A' }).props.style);
  expect(row.borderBottomColor).toBe((dark ? darkTokens : lightTokens).border);
  expect(row.minHeight).toBeGreaterThanOrEqual(44);
  expect(row.backgroundColor).toBeUndefined();
  expect(row.opacity).toBeUndefined();
  expect(view.queryByText('To complete')).toBeNull();
});
it('shows named prescribed rows and coach-approved set counts without invented previous numbers', async () => {
  const a = assignment('Upper A');
  a.workout_plan.exercises = [{ id: 'row-1', workout_plan_id: a.id, exercise_external_id: 'bench',
    order: 1, sets: 3, reps_or_duration_seconds: 8, weight_lbs: 95,
    rest_seconds: 60, superset_group_id: null, notes: null }];
  a.roman_adjusted_sets = [{ order: 1, sets: 2 }];
  mockAssignments = [a];
  const view = await render(<ClientWorkoutViewerScreen />);
  expect(view.getByText('Bench press')).toBeTruthy();
  expect(view.getByText('2 sets × 8 reps / sec · 95 lb prescribed')).toBeTruthy();
  expect(view.queryByText(/Last time/)).toBeNull();
});
it.each([false, true])('uses semantic-theme hairlines and one serif title in edit (dark=%s)', async (dark) => {
  mockDark = dark;
  const sc = dark ? darkTokens : lightTokens;
  const view = await render(<WorkoutHistoryEditScreen />);
  expect(StyleSheet.flatten(view.getByText('Upper A').props.style).fontFamily).toBe('CormorantGaramond_400Regular');
  const input = StyleSheet.flatten(view.getByTestId('set-weight-0-0').props.style);
  expect(input.backgroundColor).toBe(sc.bgPrimary);
  expect(input.borderBottomColor).toBe(sc.border);
  expect(input.minHeight).toBeGreaterThanOrEqual(44);
  const save = StyleSheet.flatten(view.getByLabelText('Save workout changes').props.style);
  expect(save.backgroundColor).toBe(sc.accent);
  expect(save.minHeight).toBeGreaterThanOrEqual(44);
});
it('keeps edits, save payload, query invalidation and back navigation', async () => {
  const view = await render(<WorkoutHistoryEditScreen />);
  await fireEvent.changeText(view.getByTestId('set-weight-0-0'), '100');
  await fireEvent.changeText(view.getByTestId('set-reps-0-0'), '9');
  await fireEvent.changeText(view.getByLabelText('Notes for Bench press'), 'Smooth');
  await fireEvent.changeText(view.getByLabelText('Workout notes'), 'Updated');
  await fireEvent.press(view.getByLabelText('Save workout changes'));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockPut).toHaveBeenCalledWith('/workouts/saved-1', { notes: 'Updated',
    exercises: [{ ...mockWorkout.exercises[0], weight_per_set: [100], reps_per_set: [9], notes: 'Smooth' }] });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['workouts'] });
});
it('keeps immediate cancel and both discard-dialog actions', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render(<WorkoutHistoryEditScreen />);
  await fireEvent.press(view.getByLabelText('Cancel workout editing'));
  expect(mockBack).toHaveBeenCalledTimes(1);
  mockBack.mockClear();
  await fireEvent.changeText(view.getByLabelText('Workout notes'), 'Draft');
  await fireEvent.press(view.getByLabelText('Cancel workout editing'));
  expect(mockBack).not.toHaveBeenCalled();
  const actions = alert.mock.calls[0][2];
  expect(actions?.[0]).toMatchObject({ text: 'Keep editing', style: 'cancel' });
  actions?.[1].onPress?.();
  expect(mockBack).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});
it('retains a failed save draft for retry', async () => {
  mockPut.mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render(<WorkoutHistoryEditScreen />);
  await fireEvent.changeText(view.getByLabelText('Workout notes'), 'Draft');
  await fireEvent.press(view.getByLabelText('Save workout changes'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Workout changes not saved', expect.any(String)));
  expect(mockBack).not.toHaveBeenCalled();
  expect(view.getByLabelText('Workout notes').props.value).toBe('Draft');
  await fireEvent.press(view.getByLabelText('Save workout changes'));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  alert.mockRestore();
});
