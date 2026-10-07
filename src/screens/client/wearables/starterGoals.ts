/** Owner-approved fallback targets, not personalised or persisted goals. */
export const STARTER_GOALS = {
  ACTIVE_ENERGY_KCAL: 250,
  WORKOUT_DURATION_MIN: 20,
  STEPS: 5000,
} as const;

export type ActivityTargets = Partial<Record<keyof typeof STARTER_GOALS, number>>;
