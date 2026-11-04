/**
 * EXID-M: the routine contract's catalog_exercise_id on the phone. Old rows
 * and null answers keep m#917's rule (name slug), a made-up id never reaches
 * the catalog or the server, and both offline copies keep the id.
 */
import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';
import {
  buildRoutinePayload,
  routineToBuilderExercises,
  routineToSessionExercises,
  type ApiRoutine,
} from '../utils/workout/workoutLogging';
import {
  catalogKey,
  libraryExerciseId,
  manualExerciseId,
  routineExerciseId,
} from '../utils/workout/exerciseId';

const mockRows: Record<string, { id: string; exercises: string }> = {};
jest.mock('../db/database', () => ({
  getDatabase: jest.fn(async () => ({
    runAsync: jest.fn(async (sql: string, args: string[]) => {
      if (sql.startsWith('INSERT')) mockRows[args[0]] = { id: args[0], exercises: args[4] };
      if (sql.startsWith('UPDATE')) mockRows[args[3]] = { id: args[3], exercises: args[1] };
    }),
    getAllAsync: jest.fn(async () => Object.values(mockRows)),
  })),
}));
import { createRoutine, getRoutines, updateRoutine, type RoutineExercise } from '../db/workoutDb';

const LIB = '3f1c2b9e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const row = (extra: Record<string, unknown>) => ({
  id: 'row-0', exercise_name: 'Barbell Bench Press', muscle_group: 'CHEST',
  default_sets: 3, default_reps: 8, default_rest_seconds: 60, ...extra,
});

it('an old routine with no ids, and a server answer of null, keep the name-slug rule', () => {
  for (const exercise of [row({}), row({ catalog_exercise_id: null })]) {
    const routine = { id: 'routine-old', name: 'Old', exercises: [exercise] } as ApiRoutine;
    const [session] = routineToSessionExercises(routine);
    expect(session.exerciseId).toBe(routineExerciseId('routine-old', 'Barbell Bench Press'));
    expect(catalogKey(session.exerciseId, session.exerciseName)).toBe('barbell-bench-press');
    const builder = routineToBuilderExercises(routine);
    expect(builder[0].catalogExerciseId).toBeNull();
    expect(buildRoutinePayload('Old', builder).exercises[0]).not.toHaveProperty('catalog_exercise_id');
  }
});

it('a value that is not a library uuid is never used or sent as one', () => {
  for (const bad of ['ex_k3j2a', 'seed:push-001', 'row-0', '', '  ', 'routine:r/x', 42, {}]) {
    expect(libraryExerciseId(bad)).toBeNull();
    const routine = { id: 'r', name: 'R', exercises: [row({ catalog_exercise_id: bad })] } as ApiRoutine;
    expect(routineToSessionExercises(routine)[0].exerciseId).toBe(routineExerciseId('r', 'Barbell Bench Press'));
    const payload = buildRoutinePayload('R', [{
      exerciseId: 'ex_k3j2a', exerciseName: 'Bench', sets: 3, reps: 8, restSec: 60,
      muscleGroup: 'CHEST', catalogExerciseId: bad as string,
    }]);
    expect(payload.exercises[0]).not.toHaveProperty('catalog_exercise_id');
  }
  expect(libraryExerciseId(LIB)).toBe(LIB);
});

it('catalogKey never gets a made-up id; real library ids still pass', () => {
  const madeUp = [
    routineExerciseId('routine-1', 'Bench'), routineExerciseId('', 'Bench'), manualExerciseId('Bench'),
    'plan-exercise:pe-1', 'assignment-exercise:2', 'logged:0', 'session:s-1/bench', 'ex_k3j2a',
  ];
  for (const id of madeUp) expect(catalogKey(id, 'Bench')).toBe('bench');
  for (const id of [LIB, 'seed:push-001', '0001']) expect(catalogKey(id, 'Bench')).toBe(id);
  expect(catalogKey(undefined, 'Bench')).toBe('bench');
});

it('offline: the persisted routines cache and the phone routine store both keep the id', async () => {
  const routine: ApiRoutine = { id: 'routine-1', name: 'Push', exercises: [row({ catalog_exercise_id: LIB })] };
  // The routines query is persisted as JSON (src/services/queryClient.ts) and read back offline.
  const online = new QueryClient();
  online.setQueryData(['routines'], [routine]);
  const offline = new QueryClient();
  hydrate(offline, JSON.parse(JSON.stringify(dehydrate(online))));
  const [cached] = offline.getQueryData<ApiRoutine[]>(['routines']) ?? [];
  const [session] = routineToSessionExercises(cached);
  expect(catalogKey(session.exerciseId, 'Bench (renamed)')).toBe(LIB);
  expect(buildRoutinePayload('Push', routineToBuilderExercises(cached)).exercises[0].catalog_exercise_id).toBe(LIB);

  // The phone's own routine store (src/db/workoutDb.ts) round trip.
  const exercises: RoutineExercise[] = [
    { exerciseId: 'ex_k3j2a', exerciseName: 'Barbell Bench Press', sets: 3, reps: 8, restSec: 60, catalogExerciseId: LIB },
    { exerciseId: 'ex_z7x6c', exerciseName: 'Towel Curl', sets: 2, reps: 12, restSec: 45, catalogExerciseId: null },
  ];
  const id = await createRoutine('client-1', 'coach-1', 'Push', exercises);
  await updateRoutine(id, 'Push', exercises);
  const [stored] = await getRoutines('client-1');
  const back: RoutineExercise[] = JSON.parse(stored.exercises);
  expect(back.map((e) => e.catalogExerciseId)).toEqual([LIB, null]);
});
