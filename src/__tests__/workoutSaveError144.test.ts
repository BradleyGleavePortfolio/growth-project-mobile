import { WORKOUT_SAVE_FAILED, workoutSaveError } from '../screens/coach/workoutSaveError';

it.each([
  undefined, null, 'raw failure', new Error('Request failed with status code 400'),
  { response: { status: 400, data: { message: 'Bad Request' } } },
  { response: { status: 400, data: { message: ['name must be a string'] } } },
  { response: { status: 500, data: '<html>gateway failure</html>' } },
  { response: { data: { message: 'Internal failure. Query returned an error.' } } },
])('keeps unknown, validation and transport diagnostics off the save alert', (err) => {
  expect(workoutSaveError(err)).toBe(WORKOUT_SAVE_FAILED);
});

it('preserves the known product sentence from the save endpoint', () => {
  const message = 'Exercise order values must be unique within a plan';
  expect(workoutSaveError({ response: { status: 400, data: { message } } })).toBe(message);
});
