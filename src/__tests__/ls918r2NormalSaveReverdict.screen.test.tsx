/**
 * Normal add-then-Save paths under OPERATOR RULING 6628841125.
 * Product code and the existing add-during-Save edge test are unchanged.
 * Navigation, routine storage hooks and transport are fixtures.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const PRESS = '3f1c2b9e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const ROW = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const KEEP_PRESS = 'a1111111-1111-4111-8111-111111111111';
const KEEP_ROW = 'b2222222-2222-4222-8222-222222222222';
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

import RoutineBuilderScreen, { LIBRARY_ID_WAIT_MS } from '../screens/client/RoutineBuilderScreen';

type Method = 'POST' | 'PUT';
type Answer = { resolve: (value: unknown) => void; reject: (value: unknown) => void };
const answers = new Map<string, Answer>();
const saved = [
  { name: 'Saved Press', id: KEEP_PRESS },
  { name: 'Saved Row', id: KEEP_ROW },
];
beforeEach(() => {
  jest.clearAllMocks();
  answers.clear();
  mockParams = {};
  mockRoutines = [];
  mockGet.mockImplementation((url: string) => new Promise((resolve, reject) => {
    answers.set(url, { resolve, reject });
  }));
});
afterEach(() => jest.useRealTimers());

async function open(method: Method) {
  if (method === 'PUT') {
    mockParams = { routineId: 'existing' };
    mockRoutines = [{
      id: 'existing', name: 'Upper', exercises: saved.map((row, i) => ({
        id: `kept-${i}`, exercise_name: row.name, muscle_group: 'BACK',
        default_sets: 3, default_reps: 8, default_rest_seconds: 60,
        catalog_exercise_id: row.id,
      })),
    }];
  }
  const view = await render(<RoutineBuilderScreen />);
  if (method === 'PUT') {
    await waitFor(() => expect(view.getByLabelText('Routine name').props.value).toBe('Upper'));
  } else {
    await fireEvent.changeText(view.getByLabelText('Routine name'), 'Upper');
  }
  const add = async (name: string) => {
    await fireEvent.press(view.getByLabelText('Add exercise'));
    await waitFor(() => expect(view.getByLabelText(`Add ${name}`)).toBeTruthy());
    await fireEvent.press(view.getByLabelText(`Add ${name}`));
  };
  await add('Barbell Bench Press');
  await add('Seated Cable Row');
  expect(answers.size).toBe(2);
  return view;
}
const mutation = (method: Method) => method === 'POST' ? mockCreate : mockUpdate;
const reply = async (slug: string, id: string | null) => {
  await act(async () => {
    answers.get(`/exercise-catalog/${slug}`)!.resolve({ data: { id } });
  });
};
const check = (method: Method, rows: Array<{ name: string; id?: string }>, keep = method === 'PUT' ? saved : []) => {
  expect(mutation(method)).toHaveBeenCalledTimes(1);
  const arg = mutation(method).mock.calls[0][0];
  const body = method === 'POST' ? arg : arg.data;
  const expected = [...keep, ...rows];
  expect(body.exercises).toHaveLength(expected.length);
  body.exercises.forEach((row: Record<string, unknown>, index: number) => {
    expect(row.exercise_name).toBe(expected[index].name);
    expect(row.order_index).toBe(index);
    if (expected[index].id) expect(row.catalog_exercise_id).toBe(expected[index].id);
    else expect(row).not.toHaveProperty('catalog_exercise_id');
    expect(row).not.toHaveProperty('lookupKey');
  });
  return body;
};
const pair = [{ name: 'Barbell Bench Press', id: PRESS }, { name: 'Seated Cable Row', id: ROW }];

describe.each(['POST', 'PUT'] as const)('normal %s', (method) => {
  it('adds all rows before Save and keeps each id when slow replies arrive out of order', async () => {
    const view = await open(method);
    await fireEvent.press(view.getByLabelText('Save routine'));
    expect(mutation(method)).not.toHaveBeenCalled();
    const benchIndex = method === 'PUT' ? 3 : 1;
    await fireEvent.changeText(view.getByLabelText(`Sets for Barbell Bench Press, exercise ${benchIndex}`), '5');
    await reply('seated-cable-row', ROW);
    expect(mutation(method)).not.toHaveBeenCalled();
    await reply('barbell-bench-press', PRESS);
    const body = check(method, pair);
    expect(body.exercises.find((row: { exercise_name: string }) => row.exercise_name === pair[0].name).default_sets).toBe(5);
  });

  it('keeps identity with its row after reordering before Save', async () => {
    const view = await open(method);
    await fireEvent.press(view.getByLabelText('Move Seated Cable Row up'));
    await fireEvent.press(view.getByLabelText('Save routine'));
    await reply('barbell-bench-press', PRESS);
    expect(mutation(method)).not.toHaveBeenCalled();
    await reply('seated-cable-row', ROW);
    check(method, [pair[1], pair[0]]);
  });

  it('does not wait for or restore a row removed before Save', async () => {
    const view = await open(method);
    await fireEvent.press(view.getByLabelText(`Remove Barbell Bench Press, exercise ${method === 'PUT' ? 3 : 1}`));
    await fireEvent.press(view.getByLabelText('Save routine'));
    await reply('seated-cable-row', ROW);
    check(method, [pair[1]]);
    await reply('barbell-bench-press', PRESS);
    check(method, [pair[1]]);
  });

  it('does not restore or misplace the id of a row removed while Save waits', async () => {
    const view = await open(method);
    await fireEvent.press(view.getByLabelText('Save routine'));
    await fireEvent.press(view.getByLabelText(`Remove Barbell Bench Press, exercise ${method === 'PUT' ? 3 : 1}`));
    await reply('barbell-bench-press', PRESS);
    expect(mutation(method)).not.toHaveBeenCalled();
    await reply('seated-cable-row', ROW);
    check(method, [pair[1]]);
  });

  it.each(['network', '404', 'no matching id'] as const)(
    'keeps the successful row id separate from a %s lookup',
    async (failure) => {
      const view = await open(method);
      await fireEvent.press(view.getByLabelText('Save routine'));
      await reply('barbell-bench-press', PRESS);
      expect(mutation(method)).not.toHaveBeenCalled();
      if (failure === 'no matching id') {
        await reply('seated-cable-row', null);
      } else {
        await act(async () => {
          answers.get('/exercise-catalog/seated-cable-row')!.reject(
            failure === '404' ? { response: { status: 404 } } : { message: 'Network Error' },
          );
        });
      }
      check(method, [pair[0], { name: pair[1].name }]);
    },
  );

  it('uses one eight-second bound and keeps an answered id when the other lookup hangs', async () => {
    jest.useFakeTimers();
    const view = await open(method);
    await fireEvent.press(view.getByLabelText('Save routine'));
    await act(async () => { jest.advanceTimersByTime(2500); });
    await reply('barbell-bench-press', PRESS);
    await act(async () => { jest.advanceTimersByTime(LIBRARY_ID_WAIT_MS - 2500 - 1); });
    expect(mutation(method)).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); });
    check(method, [pair[0], { name: pair[1].name }]);
    await reply('seated-cable-row', ROW);
    check(method, [pair[0], { name: pair[1].name }]);
  });

  it('saves immediately with every id when both lookups answered before Save', async () => {
    const view = await open(method);
    await reply('seated-cable-row', ROW);
    await reply('barbell-bench-press', PRESS);
    await fireEvent.press(view.getByLabelText('Save routine'));
    check(method, pair);
  });
});

it('editing a saved routine preserves the remaining saved id after removing another saved row', async () => {
  const view = await open('PUT');
  await fireEvent.press(view.getByLabelText('Remove Saved Press, exercise 1'));
  await fireEvent.changeText(view.getByLabelText('Sets for Saved Row, exercise 1'), '5');
  await fireEvent.press(view.getByLabelText('Save routine'));
  await reply('seated-cable-row', ROW);
  await reply('barbell-bench-press', PRESS);
  const body = check('PUT', pair, [saved[1]]);
  expect(body.exercises[0].default_sets).toBe(5);
});
