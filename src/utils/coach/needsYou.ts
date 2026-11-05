/**
 * NEEDS-YOU-M (agent 197; GOAL planning/MOCKUP3/NEEDS-YOU-R2, list variant B, owner #197-E5): one rule for the coach
 * Home's Needs you card and the Needs you list, so the card's numbers are the list's.
 *
 * Attention: Safety (the three Roman safety alerts, pinned first), Alerts (every other open alert), Gone quiet (Nudge)
 * and New this week (Say hello). Routine: check-ins to review and messages to answer. Each open alert is one item;
 * each client is one item in the group of their most urgent reason, so a client with an alert and a message counts
 * once in each area. Workout-change approvals are not here: they are tiles in Roman's drafts, counted there once.
 */
import { isSafetyAlert, type ActionQueueItem } from '../../services/commandCenterApi';
import type { LookupReason, UnreadByClient } from './clientLookup';
import type { RosterClient } from './clientRoster';

export interface NeedsClientRow {
  client: RosterClient;
  reason: LookupReason;
  /** A second reason, as a tag under the row ("Also 1 check-in to review", NY-10). */
  also?: string;
}

export interface NeedsAreas {
  safety: ActionQueueItem[];
  alerts: ActionQueueItem[];
  quiet: NeedsClientRow[];
  fresh: NeedsClientRow[];
  routine: NeedsClientRow[];
  attention: number;
  routineCount: number;
  total: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Open alerts only (the queue also returns dismissed ones), safety first in the server's order. */
export function openAlerts(items: ReadonlyArray<ActionQueueItem> | null | undefined): ActionQueueItem[] {
  const open = (items ?? []).filter((i) => i.dismissed_at === null);
  return [...open.filter(isSafetyAlert), ...open.filter((i) => !isSafetyAlert(i))];
}

/**
 * `rows`: the active roster with each client's Needs you reason (needsYouReason), in the list's order.
 * `alerts`: the open alerts (null while unread, or when the read failed: no alert items then).
 * `blockedIds`: a blocked client's Reply is no action, so a waiting message never leads their row.
 */
export function needsYouAreas(
  rows: ReadonlyArray<{ client: RosterClient; reason: LookupReason }>,
  unread: UnreadByClient,
  alerts: ReadonlyArray<ActionQueueItem> | null,
  blockedIds: ReadonlySet<string> = new Set(),
): NeedsAreas {
  const all = openAlerts(alerts);
  const safety = all.filter(isSafetyAlert);
  const others = all.filter((i) => !isSafetyAlert(i));
  const quiet: NeedsClientRow[] = [];
  const fresh: NeedsClientRow[] = [];
  const routine: NeedsClientRow[] = [];
  for (const { client, reason } of rows) {
    if (reason.action === 'nudge') quiet.push({ client, reason });
    else if (reason.action === 'hello') fresh.push({ client, reason });
    else if (reason.action === 'review') {
      // ND-9 (GOAL N2): the drawn Routine row leads with Reply when a message waits; the check-ins become its tag.
      const messages = unread[client.id] ?? 0;
      routine.push(messages > 0 && !blockedIds.has(client.id)
        ? { client, reason: { text: plural(messages, 'new message', 'new messages'), action: 'reply', ok: false }, also: `Also ${reason.text}` }
        : { client, reason });
    } else if (reason.action === 'reply') routine.push({ client, reason });
  }
  // GOAL N1: Gone quiet reads longest quiet first (8, 6, then 4 days); the sort is stable for equal days.
  quiet.sort((a, b) => (a.client.activity?.lastActiveOn ?? '').localeCompare(b.client.activity?.lastActiveOn ?? ''));
  const attention = safety.length + others.length + quiet.length + fresh.length;
  return { safety, alerts: others, quiet, fresh, routine, attention, routineCount: routine.length, total: attention + routine.length };
}

export type NeedsLead =
  | { kind: 'safety'; name: string }
  | { kind: 'alert'; name: string; text: string }
  | { kind: 'client'; row: NeedsClientRow };

/** The Home card's lead: the list's first row (Attention before Routine). */
export function needsLead(a: NeedsAreas): NeedsLead | null {
  if (a.safety[0]) return { kind: 'safety', name: a.safety[0].client_name };
  if (a.alerts[0]) return { kind: 'alert', name: a.alerts[0].client_name, text: a.alerts[0].message };
  const row = a.quiet[0] ?? a.fresh[0] ?? a.routine[0];
  return row ? { kind: 'client', row } : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** An alert's time (GOAL N1): "Today, 7:10 am", "Yesterday", "Wed 21 Oct". Empty for a bad date. */
export function alertWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) {
    const h = d.getHours();
    return `Today, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  }
  if (days === 1) return 'Yesterday';
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** A safety alert's time (GOAL N1 "Sent 2 h ago"): minutes, then hours, then the day. */
export function sentAgo(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const min = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60_000));
  if (min < 60) return `Sent ${Math.max(1, min)} min ago`;
  if (min < 24 * 60) return `Sent ${Math.floor(min / 60)} h ago`;
  const when = alertWhen(iso, now);
  return `Sent ${when === 'Yesterday' ? 'yesterday' : when}`;
}
