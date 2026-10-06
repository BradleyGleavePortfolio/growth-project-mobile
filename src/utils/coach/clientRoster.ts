/**
 * UX-COACHLOOKUP-124 — pure helpers for the coach's Clients list.
 *
 * GET /coach/clients rows carry an optional `activity` block (latest logged
 * day per slice and check-ins waiting for review; each slice null when the
 * client has not shared it with this coach). Older servers send no block:
 * every helper here treats that as "unknown" and falls back to the join date.
 */
import type { User } from '../../types';

export interface ClientActivity {
  /** False when the client shares no fitness slice with this coach. */
  shared: boolean;
  /** YYYY-MM-DD, latest day across the shared slices; null when none. */
  lastActiveOn: string | null;
  checkInsToReview: number | null;
}

export type RosterClient = User & { activity?: ClientActivity | null };

export type RosterSort = 'name' | 'recent';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the wire `activity` block; anything malformed reads as absent. */
export function rosterActivityFromWire(raw: unknown): ClientActivity | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const day = typeof a.last_active_on === 'string' && DAY_RE.test(a.last_active_on.slice(0, 10))
    ? a.last_active_on.slice(0, 10)
    : null;
  const review = typeof a.check_ins_to_review === 'number' && Number.isFinite(a.check_ins_to_review)
    ? Math.max(0, Math.floor(a.check_ins_to_review))
    : null;
  return { shared: a.shared === true, lastActiveOn: day, checkInsToReview: review };
}

export function rosterDisplayName(c: Pick<User, 'firstName' | 'lastName' | 'email'>): string {
  const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  return name || c.email || 'Unnamed client';
}

/**
 * Every word typed must appear in the full name or the email, so "ana lo"
 * finds Ana Lopez and a trailing space from the keyboard changes nothing.
 */
export function matchesRosterSearch(c: Pick<User, 'firstName' | 'lastName' | 'email'>, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${c.firstName ?? ''} ${c.lastName ?? ''} ${c.email ?? ''}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** Name A to Z, or most recently logged first (never logged last, then by name). */
export function sortRoster<T extends RosterClient>(clients: T[], sort: RosterSort): T[] {
  const byName = (a: T, b: T) =>
    rosterDisplayName(a).localeCompare(rosterDisplayName(b), undefined, { sensitivity: 'base' });
  const out = [...clients];
  if (sort === 'recent') {
    out.sort((a, b) => {
      const da = a.activity?.lastActiveOn ?? '';
      const db = b.activity?.lastActiveOn ?? '';
      if (da !== db) return da < db ? 1 : -1;
      return byName(a, b);
    });
  } else {
    out.sort(byName);
  }
  return out;
}

function localDayString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysAgo(day: string, today: Date): number {
  const [y, m, d] = day.split('-').map(Number);
  const [ty, tm, td] = localDayString(today).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Days without any shared log before a row reads as gone quiet. */
export const QUIET_AFTER_DAYS = 3;

export interface ActivityLine {
  text: string;
  /** 'ok' logged recently; 'quiet' nothing logged for QUIET_AFTER_DAYS or more; 'muted' unknown. */
  tone: 'ok' | 'quiet' | 'muted';
}

/**
 * The one line under each client's name: the latest day the client logged
 * anything this coach can see (food, workout, weigh-in or check-in).
 */
export function rosterActivityLine(c: RosterClient, today: Date = new Date()): ActivityLine {
  const a = c.activity;
  const joined = typeof c.createdAt === 'string' && DAY_RE.test(c.createdAt.slice(0, 10))
    ? `Joined ${shortDay(c.createdAt.slice(0, 10))}`
    : 'Client';
  if (!a) return { text: joined, tone: 'muted' };
  if (!a.shared) return { text: `${joined} · Logs not shared`, tone: 'muted' };
  if (!a.lastActiveOn) return { text: `${joined} · Nothing logged yet`, tone: 'quiet' };
  const n = daysAgo(a.lastActiveOn, today);
  if (n <= 0) return { text: 'Logged today', tone: 'ok' };
  if (n === 1) return { text: 'Logged yesterday', tone: 'ok' };
  const tone = n >= QUIET_AFTER_DAYS ? 'quiet' : 'ok';
  if (n < 14) return { text: `Last logged ${n} days ago`, tone };
  return { text: `Last logged ${shortDay(a.lastActiveOn)}`, tone };
}

/** "2 to review" for the row badge; null when nothing waits. */
export function rosterReviewBadge(c: RosterClient): string | null {
  const n = c.activity?.checkInsToReview ?? 0;
  return n > 0 ? `${n} to review` : null;
}

const FILTER_NOUN: Record<'all' | 'active' | 'archived', [string, string]> = {
  active: ['active client', 'active clients'],
  archived: ['archived client', 'archived clients'],
  all: ['client', 'clients'],
};

/**
 * Header count: "12 active clients", "3 of 12 active clients" while a search
 * narrows the list, plus the check-ins waiting across the shown clients.
 */
export function rosterCountLine(
  shown: RosterClient[],
  total: number,
  filter: 'all' | 'active' | 'archived',
  searching: boolean,
): string {
  const [one, many] = FILTER_NOUN[filter];
  const noun = total === 1 ? one : many;
  const base = searching ? `${shown.length} of ${total} ${noun}` : `${total} ${noun}`;
  const review = shown.reduce((sum, c) => sum + (c.activity?.checkInsToReview ?? 0), 0);
  if (review === 0) return base;
  return `${base} · ${review} check-in${review === 1 ? '' : 's'} to review`;
}
