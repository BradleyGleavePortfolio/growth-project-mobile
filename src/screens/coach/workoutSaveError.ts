import type { ApiErrorLike } from '../../types/common';

export const WORKOUT_SAVE_FAILED = 'The workout could not be saved. Try again in a moment.';

export function workoutSaveError(err: unknown): string {
  const data = (err as ApiErrorLike | null)?.response?.data;
  const message = typeof data === 'object' && data !== null ? data.message : undefined;
  // Only known product copy from the save endpoint may pass through.
  // Transport text, validation field names and server diagnostics stay private.
  return message === 'Exercise order values must be unique within a plan'
    ? message
    : WORKOUT_SAVE_FAILED;
}
