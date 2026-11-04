/**
 * FR-918R1 (LS-918 B1, class test). Save on the routine builder waits for a
 * library-id lookup still in flight, so the routine never saves a null library
 * id for an exercise the library has. While it waits, Save keeps its existing
 * busy state ("Saving routine…", disabled). A lookup that finds nothing, fails
 * or hangs never blocks the save: the exercise saves without the id (the
 * server stores null), as before. A row removed while its lookup runs is not
 * saved, an edit made while waiting is kept, and leaving the screen while
 * waiting saves nothing. Only navigation, storage and transport are fixtures.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const LIB_PRESS = '3f1c2b9e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const LIB_ROW = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockGet = jest.fn();
let mockParams: Record<string, unknown> = {};
let mockRoutines: unknown[] = [];

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../hooks/useApi', () => ({
  useRoutines: () => ({ data: mockRoutines }),
  useCreateRoutine: () => ({ mutate: mockCreate, isPending: false }),
  useUpdateRoutine: () => ({ mutate: mockUpdate, isPending: false }),
  useDeleteRoutine: () => ({ mutate: jest.fn() }),
}));
jest.mock('../db/workoutDb', () => ({
  getAllExercises: jest.fn(async () => [
    { id: 'ex_test', name: 'Barbell Bench Press', muscle: 'chest', equipment: 'barbell' },
  ]),
}));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

import RoutineBuilderScreen, { LIBRARY_ID_WAIT_MS } from '../screens/client/RoutineBuilderScreen';

type Settle = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
let lookup: Settle;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockRoutines = [];
  mockGet.mockImplementation(() => new Promise((resolve, reject) => { lookup = { resolve, reject }; }));
});
afterEach(() => jest.useRealTimers());

const KEPT = {
  id: 'existing', name: 'Push', exercises: [{
    id: 'row-kept', exercise_name: 'Kept row', muscle_group: 'BACK',
    default_sets: 3, default_reps: 8, default_rest_seconds: 60, catalog_exercise_id: LIB_ROW,
  }],
};

// Leaving the screen: the navigator unmounts it.
let leave!: () => void;
function Host() {
  const [shown, setShown] = React.useState(true);
  leave = () => setShown(false);
  return shown ? <RoutineBuilderScreen /> : null;
}

async function addBenchAndSave(method: 'POST' | 'PUT', screen: React.ReactElement = <RoutineBuilderScreen />) {
  if (method === 'PUT') {
    mockParams = { routineId: 'existing' };
    mockRoutines = [KEPT];
  }
  const view = await render(screen);
  if (method === 'PUT') {
    await waitFor(() => expect(view.getByLabelText('Routine name').props.value).toBe('Push'));
  } else {
    await fireEvent.changeText(view.getByLabelText('Routine name'), 'Push');
  }
  await fireEvent.press(view.getByLabelText('Add exercise'));
  await waitFor(() => expect(view.getByLabelText('Add Barbell Bench Press')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Add Barbell Bench Press'));
  expect(mockGet).toHaveBeenCalledWith('/exercise-catalog/barbell-bench-press');
  await fireEvent.press(view.getByLabelText('Save routine'));
  return view;
}

const body = (method: 'POST' | 'PUT') => {
  const mutation = method === 'POST' ? mockCreate : mockUpdate;
  expect(mutation).toHaveBeenCalledTimes(1);
  const arg = mutation.mock.calls[0][0];
  return (method === 'POST' ? arg : arg.data) as { exercises: Array<Record<string, unknown>> };
};
const bench = (exercises: Array<Record<string, unknown>>) =>
  exercises.find((row) => row.exercise_name === 'Barbell Bench Press');

describe.each(['POST', 'PUT'] as const)('%s', (method) => {
  const mutation = () => (method === 'POST' ? mockCreate : mockUpdate);

  it('waits in the existing busy state, then saves the found library id once', async () => {
    const view = await addBenchAndSave(method);
    expect(mutation()).not.toHaveBeenCalled();
    const save = view.getByLabelText('Save routine');
    expect(view.getByText('Saving routine…')).toBeTruthy();
    expect(save.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(save);
    await act(async () => { lookup.resolve({ data: { id: LIB_PRESS } }); });
    await waitFor(() => expect(mutation()).toHaveBeenCalledTimes(1));
    expect(bench(body(method).exercises)).toMatchObject({ catalog_exercise_id: LIB_PRESS });
    expect(view.getByText('Save routine')).toBeTruthy();
  });

  it.each([
    ['the library has no such exercise (404)', { response: { status: 404 } }],
    ['the lookup fails (no network)', { message: 'Network Error' }],
  ])('saves without the id when %s', async (_label, failure) => {
    await addBenchAndSave(method);
    expect(mutation()).not.toHaveBeenCalled();
    await act(async () => { lookup.reject(failure); });
    await waitFor(() => expect(mutation()).toHaveBeenCalledTimes(1));
    const row = bench(body(method).exercises);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty('catalog_exercise_id');
  });

  it('saves without the id when the lookup has not answered in time', async () => {
    jest.useFakeTimers();
    await addBenchAndSave(method);
    expect(mutation()).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(LIBRARY_ID_WAIT_MS - 1); });
    expect(mutation()).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(mutation()).toHaveBeenCalledTimes(1);
    expect(bench(body(method).exercises)).not.toHaveProperty('catalog_exercise_id');
  });

  it('does not save a row removed while its lookup runs, and keeps edits made while waiting', async () => {
    const view = await addBenchAndSave(method);
    const index = method === 'PUT' ? 2 : 1;
    if (method === 'PUT') {
      await fireEvent.changeText(view.getByLabelText('Sets for Kept row, exercise 1'), '5');
      await fireEvent.press(view.getByLabelText(`Remove Barbell Bench Press, exercise ${index}`));
      await act(async () => { lookup.resolve({ data: { id: LIB_PRESS } }); });
      await waitFor(() => expect(mutation()).toHaveBeenCalledTimes(1));
      expect(body(method).exercises).toEqual([expect.objectContaining({
        exercise_name: 'Kept row', default_sets: 5, catalog_exercise_id: LIB_ROW,
      })]);
    } else {
      await fireEvent.changeText(view.getByLabelText(`Sets for Barbell Bench Press, exercise ${index}`), '5');
      await act(async () => { lookup.resolve({ data: { id: LIB_PRESS } }); });
      await waitFor(() => expect(mutation()).toHaveBeenCalledTimes(1));
      expect(bench(body(method).exercises)).toMatchObject({ default_sets: 5, catalog_exercise_id: LIB_PRESS });
    }
  });

  it('saves nothing when the member leaves the screen while Save waits', async () => {
    const view = await addBenchAndSave(method, <Host />);
    await act(async () => { leave(); });
    expect(view.queryByLabelText('Save routine')).toBeNull();
    await act(async () => { lookup.resolve({ data: { id: LIB_PRESS } }); });
    expect(mutation()).not.toHaveBeenCalled();
  });
});

it('saves at once, with the id, when the lookup already answered', async () => {
  mockGet.mockResolvedValue({ data: { id: LIB_PRESS } });
  const view = await render(<RoutineBuilderScreen />);
  await fireEvent.changeText(view.getByLabelText('Routine name'), 'Push');
  await fireEvent.press(view.getByLabelText('Add exercise'));
  await waitFor(() => expect(view.getByLabelText('Add Barbell Bench Press')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Add Barbell Bench Press'));
  await act(async () => { await Promise.resolve(); });
  await fireEvent.press(view.getByLabelText('Save routine'));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(bench(body('POST').exercises)).toMatchObject({ catalog_exercise_id: LIB_PRESS });
});
