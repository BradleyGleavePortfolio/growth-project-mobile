/**
 * One stored workout per Finish (WK-1-M R1).
 *
 * A finished session gets one key, its phone queue key, made when the client
 * first taps Finish. The Finish save and every queued sync retry send that
 * same key in the `Idempotency-Key` header, so when the first send reached the
 * server but its answer was lost, the retry gets back the workout already
 * stored instead of storing a second one. A server without the key ignores
 * the header and behaves as before.
 *
 * Both POST /workouts senders go through `createWorkoutOnce`: the Finish
 * screen (useCreateWorkout) and the sync engine (pushQueuedRow).
 */
import { workoutApi } from '../../services/api';

// The server's rule for this header (8-128 of A-Z a-z 0-9 . _ : -). A key
// outside it would be refused with a 400 and park the workout, so it is
// never sent; the queue key (`<user id>:<start ms>`) always fits.
const SAVE_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** The request config carrying `clientKey`, or undefined when there is no usable key. */
export function workoutSaveKeyConfig(
  clientKey: string | null | undefined,
): { headers: { 'Idempotency-Key': string } } | undefined {
  const key = (clientKey ?? '').trim();
  return SAVE_KEY_PATTERN.test(key) ? { headers: { 'Idempotency-Key': key } } : undefined;
}

/** POST /workouts for one finished session, keyed by its queue key. */
export function createWorkoutOnce(
  body: Record<string, unknown>,
  clientKey: string | null | undefined,
) {
  const config = workoutSaveKeyConfig(clientKey);
  return config ? workoutApi.create(body, config) : workoutApi.create(body);
}
