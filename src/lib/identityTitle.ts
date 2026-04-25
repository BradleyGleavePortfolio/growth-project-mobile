/**
 * identityTitle — pure resolver for user identity titles.
 *
 * Inputs describe the user's activity history; the function returns a short,
 * motivating label displayed above the HeroAction on HomeScreen.
 *
 * No side effects, no imports — can be unit tested in isolation.
 */
export interface IdentityTitleInput {
  /** true if user joined when the platform had ≤ 1000 members */
  isFoundingMember: boolean;
  /** current daily streak in days */
  streakDays: number;
  /** total lifetime workouts logged */
  totalWorkouts: number;
  /** how many weeks since the user joined */
  weeksSinceJoin: number;
  /** how many days since the last workout (undefined = never logged one) */
  daysSinceLastWorkout?: number;
}

export interface IdentityTitle {
  /** Short display label */
  label: string;
  /** One-sentence motivational sub-copy (optional display) */
  description: string;
}

/**
 * Returns the single best-matching identity title for the given stats.
 * Rules are evaluated in priority order; first match wins.
 */
export function resolveIdentityTitle(input: IdentityTitleInput): IdentityTitle {
  const {
    isFoundingMember,
    streakDays,
    totalWorkouts,
    weeksSinceJoin,
    daysSinceLastWorkout,
  } = input;

  // 1. Day-One Lifter — founding member AND actively training (5+ workouts)
  if (isFoundingMember && totalWorkouts >= 5) {
    return {
      label: 'Day-One Lifter',
      description: 'You were here before the crowd. Keep leading.',
    };
  }

  // 2. Comeback Kid — had a break of 14+ days but is back now
  //    (daysSinceLastWorkout is a recent gap if they have workouts again after one)
  if (
    typeof daysSinceLastWorkout === 'number' &&
    daysSinceLastWorkout >= 14 &&
    totalWorkouts > 0 &&
    streakDays >= 1
  ) {
    return {
      label: 'Comeback Kid',
      description: "You took a break and came back stronger. That's discipline.",
    };
  }

  // 3. Consistency Builder — 7+ day streak
  if (streakDays >= 7) {
    return {
      label: 'Consistency Builder',
      description: 'Seven days straight. Habits compound over time.',
    };
  }

  // 4. Iron Veteran — 50+ total workouts and 4+ weeks in
  if (totalWorkouts >= 50 && weeksSinceJoin >= 4) {
    return {
      label: 'Iron Veteran',
      description: "Over 50 sessions logged. You're not dabbling — you're committed.",
    };
  }

  // 5. Rising Athlete — 10-49 workouts
  if (totalWorkouts >= 10) {
    return {
      label: 'Rising Athlete',
      description: 'Double-digits in. You know what you want.',
    };
  }

  // 6. Founding Member (early but not yet active enough for Day-One)
  if (isFoundingMember) {
    return {
      label: 'Founding Member',
      description: 'You joined when this was brand new. Your early faith matters.',
    };
  }

  // Default — new / just getting started
  return {
    label: 'Iron Apprentice',
    description: 'Every legend starts here. Your first chapter begins now.',
  };
}
