/**
 * Pure helpers for the coach broadcasts screens: audience -> segment, repeat
 * choice -> recurrence, list grouping and the plain-words lines on each row.
 */
import type {
  Broadcast,
  BroadcastRecurrence,
  BroadcastSegment,
  RecurrenceInput,
} from '../../../api/broadcastsApi';

export type AudienceKind = 'all' | 'tag' | 'package' | 'program';
export interface Audience {
  kind: AudienceKind;
  /** Tags, package ids or program ids; ignored for 'all'. */
  values: string[];
}

export type RepeatKind = 'none' | 'daily' | 'weekly' | 'monthly';
export interface RepeatChoice {
  kind: RepeatKind;
  /** "HH:MM", 24-hour wall time on the coach's phone. */
  localTime: string;
  /** 0 = Sunday .. 6 = Saturday (weekly). */
  weekdays: number[];
  /** 1-31 (monthly); short months use their last day. */
  monthDay: number;
}

export const BODY_MAX = 4000;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The audience as the backend segment ({ match, rules }); 'all' is no rules. */
export function segmentFor(a: Audience): BroadcastSegment {
  if (a.kind === 'all' || a.values.length === 0) return { match: 'all', rules: [] };
  return { match: 'all', rules: [{ field: a.kind, op: 'in', values: [...a.values] }] };
}

/** A complete audience: 'all', or a filter with at least one value picked. */
export function audienceReady(a: Audience): boolean {
  return a.kind === 'all' || a.values.length > 0;
}

export function recurrenceFor(r: RepeatChoice): RecurrenceInput | null {
  if (r.kind === 'none') return null;
  const base = { freq: r.kind, interval: 1, local_time: r.localTime } as const;
  if (r.kind === 'weekly') return { ...base, by_weekday: [...r.weekdays].sort((x, y) => x - y) };
  if (r.kind === 'monthly') return { ...base, by_month_day: r.monthDay };
  return { ...base };
}

/** "HH:MM" -> "9:00 AM" style, in the phone's locale. */
export function formatLocalTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A Date's wall time as "HH:MM". */
export function toLocalTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "Every Sunday at 9:00 AM", "Every day at 7:00 AM", "Every month on day 1 at 9:00 AM". */
export function describeRepeat(r: Pick<BroadcastRecurrence, 'freq' | 'interval' | 'local_time' | 'by_weekday' | 'by_month_day'>): string {
  const at = `at ${formatLocalTime(r.local_time)}`;
  const n = r.interval > 1 ? r.interval : null;
  if (r.freq === 'daily') return n ? `Every ${n} days ${at}` : `Every day ${at}`;
  if (r.freq === 'weekly') {
    const days = (r.by_weekday ?? []).map((d) => WEEKDAYS[d]).filter(Boolean);
    const on = days.length ? joinWords(days) : 'week';
    return n ? `Every ${n} weeks on ${on} ${at}` : `Every ${on} ${at}`;
  }
  const day = r.by_month_day ? `on day ${r.by_month_day}` : 'on the same day';
  return n ? `Every ${n} months ${day} ${at}` : `Every month ${day} ${at}`;
}

/** Who a stored broadcast goes to, in a few words. */
export function describeAudience(s: BroadcastSegment): string {
  if (s.rules.length === 0) return 'All clients';
  if (s.rules.length > 1) return 'Clients matching several filters';
  const r = s.rules[0];
  const n = r.values?.length ?? 0;
  if (r.field === 'tag' && r.op === 'in') return `Clients tagged ${joinWords((r.values ?? []).map(String))}`;
  if (r.field === 'package') return n === 1 ? 'Clients on 1 package' : `Clients on ${n} packages`;
  if (r.field === 'program') return n === 1 ? 'Clients on 1 program' : `Clients on ${n} programs`;
  return 'Clients matching a filter';
}

export type BroadcastSection = 'scheduled' | 'recurring' | 'sent';
const DONE = new Set(['sent', 'canceled', 'failed']);

export function sectionOf(b: Broadcast): BroadcastSection {
  if (b.recurrence && !DONE.has(b.status)) return 'recurring';
  if (!b.recurrence && (b.status === 'scheduled' || b.status === 'paused' || b.status === 'draft')) return 'scheduled';
  return 'sent';
}

export const STATUS_LABELS: Record<Broadcast['status'], string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  paused: 'Paused',
  canceled: 'Canceled',
  failed: 'Not sent',
};

/** The second line of a row: when it goes out, or what happened. */
export function describeTiming(b: Broadcast): string {
  if (b.status === 'canceled') return 'Canceled. Copies already delivered stay in client threads.';
  if (b.status === 'failed') return 'Not sent. Create it again to retry.';
  if (b.status === 'paused') return b.recurrence ? `${describeRepeat(b.recurrence)}. Paused.` : 'Paused. Resume to send it.';
  if (b.recurrence) {
    const next = b.next_run_at ? ` Next: ${formatWhen(b.next_run_at)}.` : '';
    return `${describeRepeat(b.recurrence)}.${next}`;
  }
  if (b.status === 'scheduled' && b.next_run_at) return `Sends ${formatWhen(b.next_run_at)}`;
  if (b.status === 'sending') return 'Sending now';
  return b.last_run_at ? `Sent ${formatWhen(b.last_run_at)}` : 'Sent';
}

/** "12 delivered, 5 read" (and the clients who will get it later). */
export function describeStats(b: Broadcast): string | null {
  const s = b.stats;
  if (!s || s.total === 0) return null;
  const parts = [`${s.delivered} delivered`, `${s.read} read`];
  const later = s.pending + s.deferred;
  if (later > 0) parts.push(`${later} waiting`);
  if (s.failed > 0) parts.push(`${s.failed} not delivered`);
  return parts.join(', ');
}

/** Can the coach cancel / pause / resume it from the list. */
export function actionsFor(b: Broadcast): Array<'cancel' | 'pause' | 'resume'> {
  if (DONE.has(b.status)) return [];
  if (b.status === 'paused') return ['resume', 'cancel'];
  if (b.recurrence && (b.status === 'scheduled' || b.status === 'sending')) return ['pause', 'cancel'];
  return ['cancel'];
}

/** The phone's IANA time zone; the backend schedules recurring sends in it. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** An Idempotency-Key for one send attempt (retries of the same tap reuse it). */
export function newIdempotencyKey(): string {
  return `bc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
