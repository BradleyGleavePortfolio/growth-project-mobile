/**
 * Deterministic fallback id for an exercise that came from a source which
 * does not carry a catalog id (legacy routines, AI-suggested freeform names).
 *
 * Empty strings used to flow into the offline workout_logs table, producing
 * rows that the sync engine could not correlate with a server exercise and
 * that ClientDetail mapped back as `exerciseId: ''`. The fallback below is:
 *   - prefixed (`routine:` / `manual:`) so it can never collide with a real
 *     ExerciseDB or `seed:` id;
 *   - deterministic per (scope, name) pair so two sessions of the same
 *     routine aggregate cleanly in the volume tables.
 */

export function slugifyExerciseName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function routineExerciseId(routineId: string, name: string): string {
  const slug = slugifyExerciseName(name);
  const scope = routineId ? `routine:${routineId}` : 'routine';
  return slug ? `${scope}/${slug}` : `${scope}/unnamed`;
}

export function manualExerciseId(name: string): string {
  const slug = slugifyExerciseName(name);
  return slug ? `manual:${slug}` : 'manual:unnamed';
}

/**
 * A library item's id (the exercise catalog's uuid), or null. A saved routine
 * keeps it per exercise (catalog_exercise_id); the server takes a uuid only,
 * so an id the phone made for itself is never sent or used as one.
 */
const LIBRARY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function libraryExerciseId(value: unknown): string | null {
  return typeof value === 'string' && LIBRARY_ID.test(value) ? value : null;
}

// Every id the phone makes for itself: the fallbacks above, coach-plan rows
// without a catalog id, logged and coach-session rows, and the phone's own
// exercise list (`ex_` + random). The catalog can never resolve one.
const PHONE_MADE_ID = /^(routine|manual|plan-exercise|assignment-exercise|logged|session)[:/]|^ex_/;

/**
 * The key the exercise catalog resolves (id, slug or source reference) for an
 * exercise's Watch video and instructions: its catalog id (a saved routine's
 * library id included), or, for an id the phone made (no catalog identity),
 * the name's slug. A made-up id is never sent to the catalog.
 */
export function catalogKey(exerciseId: string | undefined, name: string): string {
  const id = (exerciseId ?? '').trim();
  return id && !PHONE_MADE_ID.test(id) ? id : slugifyExerciseName(name);
}
