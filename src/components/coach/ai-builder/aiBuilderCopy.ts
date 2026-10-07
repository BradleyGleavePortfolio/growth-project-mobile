/**
 * Copy for Ask AI in the workout builder (plan PART 1 "States"). Product copy
 * rules: no first person, no emojis, no exclamation marks, no generic errors.
 */
import type { AiBuilderErrorCode, AiBuilderInjuryArea, AiBuilderQuickAction } from '../../../api/aiBuilderApi';

export const AI_LABEL = 'AI-suggested, coach-approved';

export const AI_STAGES = [
  'Reading the workout',
  'Checking limits and injuries',
  'Choosing from your exercise library',
] as const;

export const QUICK_ACTION_LABELS: Record<AiBuilderQuickAction, string> = {
  swap_for_injury: 'Swap for injury',
  progress: 'Progress',
  deload: 'Deload',
  shorten: 'Shorten',
  more_volume: 'More volume',
  explain: 'Explain',
};

/** The instruction sent with a chip, so the server always gets a sentence. */
export const QUICK_ACTION_INSTRUCTIONS: Record<AiBuilderQuickAction, string> = {
  swap_for_injury: 'Swap exercises that load the selected area for safer options.',
  progress: 'Progress this workout by one step.',
  deload: 'Make this a deload: sets down about 40 percent, same exercises.',
  shorten: 'Shorten this workout and keep the main lifts.',
  more_volume: 'Add volume to this workout inside safe limits.',
  explain: 'Explain this workout in a short summary for the coach.',
};

export const INJURY_AREA_LABELS: Record<Exclude<AiBuilderInjuryArea, 'other'>, string> = {
  knee: 'Knee',
  shoulder: 'Shoulder',
  lower_back: 'Lower back',
  hip: 'Hip',
  elbow_wrist: 'Elbow or wrist',
  ankle_foot: 'Ankle or foot',
  upper_back_neck: 'Upper back or neck',
};

export const KIND_LABELS = {
  added: 'Added',
  changed: 'Changed',
  removed: 'Removed',
  moved: 'Moved',
  meta: 'Details',
} as const;

export const PAUSED_COPY = 'Ask AI is paused for maintenance. Your workouts are unchanged.';
export const NOT_CONFIGURED_COPY = 'Ask AI is not set up on this account yet. Your workouts are unchanged.';
export const SAVE_FIRST_COPY = 'Save this workout first, then Ask AI can change it.';
export const WAIT_FOR_SAVE_COPY = 'Your last edit is still saving. Ask again in a moment.';

function formatResetDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

export function noCreditsCopy(resetsAt: string | null): string {
  const date = formatResetDate(resetsAt);
  return date
    ? `AI credits for this month are used up. They reset on ${date}.`
    : 'AI credits for this month are used up. They reset at the start of the next billing period.';
}

export function describeAiBuilderError(code: AiBuilderErrorCode, resetsAt: string | null = null): string {
  switch (code) {
    case 'no_credits':
      return noCreditsCopy(resetsAt);
    case 'consent_required':
      return 'This client has not allowed AI to use their data. Edit by hand, or build from a template without client data.';
    case 'stale':
      return 'This workout changed on another screen. Reload it and ask again.';
    case 'no_safe_proposal':
      return 'No safe change found for that request. Try: swap squats for a knee-friendly option.';
    case 'paused':
    case 'not_available':
      return PAUSED_COPY;
    case 'rate_limited':
      return 'That is a lot of requests in an hour. Try again in a few minutes.';
    case 'forbidden':
      return 'This account cannot use Ask AI on this workout.';
    case 'network':
      return 'No connection. Your workout is unchanged. Check your connection and ask again.';
    case 'contract':
      return 'The suggestion arrived in a format this app version cannot read. Your workout is unchanged.';
    case 'server':
    default:
      return 'The AI service did not answer. Your workout is unchanged. Ask again in a minute.';
  }
}

export function formatRow(row: {
  sets?: number | null;
  reps_or_duration_seconds?: number | null;
  weight_lbs?: number | null;
} | null | undefined): string {
  if (!row) return '';
  const sets = row.sets ?? null;
  const reps = row.reps_or_duration_seconds ?? null;
  const base = sets !== null && reps !== null ? `${sets} x ${reps}` : sets !== null ? `${sets} sets` : '';
  const load = row.weight_lbs != null ? ` @ ${row.weight_lbs} lb` : '';
  return `${base}${load}`.trim();
}

export function applyLabel(count: number): string {
  if (count === 0) return 'Keep at least one change';
  return count === 1 ? 'Apply 1 change' : `Apply ${count} changes`;
}

export function appliedToast(count: number): string {
  return count === 1 ? 'Applied 1 change.' : `Applied ${count} changes.`;
}

export function droppedLine(count: number, firstReason: string | null): string {
  const noun = count === 1 ? '1 suggestion removed' : `${count} suggestions removed`;
  return firstReason ? `${noun}: ${firstReason}` : `${noun}.`;
}
