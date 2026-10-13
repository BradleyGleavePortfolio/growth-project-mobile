/**
 * BRIEF-AGG: the one place the daily brief's action rows come from.
 *
 * Items are grouped by kind and counted by distinct client. A kind with one
 * named client gets a row for that client ("Reply to Sarah"); a kind with two
 * or more clients, or one client with no usable first name, gets one row that
 * opens the full list ("See weight logs"). Kinds are taken in a fixed order
 * (messages, weight, check-ins, then the head coach's Money and Team) and only
 * the first two that have a row are kept, so the answer never depends on the
 * order the server sent the items in. Unknown kinds (including the retired
 * workout_approval), per-client items with no client_id and rows with no
 * destination are dropped, never shown as a dead button.
 */
import type { CoachBriefActionItem } from '../../../api/coachBriefApi';
import type { CoachTabParamList } from '../../../navigation/CoachNavigator';
import { actionTarget } from '../CoachBriefScreen';

export type BriefListKind = 'messages' | 'weight' | 'checkins';
type BriefKind = BriefListKind | 'money' | 'team';

export type BriefTarget = { tab: keyof CoachTabParamList; params?: object };

export type BriefAction =
  | { kind: BriefKind; label: string; opens: 'screen'; target: BriefTarget }
  | { kind: BriefListKind; label: string; opens: 'list'; items: CoachBriefActionItem[] };

/** At most two suggested actions; "Thank you, Roman" always follows them. */
export const MAX_BRIEF_ACTIONS = 2;

const KIND_OF: Record<string, BriefKind> = {
  message_unread: 'messages',
  weight_flag: 'weight',
  checkin_missing: 'checkins',
  dunning_queue: 'money',
  team_revenue_review: 'money',
  sub_coach_operations: 'team',
  team_performance: 'team',
};

const ORDER: readonly BriefKind[] = ['messages', 'weight', 'checkins', 'money', 'team'];

const ONE: Record<BriefListKind, (name: string) => string> = {
  messages: (name) => `Reply to ${name}`,
  weight: (name) => `Review ${name}\u2019s weight change`,
  checkins: (name) => `Check on ${name}`,
};

const MANY: Record<BriefListKind, string> = {
  messages: 'See messages',
  weight: 'See weight logs',
  checkins: 'See check-ins',
};

const BUSINESS: Record<'money' | 'team', string> = { money: 'See Money', team: 'See your team' };

/** The server writes "Client" when a client has no name; that is never shown as a name. */
const NAME_PLACEHOLDER = 'Client';

/** The first word of a client's name, or null when there is no real name to use. */
export function briefFirstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first && first !== NAME_PLACEHOLDER ? first : null;
}

function isListKind(kind: BriefKind): kind is BriefListKind {
  return kind in ONE;
}

function rowFor(kind: BriefKind, group: CoachBriefActionItem[]): BriefAction | null {
  if (!isListKind(kind)) {
    const target = actionTarget(group[0]);
    return target ? { kind, label: BUSINESS[kind], opens: 'screen', target } : null;
  }
  const name = group.length === 1 ? briefFirstName(group[0].client_name) : null;
  const target = name ? actionTarget(group[0]) : null;
  if (name && target) return { kind, label: ONE[kind](name), opens: 'screen', target };
  return { kind, label: MANY[kind], opens: 'list', items: group };
}

export function selectBriefActions(items: readonly CoachBriefActionItem[] | null | undefined): BriefAction[] {
  const byKind = new Map<BriefKind, Map<string, CoachBriefActionItem>>();
  for (const item of items ?? []) {
    const kind = item ? KIND_OF[item.type] : undefined;
    if (!kind) continue;
    // Per-client kinds count distinct clients; business kinds count item types.
    const id = isListKind(kind) ? item.client_id?.trim() : item.type;
    if (!id) continue;
    const group = byKind.get(kind) ?? new Map<string, CoachBriefActionItem>();
    const seen = group.get(id);
    // A repeat of the same client keeps one entry, preferring the one with a name.
    if (!seen || (!briefFirstName(seen.client_name) && briefFirstName(item.client_name))) group.set(id, item);
    byKind.set(kind, group);
  }
  const rows: BriefAction[] = [];
  for (const kind of ORDER) {
    const group = byKind.get(kind);
    if (rows.length === MAX_BRIEF_ACTIONS || !group) continue;
    const row = rowFor(kind, [...group.values()]);
    if (row) rows.push(row);
  }
  return rows;
}
