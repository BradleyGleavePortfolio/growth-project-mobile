import React from 'react';
import { Alert, PanResponder, StyleSheet, type GestureResponderEvent } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import RoutineBuilderScreen from '../RoutineBuilderScreen';

const mockBack = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockCatalog = jest.fn();
let mockRoutineId: string | undefined;
let mockBusy = false;
const mockRoutine = { id: 'routine', name: 'Upper body', exercises: [
  { exercise_id: 'press', exercise_name: 'Bench press', default_sets: 3, default_reps: 10, default_rest_seconds: 60, muscle_group: 'CHEST' },
  { exercise_id: 'row', exercise_name: 'Row', default_sets: 4, default_reps: 8, default_rest_seconds: 90, muscle_group: 'BACK' },
] };
const mockRoutineData = [mockRoutine];
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockBack }),
  useRoute: () => ({ params: { routineId: mockRoutineId } }),
}));
jest.mock('../../../hooks/useApi', () => ({
  useRoutines: () => ({ data: mockRoutineData }),
  useCreateRoutine: () => ({ mutate: mockCreate, isPending: mockBusy }),
  useUpdateRoutine: () => ({ mutate: mockUpdate, isPending: mockBusy }),
  useDeleteRoutine: () => ({ mutate: mockDelete }),
}));
jest.mock('../../../db/workoutDb', () => ({ getAllExercises: () => mockCatalog() }));
jest.mock('../../../theme/ThemeProvider', () => ({
  // semanticColors: the Screen wrapper (REDO-INSETS-133) reads the page colour from it.
  useTheme: () => ({ colors: new Proxy({}, { get: (_t, k) => String(k) }), semanticColors: new Proxy({}, { get: (_t, k) => String(k) }) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);

beforeEach(() => {
  jest.clearAllMocks();
  mockRoutineId = undefined;
  mockBusy = false;
  mockCatalog.mockResolvedValue([
    { id: 'press', name: 'Bench press', muscle: 'chest', equipment: 'Barbell' },
    { id: 'row', name: 'Row', muscle: 'back', equipment: 'Cable' },
  ]);
});
async function press(label: string) { await fireEvent.press(screen.getByLabelText(label)); }
async function add(name: string) {
  await press('Add exercise');
  await screen.findByLabelText(`Add ${name}`);
  await press(`Add ${name}`);
}

it('keeps name, picker search/filter/select, all three fields, create and back reachable', async () => {
  await render(<RoutineBuilderScreen />);
  await fireEvent.changeText(screen.getByLabelText('Routine name'), 'Push day');
  await press('Add exercise');
  await screen.findByLabelText('Add Bench press');
  for (const muscle of ['All', 'chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'core', 'full body', 'cardio']) {
    expect(screen.getByLabelText(`Filter ${muscle}`)).toBeTruthy();
  }
  await press('Filter chest');
  expect(screen.queryByLabelText('Add Row')).toBeNull();
  await press('Filter All');
  await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'Row');
  expect(screen.queryByLabelText('Add Bench press')).toBeNull();
  await press('Close exercise picker');
  await add('Bench press');
  for (const [field, value] of [['Sets', '5'], ['Reps', '6'], ['Rest seconds', '75']]) {
    await fireEvent.changeText(screen.getByLabelText(`${field} for Bench press, exercise 1`), value);
  }
  await press('Edit Bench press, exercise 1');
  await press('Save routine');
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Push day', exercises: [
    expect.objectContaining({ exercise_name: 'Bench press', default_sets: 5, default_reps: 6, default_rest_seconds: 75 }),
  ] }), expect.any(Object));
  await act(async () => mockCreate.mock.calls[0][1].onSuccess());
  expect(mockBack).toHaveBeenCalledTimes(1);
  await press('Cancel routine');
  expect(mockBack).toHaveBeenCalledTimes(2);
});
it('keeps existing order, both reorder directions, remove and update reachable', async () => {
  mockRoutineId = 'routine';
  const drag = jest.spyOn(PanResponder, 'create');
  await render(<RoutineBuilderScreen />);
  expect(screen.getByLabelText('Routine name').props.value).toBe('Upper body');
  await press('Move Bench press down');
  expect(screen.getByLabelText('Sets for Row, exercise 1').props.value).toBe('4');
  await press('Move Bench press up');
  expect(screen.getByLabelText('Drag Bench press to reorder')).toBeTruthy();
  await fireEvent(screen.getByTestId('exercise-row-0'), 'layout', { nativeEvent: { layout: { y: 0, height: 200 } } });
  await fireEvent(screen.getByTestId('exercise-row-1'), 'layout', { nativeEvent: { layout: { y: 200, height: 200 } } });
  await act(async () => drag.mock.calls[drag.mock.calls.length - 2][0].onPanResponderRelease?.({} as GestureResponderEvent,
    { stateID: 0, moveX: 0, moveY: 250, x0: 0, y0: 0, dx: 0, dy: 250, vx: 0, vy: 0, numberActiveTouches: 0, _accountsForMovesUpTo: 0 }));
  expect(screen.getByLabelText('Sets for Row, exercise 1').props.value).toBe('4');
  await press('Move Bench press up');
  drag.mockRestore();
  await press('Remove Row, exercise 2');
  await press('Save routine');
  expect(mockUpdate.mock.calls[0][0]).toEqual({ id: 'routine', data: expect.objectContaining({
    exercises: [expect.objectContaining({ exercise_name: 'Bench press' })],
  }) });
  await act(async () => mockUpdate.mock.calls[0][1].onSuccess());
  expect(mockBack).toHaveBeenCalled();
});
it('keeps delete confirmation and cancel without deleting prematurely', async () => {
  mockRoutineId = 'routine';
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<RoutineBuilderScreen />);
  await press('Delete routine');
  expect(mockDelete).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2];
  expect(buttons?.find(b => b.text === 'Cancel')?.style).toBe('cancel');
  await act(async () => buttons?.find(b => b.text === 'Delete')?.onPress?.());
  expect(mockDelete).toHaveBeenCalledWith('routine', expect.any(Object));
  await act(async () => mockDelete.mock.calls[0][1].onError(null));
  expect(alert).toHaveBeenLastCalledWith("Couldn't delete routine", 'Check your connection and delete the routine again.');
  await act(async () => mockDelete.mock.calls[0][1].onSuccess());
  expect(mockBack).toHaveBeenCalled();
  alert.mockRestore();
});
it('gives specific validation and keeps save failure on the builder', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<RoutineBuilderScreen />);
  await press('Save routine');
  expect(alert).toHaveBeenLastCalledWith('Routine name needed', 'Give your routine a name.');
  await fireEvent.changeText(screen.getByLabelText('Routine name'), 'Push day');
  await press('Save routine');
  expect(alert).toHaveBeenLastCalledWith('Exercise needed', 'Add at least one exercise.');
  await add('Bench press');
  await press('Save routine');
  await act(async () => mockCreate.mock.calls[0][1].onError(null));
  expect(alert).toHaveBeenLastCalledWith("Couldn't save routine", 'Check your connection and save the routine again.');
  expect(mockBack).not.toHaveBeenCalled();
  alert.mockRestore();
});
it('makes picker loading, error/retry and empty state factual', async () => {
  mockCatalog.mockReturnValue(new Promise(() => {}));
  await render(<RoutineBuilderScreen />);
  await press('Add exercise');
  expect(screen.getByText('Loading exercises.')).toBeTruthy();
  await press('Close exercise picker');
  mockCatalog.mockRejectedValueOnce(new Error('offline'));
  await press('Add exercise');
  await screen.findByText('Exercises did not load. Check your connection and try again.');
  mockCatalog.mockResolvedValueOnce([]);
  await press('Try loading exercises again');
  await screen.findByText('No exercises match. Try another search or muscle group.');
});
it('uses a hairline serif name, readable fields and 44-point labelled icons', async () => {
  mockRoutineId = 'routine';
  await render(<RoutineBuilderScreen />);
  const name = StyleSheet.flatten(screen.getByLabelText('Routine name').props.style);
  expect(name.fontFamily).toBe('CormorantGaramond_400Regular');
  expect(name.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
  for (const label of ['Cancel routine', 'Delete routine', 'Move Bench press down', 'Edit Bench press, exercise 1', 'Remove Bench press, exercise 1']) {
    expect(StyleSheet.flatten(screen.getByLabelText(label).props.style).minHeight).toBeGreaterThanOrEqual(44);
  }
  expect(StyleSheet.flatten(screen.getAllByText('Sets')[0].props.style).fontSize).toBeGreaterThanOrEqual(13);
});
it('shows a factual saving state and disables the one primary action', async () => {
  mockBusy = true;
  await render(<RoutineBuilderScreen />);
  expect(screen.getByText('Saving routine…')).toBeTruthy();
  expect(screen.getByLabelText('Save routine')).toBeDisabled();
});
