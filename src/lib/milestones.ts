/**
 * milestones.ts — Pure milestone resolver for Healthy Anticipation (UX Psych #4).
 *
 * No side effects, no imports beyond identityTitle — safe to unit-test in isolation.
 * All milestone logic is deterministic; backend not required.
 *
 * Usage:
 *   import { resolveNextMilestones } from '../lib/milestones';
 *   const milestones = resolveNextMilestones({ workoutCount: 12, consecutiveDays: 5, identityTitle: 'New Member' });
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MilestoneInput {
  /** Total lifetime workouts logged */
  workoutCount: number;
  /** Number of consecutive days the user has logged a session */
  consecutiveDays: number;
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
  category: 'consistency' | 'workouts' | 'identity';
}

// ─── Milestone definitions ────────────────────────────────────────────────────
// Ordered by ascending threshold within each category so the first unmet
// milestone can be found with a simple find().
//
// Labels are declarative noun phrases — what the user has done, stated
// plainly. No earned-status titles; the voice is a quarterly check-in note.

interface MilestoneDef {
  slug: string;
  label: string;
  threshold: number;
  unlockReward: string;
  category: 'consistency' | 'workouts' | 'identity';
}

const CONSISTENCY_MILESTONES: MilestoneDef[] = [
  {
    slug:          'consistency-3',
    label:         'Three Consecutive Days',
    threshold:     3,
    unlockReward:  'Three consecutive days.',
    category:      'consistency',
  },
  {
    slug:          'consistency-7',
    label:         'One Week Sustained',
    threshold:     7,
    unlockReward:  'Seven consecutive days.',
    category:      'consistency',
  },
  {
    slug:          'consistency-14',
    label:         'Two Weeks Sustained',
    threshold:     14,
    unlockReward:  'Fourteen consecutive days.',
    category:      'consistency',
  },
  {
    slug:          'consistency-30',
    label:         'Thirty Days Sustained',
    threshold:     30,
    unlockReward:  'Thirty consecutive days.',
    category:      'consistency',
  },
];

const WORKOUT_MILESTONES: MilestoneDef[] = [
  {
    slug:          'workouts-10',
    label:         'Ten Sessions Logged',
    threshold:     10,
    unlockReward:  'Ten sessions logged.',
    category:      'workouts',
  },
  {
    slug:          'workouts-30',
    label:         'Thirty Sessions Logged',
    threshold:     30,
    unlockReward:  'Thirty sessions logged.',
    category:      'workouts',
  },
  {
    slug:          'workouts-50',
    label:         'Fifty Sessions Logged',
    threshold:     50,
    unlockReward:  'Fifty sessions logged.',
    category:      'workouts',
  },
  {
    slug:          'workouts-90',
    label:         'Ninety Sessions Logged',
    threshold:     90,
    unlockReward:  'Ninety sessions logged.',
    category:      'workouts',
  },
  {
    slug:          'workouts-150',
    label:         'One Hundred Fifty Sessions Logged',
    threshold:     150,
    unlockReward:  'One hundred fifty sessions logged.',
    category:      'workouts',
  },
];

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Returns the next 3 milestones the user is working toward, across consistency
 * and workout categories. Already-completed milestones are excluded.
 *
 * Each result has `currentValue` clamped to `targetValue` for display purposes.
 */
export function resolveNextMilestones(input: MilestoneInput): Milestone[] {
  const { workoutCount, consecutiveDays } = input;

  const milestones: Milestone[] = [];

  // ── Next consistency milestone ─────────────────────────────────────────────
  const nextConsistency = CONSISTENCY_MILESTONES.find((m) => consecutiveDays < m.threshold);
  if (nextConsistency) {
    milestones.push({
      slug:         nextConsistency.slug,
      label:        nextConsistency.label,
      currentValue: Math.min(consecutiveDays, nextConsistency.threshold),
      targetValue:  nextConsistency.threshold,
      unlockReward: nextConsistency.unlockReward,
      category:     'consistency',
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

  // Return the top 3 (consistency first, then workouts by threshold ascending)
  return milestones.slice(0, 3);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable "X more Y to Z" line for display below the bar.
 * e.g. "2 workouts to Thirty Sessions Logged."
 */
export function milestoneRemainingCopy(milestone: Milestone): string {
  const remaining = milestone.targetValue - milestone.currentValue;
  if (remaining <= 0) return `${milestone.label}.`;

  const unit =
    milestone.category === 'consistency'
      ? remaining === 1 ? 'day' : 'days'
      : remaining === 1 ? 'workout' : 'workouts';

  return `${remaining} ${unit} to ${milestone.label}.`;
}
