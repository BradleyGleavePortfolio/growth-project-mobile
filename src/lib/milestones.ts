/**
 * milestones.ts — Pure milestone resolver for Healthy Anticipation (UX Psych #4).
 *
 * No side effects, no imports beyond identityTitle — safe to unit-test in isolation.
 * All milestone logic is deterministic; backend not required.
 *
 * Usage:
 *   import { resolveNextMilestones } from '../lib/milestones';
 *   const milestones = resolveNextMilestones({ workoutCount: 12, streakDays: 5, identityTitle: 'Iron Apprentice' });
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MilestoneInput {
  /** Total lifetime workouts logged */
  workoutCount: number;
  /** Current daily streak in days */
  streakDays: number;
  /** Resolved identity label from identityTitle resolver */
  identityTitle: string;
  /** True when user is a founding member */
  isFoundingMember?: boolean;
}

export interface Milestone {
  /** Unique stable identifier */
  slug: string;
  /** Human-readable milestone name */
  label: string;
  /** Progress numerator (what the user has now) */
  currentValue: number;
  /** Progress denominator (target to unlock) */
  targetValue: number;
  /** Short reward description shown below the bar */
  unlockReward: string;
  /** Milestone category for grouping */
  category: 'streak' | 'workouts' | 'identity';
}

// ─── Milestone definitions ────────────────────────────────────────────────────
// Ordered by ascending threshold within each category so the first unmet
// milestone can be found with a simple find().

interface MilestoneDef {
  slug: string;
  label: string;
  threshold: number;
  unlockReward: string;
  category: 'streak' | 'workouts' | 'identity';
}

const STREAK_MILESTONES: MilestoneDef[] = [
  {
    slug:          'streak-3',
    label:         '3-Day Streak',
    threshold:     3,
    unlockReward:  'Unlock "Habit Seed" badge',
    category:      'streak',
  },
  {
    slug:          'streak-7',
    label:         'Consistency Builder',
    threshold:     7,
    unlockReward:  'Unlock "Consistency Builder" identity + 7-day trophy',
    category:      'streak',
  },
  {
    slug:          'streak-14',
    label:         '2-Week Streak',
    threshold:     14,
    unlockReward:  'Unlock "Fortnight Fighter" badge',
    category:      'streak',
  },
  {
    slug:          'streak-30',
    label:         '30-Day Streak',
    threshold:     30,
    unlockReward:  'Unlock "Iron Discipline" badge + profile flair',
    category:      'streak',
  },
];

const WORKOUT_MILESTONES: MilestoneDef[] = [
  {
    slug:          'workouts-10',
    label:         'Rising Athlete',
    threshold:     10,
    unlockReward:  'Unlock "Rising Athlete" identity title',
    category:      'workouts',
  },
  {
    slug:          'workouts-30',
    label:         'Iron Veteran',
    threshold:     30,
    unlockReward:  'Unlock "Iron Veteran" identity + profile badge',
    category:      'workouts',
  },
  {
    slug:          'workouts-50',
    label:         'Proven Grinder',
    threshold:     50,
    unlockReward:  'Unlock "Proven Grinder" badge + leaderboard spot',
    category:      'workouts',
  },
  {
    slug:          'workouts-90',
    label:         'Forge Forged',
    threshold:     90,
    unlockReward:  'Unlock "Forge Forged" — elite tier, top 1% of members',
    category:      'workouts',
  },
  {
    slug:          'workouts-150',
    label:         'Iron Legend',
    threshold:     150,
    unlockReward:  'Unlock "Iron Legend" — permanent hall of fame entry',
    category:      'workouts',
  },
];

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Returns the next 3 milestones the user is working toward, across streak and
 * workout categories. Already-completed milestones are excluded.
 *
 * Each result has `currentValue` clamped to `targetValue` for display purposes.
 */
export function resolveNextMilestones(input: MilestoneInput): Milestone[] {
  const { workoutCount, streakDays } = input;

  const milestones: Milestone[] = [];

  // ── Next streak milestone ──────────────────────────────────────────────────
  const nextStreak = STREAK_MILESTONES.find((m) => streakDays < m.threshold);
  if (nextStreak) {
    milestones.push({
      slug:         nextStreak.slug,
      label:        nextStreak.label,
      currentValue: Math.min(streakDays, nextStreak.threshold),
      targetValue:  nextStreak.threshold,
      unlockReward: nextStreak.unlockReward,
      category:     'streak',
    });
  }

  // ── Next two workout milestones ────────────────────────────────────────────
  const pendingWorkouts = WORKOUT_MILESTONES.filter((m) => workoutCount < m.threshold);
  for (const def of pendingWorkouts.slice(0, 2)) {
    milestones.push({
      slug:         def.slug,
      label:        def.label,
      currentValue: Math.min(workoutCount, def.threshold),
      targetValue:  def.threshold,
      unlockReward: def.unlockReward,
      category:     'workouts',
    });
  }

  // Return the top 3 (streak first, then workouts by threshold ascending)
  return milestones.slice(0, 3);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable "X more Y to Z" line for display below the bar.
 * e.g. "2 more workouts unlocks Iron Veteran"
 */
export function milestoneRemainingCopy(milestone: Milestone): string {
  const remaining = milestone.targetValue - milestone.currentValue;
  if (remaining <= 0) return `${milestone.label} unlocked!`;

  const unit =
    milestone.category === 'streak'
      ? remaining === 1 ? 'day' : 'days'
      : remaining === 1 ? 'workout' : 'workouts';

  return `${remaining} more ${unit} unlocks ${milestone.label}`;
}
