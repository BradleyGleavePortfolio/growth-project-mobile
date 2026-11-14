/**
 * DRAFTS-COUNT-M (owner #197-E5; OPERATOR RULING 17:4x 11-09): the one count of Roman's drafts. Coach Home, the Messages
 * card on both coach Messages screens and the Pending AI drafts headline take their number from here, so a coach never
 * reads two numbers for the same drafts: the Stream 2 drafts the queue shows (usePendingAiDrafts), Roman's replies to
 * check-ins the list draws (CHECKIN-DRAFT-M), plus Path Copilot's
 * workout changes where they are counted (clientPathCopilot on). A read with no answer yet counts nothing, as Home counts
 * it (Home says beside its number that a read is loading or failed; OPERATOR RULINGS 15:1x); a failed re-read keeps its
 * last answer.
 */
import { isStream2Capability } from '../../api/types/coachAiExecution';
import type { DraftKinds, ReadState } from './home-v11/useCoachHomeV11';
import { checkInDraftOf } from './checkInDrafts';

export interface DraftKindCount { count: number; label: string }

/** A query's state as Home reads its own: 'ok' once answered; a failed read is 'error', its last answer kept. */
export const readStateOf = (q: { isError?: boolean; data?: unknown }): ReadState => (q.isError ? 'error' : q.data ? 'ok' : 'loading');

/**
 * `rows`: the drafts the queue shows and their read's state. `changes`: how many workout changes Path Copilot's read
 * answered (null or undefined: no answer yet) and that read's state, or null where they are not counted. `state` is 'ok'
 * only once every read it counts has answered: a failed one is 'error', one on its way 'loading'.
 */
export function romanDraftsCount(
  rows: readonly { capability: string; provenance?: unknown; payload?: unknown }[] | undefined,
  rowsState: ReadState,
  changes: { n: number | null | undefined; state: ReadState } | null,
): { waiting: number; kinds: DraftKinds; state: ReadState } {
  const queue = (rows ?? []).filter((d) => isStream2Capability(d.capability));
  // CHECKIN-DRAFT-M: Roman's replies to check-ins are cards in the drafts list too, counted once here (no chip: the
  // operator's ruling on REC 2, w203ci; undo "checkin chip").
  const checkInReplies = (rows ?? []).filter((d) => checkInDraftOf(d) !== null).length;
  const n = (cap: string) => queue.filter((d) => d.capability === cap).length;
  // #197-E5: workout-change approvals are tiles in Roman's drafts, counted here once (never in Needs you).
  const workoutChanges = changes?.n ?? 0;
  const changesState: ReadState = changes ? changes.state : 'ok';
  const state: ReadState = rowsState === 'error' || changesState === 'error' ? 'error'
    : rowsState === 'loading' || changesState === 'loading' ? 'loading' : 'ok';
  return {
    waiting: queue.length + checkInReplies + workoutChanges,
    kinds: { workouts: n('draft.assign_workout'), mealPlans: n('draft.assign_meal_plan'), nudges: n('draft.send_notification'), workoutChanges },
    state,
  };
}

/** The chip words both of Roman's cards draw (coach Home and the Messages card); kinds with none are left out. */
export function draftChips(k: DraftKinds): DraftKindCount[] {
  return ([
    [k.workouts, 'Workout', 'Workouts'], [k.mealPlans, 'Meal plan', 'Meal plans'], [k.nudges, 'Nudge', 'Nudges'],
    [k.workoutChanges, 'Workout change', 'Workout changes'], // #197-E5: the approvals clients asked for
  ] as const)
    .filter(([c]) => c > 0)
    .map(([c, one, many]) => ({ count: c, label: c === 1 ? one : many }));
}
