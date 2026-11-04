/**
 * LS-918R2 B1: edits remain enabled while Save waits. A newly added row's
 * successful pending lookup must be settled before either POST or PUT.
 * Only navigation, storage and transport are fixtures.
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
    { id: 'ex_press', name: 'Barbell Bench Press', muscle: 'chest', equipment: 'barbell' },
    { id: 'ex_row', name: 'Seated Cable Row', muscle: 'back', equipment: 'cable' },
  ]),
}));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

import RoutineBuilderScreen from '../screens/client/RoutineBuilderScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockRoutines = [];
});

it.each(['POST', 'PUT'])(
  'LS-918R2 B1: %s includes a successful library id for a row added while Save waits',
  async (method) => {
    if (method === 'PUT') {
      mockParams = { routineId: 'existing' };
      mockRoutines = [{
        id: 'existing', name: 'Upper', exercises: [{
          id: 'kept', exercise_name: 'Kept row', muscle_group: 'BACK',
          default_sets: 3, default_reps: 8, default_rest_seconds: 60,
        }],
      }];
    }
    const answers = new Map<string, (value: unknown) => void>();
    mockGet.mockImplementation((url: string) => new Promise((resolve) => answers.set(url, resolve)));
    const view = await render(<RoutineBuilderScreen />);
    if (method === 'POST') {
      await fireEvent.changeText(view.getByLabelText('Routine name'), 'Upper');
    } else {
      await waitFor(() => expect(view.getByLabelText('Routine name').props.value).toBe('Upper'));
    }
    const add = async (name: string) => {
      await fireEvent.press(view.getByLabelText('Add exercise'));
      await waitFor(() => expect(view.getByLabelText(`Add ${name}`)).toBeTruthy());
      await fireEvent.press(view.getByLabelText(`Add ${name}`));
    };
    await add('Barbell Bench Press');
    await fireEvent.press(view.getByLabelText('Save routine'));
    expect(view.getByText('Saving routine…')).toBeTruthy();
    await add('Seated Cable Row');
    const mutation = method === 'POST' ? mockCreate : mockUpdate;
    expect(mutation).not.toHaveBeenCalled();
    await act(async () => {
      answers.get('/exercise-catalog/barbell-bench-press')!({ data: { id: LIB_PRESS } });
    });
    // The second lookup is still in flight, inside the original eight-second
    // deadline. Resolving the first lookup must not write the second as null.
    expect(mutation).not.toHaveBeenCalled();
    await act(async () => {
      answers.get('/exercise-catalog/seated-cable-row')!({ data: { id: LIB_ROW } });
    });
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
    const arg = mutation.mock.calls[0][0];
    const body = method === 'POST' ? arg : arg.data;
    expect(body.exercises).toEqual(expect.arrayContaining([
      expect.objectContaining({ exercise_name: 'Barbell Bench Press', catalog_exercise_id: LIB_PRESS }),
      expect.objectContaining({ exercise_name: 'Seated Cable Row', catalog_exercise_id: LIB_ROW }),
    ]));
  },
);
