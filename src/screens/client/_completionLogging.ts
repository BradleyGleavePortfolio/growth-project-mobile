/**
 * _completionLogging — shared structured-logging helpers for the §2.8 workout
 * completion hand-off.
 *
 * The completion signal has two halves that must log with the SAME diagnostic
 * shape so a durability failure can be segmented end-to-end:
 *   - the PRODUCER (ActiveWorkoutScreen) writes the durable workout and emits
 *     `justCompletedId`; and
 *   - the CONSUMER (WorkoutScreen's `useJustCompletedOneShot`) reads/writes the
 *     completion-consumed latch.
 *
 * In a mixed coach/client app a latch failure is useless without route + acting
 * role + the keys needed to segment it. This module centralises (a) the
 * unknown→structured error normaliser and (b) the base context builder so both
 * sides carry identical keys (`route`, `userRole`, `userKey`, `assignmentId`,
 * plus a per-call `checkpoint`), rather than each screen hand-rolling its own.
 */

/** Normalised, log-safe shape for an unknown caught value. */
export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Convert an unknown caught value into a structured, log-safe object. Mirrors
 * the historical ActiveWorkoutScreen normaliser so producer and consumer warn
 * payloads carry an identically-shaped `error` field.
 */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { name: 'NonError', message: error };
  }
  try {
    return { name: 'NonError', message: JSON.stringify(error) };
  } catch {
    return { name: 'NonError', message: String(error) };
  }
}

/** The structured base shared by every completion-path warn site. */
export interface CompletionLogBase {
  route: 'ActiveWorkout' | 'Workout';
  userRole: string;
  userKey?: string;
  assignmentId?: string;
  justCompletedId?: string;
}

/** Inputs available on either side of the completion hand-off. */
export interface CompletionLogContext {
  route: 'ActiveWorkout' | 'Workout';
  userRole?: string;
  userKey?: string;
  assignmentId?: string;
  justCompletedId?: string;
}

/**
 * Build the structured base object attached to every completion-path
 * `logger.warn`. A per-call `checkpoint` and the normalised `error` are spread
 * in at the call site.
 */
export function buildCompletionLogBase(ctx: CompletionLogContext): CompletionLogBase {
  return {
    route: ctx.route,
    userRole: ctx.userRole ?? 'unknown',
    userKey: ctx.userKey || undefined,
    assignmentId: ctx.assignmentId ?? undefined,
    justCompletedId: ctx.justCompletedId ?? undefined,
  };
}
