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
  const send = (b: Record<string, unknown>) => (config ? workoutApi.create(b, config) : workoutApi.create(b));
  return withoutPlanRowsOn400(body, send);
}

/** PUT /workouts/:id for a queued edit, with the same one resend. */
export function updateWorkoutOnce(id: string, body: Record<string, unknown>) {
  return withoutPlanRowsOn400(body, (b) => workoutApi.update(id, b));
}

/*
 * TIMED-SETS-M (SET-ASKED, b#1219): each exercise logged from an assignment
 * names its plan row (plan_assignment_id, plan_order). A server without that
 * change refuses unknown fields with a 400 before the save runs, so the key is
 * unused: the same body is sent once more without the two fields, under the
 * same key. Every other 400, and a body without the fields, is as before.
 */
const PLAN_ROW_FIELDS = ['plan_assignment_id', 'plan_order'] as const;

function exercisesOf(body: Record<string, unknown>): unknown[] {
  return Array.isArray(body.exercises) ? body.exercises : [];
}

function hasPlanRows(body: Record<string, unknown>): boolean {
  return exercisesOf(body).some((e) => !!e && typeof e === 'object'
    && PLAN_ROW_FIELDS.some((f) => f in (e as Record<string, unknown>)));
}

function withoutPlanRows(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    exercises: exercisesOf(body).map((e) => {
      if (!e || typeof e !== 'object') return e;
      const { plan_assignment_id: _id, plan_order: _order, ...rest } = e as Record<string, unknown>;
      return rest;
    }),
  };
}

/** A 400 whose message names plan_assignment_id or plan_order. */
export function refusesPlanRows(err: unknown): boolean {
  const res = (err as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  if (res?.status !== 400) return false;
  const message = res.data?.message;
  const lines = Array.isArray(message) ? message : [message];
  return lines.some((m) => typeof m === 'string' && PLAN_ROW_FIELDS.some((f) => m.includes(f)));
}

async function withoutPlanRowsOn400<T>(
  body: Record<string, unknown>,
  send: (b: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  try {
    return await send(body);
  } catch (err) {
    if (!hasPlanRows(body) || !refusesPlanRows(err)) throw err;
    return send(withoutPlanRows(body));
  }
}
