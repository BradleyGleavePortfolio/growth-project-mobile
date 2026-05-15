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
