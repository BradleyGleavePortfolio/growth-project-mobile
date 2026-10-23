/**
 * UI-4 (V1_1_UI_SPEC) — helpers for the coach client lookup. Reads only the
 * roster GET /coach/clients sends (server scoped: a moved client is never in
 * it) and GET /coach/messages/unread-count. Never invents a value: nothing
 * logged says so (owner #SHARE-SIMPLE: a client's logs reach their coach).
 */
import { cacheStorage } from '../../storage/mmkv';
import { QUIET_AFTER_DAYS, rosterActivityLine, rosterDisplayName, type RosterClient } from './clientRoster';

/** Under this many active clients the list is the Needs you layout. */
export const SEARCH_FIRST_AT = 15;
export const RECENT_MAX = 4;

export type LookupFilter = 'review' | 'messages' | 'quiet' | 'new';
export type UnreadByClient = Record<string, number>;

export const FILTER_LABELS: Record<LookupFilter, string> = {
  review: 'To review', messages: 'New messages', quiet: 'Quiet 3+ days', new: 'New this week',
};

/** A typed word that applies a filter, so "quiet ben" finds Ben Carter. */
const FILTER_WORDS: Record<string, LookupFilter> = { review: 'review', messages: 'messages', quiet: 'quiet', new: 'new' };

export function parseLookupQuery(query: string): { filters: LookupFilter[]; text: string } {
  const filters: LookupFilter[] = [];
  const rest: string[] = [];
  for (const w of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const f = FILTER_WORDS[w];
    if (f && !filters.includes(f)) filters.push(f);
    else if (!f) rest.push(w);
  }
  return { filters, text: rest.join(' ') };
}

export const firstName = (c: RosterClient) => c.firstName?.trim() || rosterDisplayName(c).split(/\s+/)[0];

export function initialsOf(c: RosterClient): string {
  const words = rosterDisplayName(c).split(/\s+/).filter(Boolean);
  const second = words.length > 1 ? words[words.length - 1][0] : '';
  return `${words[0]?.[0] ?? '?'}${second}`.toUpperCase();
}

function dayDiff(day: string, today: Date): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return Math.round(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(y, m - 1, d)) / 86_400_000,
  );
}

export const isNewThisWeek = (c: RosterClient, today: Date = new Date()) =>
  typeof c.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.createdAt) && dayDiff(c.createdAt, today) < 7;

export function matchesLookupFilter(
  c: RosterClient,
  f: LookupFilter,
  unread: UnreadByClient,
  today: Date = new Date(),
): boolean {
  switch (f) {
    case 'review':
      return (c.activity?.checkInsToReview ?? 0) > 0;
    case 'messages':
      return (unread[c.id] ?? 0) > 0;
    case 'quiet': {
      const a = c.activity;
      if (!a) return false; // older server: no activity block
      return a.lastActiveOn ? dayDiff(a.lastActiveOn, today) >= QUIET_AFTER_DAYS : !isNewThisWeek(c, today);
    }
    case 'new':
      return isNewThisWeek(c, today);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type LookupAction = 'review' | 'reply' | 'nudge' | 'hello';
/** text: the line under the name; action: what the client needs (null when steady); ok: logged recently (forest dot). */
export interface LookupReason { text: string; action: LookupAction | null; ok: boolean }

/** `variant` keeps each mockup's own words: "New, no logs yet" (under 15), "New, nothing logged yet" (recent). */
export function lookupReason(
  c: RosterClient,
  unread: UnreadByClient,
  variant: 'needs' | 'recent',
  today: Date = new Date(),
): LookupReason {
  const review = c.activity?.checkInsToReview ?? 0;
  if (review > 0) return { text: `${plural(review, 'check-in', 'check-ins')} to review`, action: 'review', ok: false };
  const messages = unread[c.id] ?? 0;
  if (messages > 0) return { text: plural(messages, 'new message', 'new messages'), action: 'reply', ok: false };
  const line = rosterActivityLine(c, today);
  const isNew = isNewThisWeek(c, today);
  if (isNew && !c.activity?.lastActiveOn) {
    return { text: variant === 'needs' ? 'New, no logs yet' : 'New, nothing logged yet', action: 'hello', ok: false };
  }
  const workoutToday = !!c.activity?.lastWorkoutOn && dayDiff(c.activity.lastWorkoutOn, today) <= 0;
  const text = line.text === 'Logged today' && workoutToday && variant === 'needs' ? 'Logged today, workout done' : line.text;
  if (isNew) return { text, action: null, ok: line.tone === 'ok' }; // first week: no Nudge yet
  if (line.tone === 'quiet') return { text, action: 'nudge', ok: false };
  return { text, action: null, ok: line.tone === 'ok' };
}

const WORDS = ['No one', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
/** A sentence never starts with a numeral: "Twenty-three", "One hundred and six" (any roster under 1,000). */
function word(n: number): string {
  if (n < 20) return WORDS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${word(n % 10).toLowerCase()}` : '');
  return n < 1000 ? `${WORDS[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${word(n % 100).toLowerCase()}` : ''}` : String(n);
}
/** Steady clients are counted while the coach can read them all (under 15); past that, the Everyone row holds the number. */
const STEADY_COUNTED_UP_TO = SEARCH_FIRST_AT - 1;

/** "Two need you today. One is steady." / "Twenty-three need you today. Everyone else is steady." */
export function needsYouSentence(needs: number, steady: number): string {
  const steadyPart = steady > STEADY_COUNTED_UP_TO ? (needs > 0 ? 'Everyone else is steady.' : 'Everyone is steady.')
    : steady > 0 ? `${word(steady)} ${steady === 1 ? 'is' : 'are'} steady.` : '';
  if (needs === 0) return steadyPart;
  const needsPart = `${word(needs)} ${needs === 1 ? 'needs' : 'need'} you today.`;
  return steadyPart ? `${needsPart} ${steadyPart}` : needsPart;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today, Yesterday, Thu (this week) or Sep 30 (concept 2's day forms). */
export function dayWord(day: string, today: Date = new Date()): string {
  const n = dayDiff(day, today);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  if (n < 7) return WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${MONTHS[m - 1]} ${d}`;
}

/** The right-hand word on an A to Z row. */
export function lastLoggedWord(c: RosterClient, today: Date = new Date()): string {
  const day = c.activity?.lastActiveOn;
  return day ? dayWord(day, today) : 'Nothing logged yet';
}

const letterOf = (c: RosterClient) => {
  const ch = rosterDisplayName(c).trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
};

/** A to Z sections; the input is already sorted by name. */
export function groupByLetter(clients: RosterClient[]): Array<{ letter: string; clients: RosterClient[] }> {
  const out: Array<{ letter: string; clients: RosterClient[] }> = [];
  for (const c of clients) {
    const letter = letterOf(c);
    const last = out[out.length - 1];
    if (last?.letter === letter) last.clients.push(c);
    else out.push({ letter, clients: [c] });
  }
  return out;
}

// Opened recently, on this phone: cacheStorage (cleared on sign-out). Ids are
// shown only once matched to the roster just loaded, so a moved client drops out (owner 4).
const recentKey = (coachId: string) => `coach_lookup_recent:${coachId}`;

export async function readRecentClientIds(coachId: string): Promise<string[]> {
  try {
    const raw = JSON.parse((await cacheStorage.getStringAsync(recentKey(coachId))) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export async function rememberRecentClient(coachId: string, clientId: string): Promise<string[]> {
  const next = [clientId, ...(await readRecentClientIds(coachId)).filter((id) => id !== clientId)].slice(0, RECENT_MAX);
  await cacheStorage.set(recentKey(coachId), JSON.stringify(next)).catch(() => undefined);
  return next;
}

export const recentFromRoster = (ids: string[], roster: RosterClient[]): RosterClient[] =>
  ids.map((id) => roster.find((c) => c.id === id)).filter((c): c is RosterClient => !!c);
