/**
 * identityTitle — pure resolver for user identity titles.
 *
 * Inputs describe the user's activity history; the function returns a short,
 * neutral label displayed above the HeroAction on HomeScreen.
 *
 * Labels are declarative noun phrases (e.g. "One Week Sustained"); the voice
 * is a quarterly check-in note, not earned-status chrome.
 *
 * No side effects, no imports — can be unit tested in isolation.
 */
export interface IdentityTitleInput {
  /** true if user joined when the platform had ≤ 1000 members */
  isFoundingMember: boolean;
  /** number of consecutive days the user has logged a session */
  consecutiveDays: number;
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
  /** One-sentence sub-copy (optional display) */
  description: string;
}

/**
 * Returns the single best-matching identity title for the given stats.
 * Rules are evaluated in priority order; first match wins.
 */
export function resolveIdentityTitle(input: IdentityTitleInput): IdentityTitle {
  const {
    isFoundingMember,
    consecutiveDays,
    totalWorkouts,
    weeksSinceJoin,
    daysSinceLastWorkout,
  } = input;

  // 1. Founding Member, Active — joined early AND actively training (5+ workouts)
  if (isFoundingMember && totalWorkouts >= 5) {
    return {
      label: 'Founding Member, Active',
      description: 'You were here before the crowd. Keep leading.',
    };
  }

  // 2. Returned to Practice — had a break of 14+ days but is back now
  //    (daysSinceLastWorkout is a recent gap if they have workouts again after one)
  if (
    typeof daysSinceLastWorkout === 'number' &&
    daysSinceLastWorkout >= 14 &&
    totalWorkouts > 0 &&
    consecutiveDays >= 1
  ) {
    return {
      label: 'Returned to Practice',
      description: "You took a break and came back stronger. That's discipline.",
    };
  }

  // 3. One Week Sustained — 7+ consecutive days
  if (consecutiveDays >= 7) {
    return {
      label: 'One Week Sustained',
      description: 'Seven days straight. Habits compound over time.',
    };
  }

  // 4. Fifty Sessions Logged — 50+ total workouts and 4+ weeks in
  if (totalWorkouts >= 50 && weeksSinceJoin >= 4) {
    return {
      label: 'Fifty Sessions Logged',
      description: "Over 50 sessions logged. You're not dabbling — you're committed.",
    };
  }

  // 5. Ten Sessions Logged — 10-49 workouts
  if (totalWorkouts >= 10) {
    return {
      label: 'Ten Sessions Logged',
      description: 'Double-digits in. You know what you want.',
    };
  }

  // 6. Founding Member (early but not yet active enough for the active label)
  if (isFoundingMember) {
    return {
      label: 'Founding Member',
      description: 'You joined when this was brand new. Your early faith matters.',
    };
  }

  // Default — new / just getting started
  return {
    label: 'New Member',
    description: 'Every legend starts here. Your first chapter begins now.',
  };
}
