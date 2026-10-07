/** Ask AI copy (plan PART 1 "States"): no first person, emojis, exclamation marks or generic errors. */
import type { AiBuilderErrorCode, AiBuilderInjuryArea, AiBuilderQuickAction } from '../../../api/aiBuilderApi';

export const AI_LABEL = 'AI-suggested, coach-approved';
export const AI_STAGES = ['Reading the workout', 'Checking limits and injuries', 'Choosing from your exercise library'] as const;
export const QUICK_ACTIONS: Record<AiBuilderQuickAction, { label: string; instruction: string }> = {
  swap_for_injury: { label: 'Swap for injury', instruction: 'Swap exercises that load the selected area for safer options.' },
  progress: { label: 'Progress', instruction: 'Progress this workout by one step.' },
  deload: { label: 'Deload', instruction: 'Make this a deload: sets down about 40 percent, same exercises.' },
  shorten: { label: 'Shorten', instruction: 'Shorten this workout and keep the main lifts.' },
  more_volume: { label: 'More volume', instruction: 'Add volume to this workout inside safe limits.' },
  explain: { label: 'Explain', instruction: 'Explain this workout in a short summary for the coach.' },
};

export const INJURY_AREA_LABELS: Record<AiBuilderInjuryArea, string> = {
  knee: 'Knee', shoulder: 'Shoulder', lower_back: 'Lower back', hip: 'Hip', elbow_wrist: 'Elbow or wrist', ankle_foot: 'Ankle or foot', upper_back_neck: 'Upper back or neck',
};
export const KIND_LABELS = { added: 'Added', changed: 'Changed', removed: 'Removed', moved: 'Moved', meta: 'Details' } as const;
export const UNNAMED_CHANGE: Record<string, string> = { moved: 'New order', meta: 'Workout details' }; // b#809 sends exercise: null for these and removes
const CONTEXT_LABELS: Record<string, string> = { exercise_library: 'your exercise library', current_workout: 'this workout', schedule: 'training days' };
export const contextLine = (keys: string[]) => `Using ${keys.map((k) => CONTEXT_LABELS[k] ?? k.replace(/_/g, ' ')).join(', ')}`;
export const PAUSED_COPY = 'Ask AI is paused for maintenance. Your workouts are unchanged.';
export const SAVE_FIRST_COPY = 'Save this workout first, then Ask AI can change it.';
export const WAIT_FOR_SAVE_COPY = 'Your last edit is still saving. Ask again in a moment.';
export const SCREENING_COPY = 'This client flagged a health screening question. Confirm medical clearance before increasing intensity.';

export function noCreditsCopy(resetsAt: string | null): string {
  const d = resetsAt ? new Date(resetsAt) : null;
  return d && !Number.isNaN(d.getTime())
    ? `AI credits for this month are used up. They reset on ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.`
    : 'AI credits for this month are used up. They reset at the start of the next billing period.';
}

const ERROR_COPY: Record<Exclude<AiBuilderErrorCode, 'no_credits'>, string> = {
  consent_required: 'This client has not allowed AI to use their data. Edit by hand, or build from a template without client data.',
  stale: 'This workout changed on another screen. Reload it and ask again.',
  no_safe_proposal: 'No safe change found for that request. Try: swap squats for a knee-friendly option.',
  over_limits: 'Those changes together go past a training limit for this workout. Keep the matching removal too, or untick an addition.',
  paused: PAUSED_COPY,
  not_available: PAUSED_COPY,
  rate_limited: 'That is a lot of requests in an hour. Try again in a few minutes.',
  forbidden: 'This account cannot use Ask AI on this workout.',
  network: 'No connection. Your workout is unchanged. Check your connection and ask again.',
  contract: 'The AI reply arrived in a format this app version cannot read. Your workout is unchanged.',
  server: 'The AI service did not answer. Your workout is unchanged. Ask again in a minute.',
};

export function describeAiBuilderError(code: AiBuilderErrorCode, resetsAt: string | null = null): string {
  return code === 'no_credits' ? noCreditsCopy(resetsAt) : ERROR_COPY[code];
}

type RowLike = { sets?: number | null; reps_or_duration_seconds?: number | null; weight_lbs?: number | null } | null | undefined;
export function formatRow(row: RowLike): string {
  if (!row) return '';
  const base = row.sets != null && row.reps_or_duration_seconds != null ? `${row.sets} x ${row.reps_or_duration_seconds}` : row.sets != null ? `${row.sets} sets` : '';
  return `${base}${row.weight_lbs != null ? ` @ ${row.weight_lbs} lb` : ''}`.trim();
}

const changes = (n: number) => (n === 1 ? '1 change' : `${n} changes`);
export const applyLabel = (n: number) => (n === 0 ? 'Keep at least one change' : `Apply ${changes(n)}`);
export const appliedToast = (n: number) => `Applied ${changes(n)}.`;
export const droppedLine = (n: number, reason: string | null) =>
  `${n === 1 ? '1 suggestion removed' : `${n} suggestions removed`}${reason ? `: ${reason}` : '.'}`;
