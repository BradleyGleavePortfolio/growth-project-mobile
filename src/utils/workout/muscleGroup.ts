/**
 * Map a muscle label from the on-device exercise catalog (or a routine
 * row) to the server's MuscleGroup enum. POST /workouts and POST /routines
 * reject any other value with a 400, and the Workouts tab "Muscle
 * Breakdown" groups by this field, so every write goes through here.
 */
export type ServerMuscleGroup =
  | 'chest'
  | 'back'
  | 'legs'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'cardio'
  | 'full_body';

const MAP: Record<string, ServerMuscleGroup> = {
  chest: 'chest',
  back: 'back',
  legs: 'legs',
  glutes: 'legs',
  quads: 'legs',
  hamstrings: 'legs',
  calves: 'legs',
  shoulders: 'shoulders',
  arms: 'arms',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  core: 'core',
  abs: 'core',
  cardio: 'cardio',
  'full body': 'full_body',
  full_body: 'full_body',
};

export function toServerMuscleGroup(muscle: string | null | undefined): ServerMuscleGroup {
  if (!muscle) return 'full_body';
  return MAP[muscle.trim().toLowerCase()] ?? 'full_body';
}
