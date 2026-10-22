/**
 * BRIEF-AGG: the one place the daily brief's action rows come from, and where
 * every brief item opens (actionTarget). No components, no screen imports.
 *
 * Client kinds count distinct clients per item type: one named client gets a
 * row for that client ("Reply to Sarah"); two or more, or one with no usable
 * first name, get one row for the full list ("See weight logs"). Head coach
 * items get one row per place they open: Money, and Team only while Team Mode
 * is on. Kinds go in a fixed order (messages, weight, check-ins, new clients,
 * Money, Team). A brief from a server that sends the check-in and new-client
 * rows (brief_context.checkins_to_review, b#1118) keeps every kind and its list
 * rows fold open in place (ROMAN-EXTRAS-M, Style A); an older brief keeps the
 * first two kinds and its list rows open the list, as before. compareBrief
 * picks the entry kept for a repeated client and sorts every list (reviews
 * before missed check-ins, then newest first, then compareEntries), so any
 * input order gives the same rows. Unknown kinds (and the retired
 * workout_approval), client items with no client_id and items with nowhere to
 * open give no row, never a dead button.
 */
import type { CoachBriefActionItem } from '../../../api/coachBriefApi';
import { featureFlags } from '../../../config/featureFlags';
import type { CoachTabParamList } from '../../../navigation/CoachNavigator';
import { chatTarget } from '../../../navigation/coachInbox';

export type BriefListKind = 'messages' | 'weight' | 'checkins' | 'welcome';
export type BriefKind = BriefListKind | 'money' | 'team';

export type BriefTarget = { tab: keyof CoachTabParamList; params?: object };

export type BriefAction =
  | { kind: BriefKind; label: string; opens: 'screen'; target: BriefTarget }
  | { kind: BriefListKind; label: string; opens: 'list'; items: CoachBriefActionItem[]; fold?: true };

/** An older brief shows at most two suggested actions; "Thank you, Roman" always follows them. */
export const MAX_BRIEF_ACTIONS = 2;

/** True when the server sends the check-in and new-client rows (b#1118 sets this on every solo brief with clients). */
export function briefHasExtras(summary: { brief_context?: { checkins_to_review?: number } | null } | null | undefined): boolean {
  return typeof summary?.brief_context?.checkins_to_review === 'number';
}

/** Where an action item opens. null = informational row (no tap). */
export function actionTarget(item: CoachBriefActionItem, teamMode: boolean = featureFlags.teamMode): BriefTarget | null {
  const clientId = item.client_id;
  const clientName = item.client_name ?? 'Client';
  switch (item.type) {
    case 'message_unread':
    case 'client_joined':
      return clientId ? chatTarget(clientId, clientName) : null;
    // An older server may still send a workout item. Nothing in the app
    // approves a workout, so it opens the client's workout history
    // (S-BRIEF-124 B-398-1) and never says approve.
    case 'workout_approval':
      return clientId
        ? {
            tab: 'ClientsStack',
            params: {
              screen: 'ClientDetail',
              params: { clientId, clientName, initialTab: 'workouts' },
              initial: false,
            },
          }
        : null;
    case 'weight_flag':
    case 'checkin_missing':
    case 'checkin_review':
      return clientId
        ? {
            tab: 'ClientsStack',
            params: { screen: 'ClientDetail', params: { clientId, clientName }, initial: false },
          }
        : null;
    case 'dunning_queue':
    case 'team_revenue_review':
      // COACHTABS: Money is its own tab when coachTabsV2 is on.
      return featureFlags.coachTabsV2
        ? { tab: 'MoneyStack', params: { screen: 'CoachMoney', pop: true } }
        : { tab: 'SettingsStack', params: { screen: 'CoachMoney', initial: false } };
    case 'sub_coach_operations':
    case 'team_performance':
      return teamMode ? { tab: 'TeamStack' } : null;
    default:
      return null;
  }
}

const KIND_OF: Record<string, BriefKind> = {
  message_unread: 'messages',
  weight_flag: 'weight',
  checkin_missing: 'checkins',
  checkin_review: 'checkins',
  client_joined: 'welcome',
  dunning_queue: 'money',
  team_revenue_review: 'money',
  sub_coach_operations: 'team',
  team_performance: 'team',
};

const ORDER: readonly BriefKind[] = ['messages', 'weight', 'checkins', 'welcome', 'money', 'team'];

const isListKind = (kind: BriefKind): kind is BriefListKind => kind !== 'money' && kind !== 'team';

const ONE: Record<BriefListKind, (name: string) => string> = {
  messages: (name) => `Reply to ${name}`,
  weight: (name) => `Review ${name}\u2019s weight change`,
  checkins: (name) => `Check on ${name}`,
  welcome: (name) => `Say hello to ${name}`,
};

const LABEL: Record<BriefKind, string> = {
  messages: 'See messages',
  weight: 'See weight logs',
  checkins: 'See check-ins',
  welcome: 'See new clients',
  money: 'See payments',
  team: 'See your team',
};

/** The server writes "Client" when a client has no name; that is never shown as a name. */
const NAME_PLACEHOLDER = 'Client';

/** The first word of a client's name, or null when there is no real name to use. */
export function briefFirstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first && first !== NAME_PLACEHOLDER ? first : null;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One total order over a kind's entries: a usable name first, then by name,
 * priority, detail, id and link. It picks the entry kept for a repeated client
 * and the order of every list, so neither depends on the order items arrived.
 */
export function compareEntries(a: CoachBriefActionItem, b: CoachBriefActionItem): number {
  const an = (a.client_name ?? '').trim();
  const bn = (b.client_name ?? '').trim();
  return (
    Number(!briefFirstName(an)) - Number(!briefFirstName(bn)) ||
    an.localeCompare(bn) ||
    cmp(an, bn) ||
    a.priority - b.priority ||
    cmp(a.detail, b.detail) ||
    cmp(a.client_id ?? '', b.client_id ?? '') ||
    cmp(a.client_name ?? '', b.client_name ?? '') ||
    cmp(a.deep_link ?? '', b.deep_link ?? '')
  );
}

const time = (item: CoachBriefActionItem): number | null => {
  const t = Date.parse(item.occurred_at ?? '');
  return Number.isNaN(t) ? null : t;
};

/** A kind's list order: reviews before missed check-ins, then newest first when both items have a time, then compareEntries. */
export function compareBrief(a: CoachBriefActionItem, b: CoachBriefActionItem): number {
  const [x, y] = [time(a), time(b)];
  return (
    Number(a.type === 'checkin_missing') - Number(b.type === 'checkin_missing') ||
    Number(x === null) - Number(y === null) ||
    (x !== null && y !== null ? y - x : 0) ||
    compareEntries(a, b)
  );
}

/** Items whose detail names a group ("Check-in needs review", "Joined today"); the list shows each group under it. */
const GROUPED = new Set(['checkin_review', 'checkin_missing', 'client_joined']);

/** A list's groups in first-seen order; title null = one ungrouped run (each row keeps its own detail). */
export function briefSections(items: readonly CoachBriefActionItem[]): { title: string | null; items: CoachBriefActionItem[] }[] {
  const groups = new Map<string, { title: string | null; items: CoachBriefActionItem[] }>();
  for (const item of items) {
    const title = GROUPED.has(item.type) ? item.detail : null;
    const group = groups.get(title ?? '') ?? { title, items: [] };
    group.items.push(item);
    groups.set(title ?? '', group);
  }
  return [...groups.values()];
}

function clientRow(kind: BriefListKind, group: CoachBriefActionItem[], teamMode: boolean, fold: boolean): BriefAction {
  const name = group.length === 1 ? briefFirstName(group[0].client_name) : null;
  const target = name ? actionTarget(group[0], teamMode) : null;
  if (name && target) return { kind, label: ONE[kind](name), opens: 'screen', target };
  const list = { kind, label: LABEL[kind], opens: 'list' as const, items: group };
  return fold ? { ...list, fold } : list;
}

export function selectBriefActions(
  items: readonly CoachBriefActionItem[] | null | undefined,
  { teamMode = featureFlags.teamMode, extras = false }: { teamMode?: boolean; extras?: boolean } = {},
): BriefAction[] {
  // One entry per client and item type, so a client both waiting on a review and missing today counts in each.
  const clients = new Map<BriefListKind, Map<string, CoachBriefActionItem>>();
  // Every item of a business kind opens the same place, so one row per kind.
  const places = new Map<BriefKind, BriefTarget>();
  for (const item of items ?? []) {
    const kind = item ? KIND_OF[item.type] : undefined;
    if (!kind) continue;
    if (!isListKind(kind)) {
      const target = actionTarget(item, teamMode);
      if (target) places.set(kind, target);
      continue;
    }
    const id = item.client_id?.trim();
    if (!id) continue;
    const group = clients.get(kind) ?? new Map<string, CoachBriefActionItem>();
    const seen = group.get(`${item.type}:${id}`);
    if (!seen || compareBrief(item, seen) < 0) group.set(`${item.type}:${id}`, item);
    clients.set(kind, group);
  }
  const rows: BriefAction[] = [];
  for (const kind of ORDER) {
    if (!extras && rows.length === MAX_BRIEF_ACTIONS) break;
    const group = isListKind(kind) ? clients.get(kind) : undefined;
    const target = places.get(kind);
    if (group && isListKind(kind)) rows.push(clientRow(kind, [...group.values()].sort(compareBrief), teamMode, extras));
    else if (target) rows.push({ kind, label: LABEL[kind], opens: 'screen', target });
  }
  return rows;
}
