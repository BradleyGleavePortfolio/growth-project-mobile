/**
 * LS-918 B1: a supported add-and-save on a slow connection must not
 * silently save a null identity while the successful lookup is pending.
 * Product code is unmodified. Only navigation, storage and transport are fixtures.
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

import RoutineBuilderScreen from '../screens/client/RoutineBuilderScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockRoutines = [];
});

it.each(['POST', 'PUT'])(
  'LS-918 B1: %s does not lose the catalog ID when Save is pressed before a successful lookup answers',
  async (method) => {
    if (method === 'PUT') {
      mockParams = { routineId: 'existing' };
      mockRoutines = [{
        id: 'existing', name: 'Push', exercises: [{
          id: 'row-kept', exercise_name: 'Kept row', muscle_group: 'BACK',
          default_sets: 3, default_reps: 8, default_rest_seconds: 60,
          catalog_exercise_id: LIB_ROW,
        }],
      }];
    }
    let answer!: (value: unknown) => void;
    mockGet.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const view = await render(<RoutineBuilderScreen />);
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

    const mutation = method === 'POST' ? mockCreate : mockUpdate;
    // Either awaiting the lookup or disabling Save is valid; a null write now is not.
    expect(mutation).not.toHaveBeenCalled();
    await act(async () => { answer({ data: { id: LIB_PRESS } }); });
    // A gated Save needs one more tap; an awaiting Save may already have submitted.
    if (!mutation.mock.calls.length) {
      await fireEvent.press(view.getByLabelText('Save routine'));
    }
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
    const arg = mutation.mock.calls[0][0];
    const body = method === 'POST' ? arg : arg.data;
    expect(body.exercises).toEqual(expect.arrayContaining([
      expect.objectContaining({
        exercise_name: 'Barbell Bench Press',
        catalog_exercise_id: LIB_PRESS,
      }),
    ]));
    if (method === 'PUT') {
      expect(body.exercises[0].catalog_exercise_id).toBe(LIB_ROW);
    }
  },
);
