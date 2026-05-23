/**
 * Locale-aware date bucketing for the user's current timezone.
 *
 * Returns a `YYYY-MM-DD` string that reflects the calendar day in the
 * device's local timezone — *not* UTC. This is the only correct way to
 * group "what day is it for the user right now" once you stop assuming
 * everyone lives at UTC+0.
 *
 * Why this exists:
 *   `new Date().toISOString().split('T')[0]` returns the UTC calendar day.
 *   A user in Sydney (UTC+10/+11) opening the app at 09:00 local on Mar 5
 *   gets `2026-03-04` from the UTC string — the previous day. That breaks
 *   streak math, weekly bucketing, "today's macros" lookups, and any other
 *   per-day key derived from `Date`. See audit P0-3 / P0-4.
 *
 * Uses `Intl.DateTimeFormat('en-CA', ...)` because `en-CA` natively formats
 * as `YYYY-MM-DD`, sidestepping locale-specific separators and any DST
 * gotchas that `setDate()` arithmetic introduces.
 */
const defaultBucketFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const bucketFormatterCache = new Map<string, Intl.DateTimeFormat>();
function bucketFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = bucketFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    });
    bucketFormatterCache.set(timeZone, f);
  }
  return f;
}

export function bucketDateLocal(date: Date = new Date(), timeZone?: string): string {
  const fmt = timeZone ? bucketFormatterFor(timeZone) : defaultBucketFormatter;
  return fmt.format(date);
}

/**
 * Local-timezone "today" as `YYYY-MM-DD`. Backed by {@link bucketDateLocal}
 * so write-time and read-time always agree on what "today" means for the
 * user — even on the user's side of the international date line.
 */
export function getTodayString(): string {
  return bucketDateLocal();
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

export function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return bucketDateLocal(date);
}

/**
 * Monday-anchored week start in the user's local timezone, as `YYYY-MM-DD`.
 * Anchors via the bucketed local day so the math stays correct across DST
 * transitions and never produces an "off-by-one Sunday evening" bucket
 * for users east of UTC. See audit P0-4.
 *
 * @param offset Number of weeks to shift (negative = past, positive = future).
 * @param timeZone Optional override for tests; production uses the device tz.
 */
export function getLocalWeekStart(offset = 0, timeZone?: string): string {
  // Anchor the "what day is it" question in the user's local calendar by
  // parsing the bucketed YYYY-MM-DD back into a date. This sidesteps the
  // DST off-by-one that bites `today.getDay()` when the JS runtime's
  // timezone drift puts a local Sunday evening into UTC's Monday.
  const todayBucket = bucketDateLocal(new Date(), timeZone);
  const anchor = new Date(`${todayBucket}T00:00:00Z`);
  const day = anchor.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const daysToMonday = day === 0 ? -6 : 1 - day;
  anchor.setUTCDate(anchor.getUTCDate() + daysToMonday + offset * 7);
  // Format directly from the UTC anchor — we want the Y-M-D string
  // without re-applying a tz shift.
  const y = anchor.getUTCFullYear();
  const m = String(anchor.getUTCMonth() + 1).padStart(2, '0');
  const d = String(anchor.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
