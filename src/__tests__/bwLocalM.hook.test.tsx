/**
 * BW-LOCAL-M (agent 203, owner #197-E10): the one body-weight map of the live
 * workout, every id shape. A catalog answer (GET /exercises/:id) always wins;
 * an id the catalog can never answer (phone-made, or a library uuid) is looked
 * up in the phone's own list by id, then by name slug; anything else reads as
 * main. Without names (m#928's callers) the list is never read.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBodyWeightExercises } from '../hooks/useBodyWeightExercises';

const UNRESOLVED_UUID = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
const RESOLVING_UUID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const CATALOG: Record<string, string> = { 'seed:chest-009': 'barbell', 'seed:pull-001': 'body weight', [RESOLVING_UUID]: 'barbell' };
const mockGetById = jest.fn();
jest.mock('../api/exerciseLibraryApi', () => ({
  exerciseLibraryApi: { getById: (...a: unknown[]) => mockGetById(...a) },
}));
const LIST = [
  { id: 'ex_pushups', name: 'Push-Ups', muscle: 'chest', equipment: 'bodyweight', instructions: '' },
  { id: 'ex_squat', name: 'Barbell Squat', muscle: 'legs', equipment: 'barbell', instructions: '' },
];
const mockGetAllExercises = jest.fn();
jest.mock('../db/workoutDb', () => ({ getAllExercises: (...a: unknown[]) => mockGetAllExercises(...a) }));

let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
  mockGetById.mockImplementation((id: string) => (CATALOG[id]
    ? Promise.resolve({ data: { id, name: id, equipment: CATALOG[id] } })
    : Promise.reject({ response: { status: id === UNRESOLVED_UUID ? 500 : 404 } })));
  mockGetAllExercises.mockImplementation(async () => LIST);
});
afterEach(() => qc.clear());

const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const settled = (id: string) => ['success', 'error'].includes(qc.getQueryState(['exercises', 'by-id', id])?.status ?? '');

// id | name | expected map value (undefined = absent, reads as main) | list read?
it.each([
  ['ex_pushups', 'Push-Ups', true, true],                       // Add / Swap: list by id
  ['ex_before_reseed', 'Push-Ups', true, true],                 // re-seeded list: by name
  ['routine:routine-7/push-ups', 'Push-Ups', true, true],       // saved routine, no library id
  [UNRESOLVED_UUID, 'Push-Ups', true, true],                    // saved routine, library uuid the catalog cannot answer
  ['plan-exercise:row-1', 'Push-Ups', true, true],              // coach plan row with no catalog id: same rule
  ['ex_squat', 'Barbell Squat', false, true],                   // list says barbell: as main
  ['routine:routine-7/kettlebell-halo', 'Kettlebell Halo', undefined, true], // not in the list: as main
  ['seed:chest-009', 'Push-Ups', false, false],                 // catalog answers barbell: wins, list not read
  ['seed:pull-001', 'Barbell Squat', true, false],              // catalog answers body weight: wins
  [RESOLVING_UUID, 'Push-Ups', false, true],                    // a uuid the catalog does answer: a catalog answer, wins
  ['0001', 'Push-Ups', undefined, false],                       // an ExerciseDB id: catalog only, never the list
])('%s named %s -> %p (list read: %p)', async (id, name, expected, listRead) => {
  const { result } = await renderHook(() => useBodyWeightExercises([id], { [id]: name }), { wrapper });
  await waitFor(() => expect(settled(id)).toBe(true));
  if (listRead) await waitFor(() => expect(mockGetAllExercises).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current[id]).toBe(expected));
  expect(id in result.current).toBe(expected !== undefined);
  expect(mockGetAllExercises).toHaveBeenCalledTimes(listRead ? 1 : 0);
});

it('without names (m#928\'s callers) a phone-made id reads as main and the list is never read', async () => {
  const { result } = await renderHook(() => useBodyWeightExercises(['ex_pushups']), { wrapper });
  await waitFor(() => expect(settled('ex_pushups')).toBe(true));
  expect(result.current).toEqual({});
  expect(mockGetAllExercises).not.toHaveBeenCalled();
});

it('the list is read once per mount, however many ids and renders', async () => {
  const ids = ['ex_pushups', 'routine:routine-7/push-ups', 'ex_squat'];
  const names = { ex_pushups: 'Push-Ups', 'routine:routine-7/push-ups': 'Push-Ups', ex_squat: 'Barbell Squat' };
  const { result, rerender } = await renderHook(() => useBodyWeightExercises(ids, names), { wrapper });
  await waitFor(() => expect(result.current).toEqual({ ex_pushups: true, 'routine:routine-7/push-ups': true, ex_squat: false }));
  await rerender({});
  expect(mockGetAllExercises).toHaveBeenCalledTimes(1);
});
