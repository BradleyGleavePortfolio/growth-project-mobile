/**
 * AI daily cap (owner 2026-10-04 11:20, M-ROMANCAP): when a person reaches a
 * daily AI limit, every AI entry point shows one calm pop-up with the owner's
 * words and the local time it resets, never a generic error and never
 * "Roman is unavailable".
 *
 * Backend codes that mean "today's AI limit is reached" (growth-project-backend):
 *   - 429 `ROMAN_RATE_LIMIT` (roman.service.ts assertWithinRateLimit): the
 *     person's own Roman turns for a rolling 24 h (50 free / 500 pro). The
 *     controller sends the wait as a `Retry-After` header (seconds).
 *   - 503 `ROMAN_CAPACITY_REACHED` (backend #669 assertDailyCapacity /
 *     reserveDailySpend): the daily Roman spend cap (env
 *     ROMAN_DAILY_COST_CAP_USD, default 25 USD, UTC day). Sent as an HTTP body
 *     before the turn is stored, or as the in-stream `{ code, message }` frame.
 *   - 429 `AI_DAILY_QUOTA_EXCEEDED` (ai.service.ts reserveDailyTokens, in the
 *     legacy `error` slot): the AI guide's per-person daily token quota
 *     (DAILY_TOKEN_QUOTA, UTC day).
 * An uncoded 429 is the burst throttle, which clears within a minute; it keeps
 * its own short wait copy and never shows this pop-up.
 *
 * Crisis turns are exempt on the server (no cap is checked for them), so the
 * app never blocks the composer after a cap hit: a crisis message sent later
 * still reaches the safety answer.
 */
import { signedInClientIsCoachless } from './aiCoachless';

export const ROMAN_RATE_LIMIT_CODE = 'ROMAN_RATE_LIMIT';
export const ROMAN_CAPACITY_REACHED_CODE = 'ROMAN_CAPACITY_REACHED';
export const AI_DAILY_QUOTA_EXCEEDED_CODE = 'AI_DAILY_QUOTA_EXCEEDED';

/** The owner's words, verbatim. */
export const AI_DAILY_CAP_TITLE = "You've used your maximum AI allotment today.";
export const AI_DAILY_CAP_DISMISS = 'OK';

export type AiDailyCapAudience = 'client' | 'coach';

export interface AiDailyCap {
  /** When AI help is available again (absolute time; shown in local time). */
  resetsAt: Date;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The code of an error body: `code`, or the legacy `error` slot ai.service.ts uses. */
function capCodeOf(body: unknown): string | null {
  if (!isRecord(body)) return null;
  for (const key of ['code', 'error']) {
    const v = body[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/** Both backend daily buckets restart at midnight UTC. */
export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Read a Retry-After value (seconds) from a header or body field. */
export function retryAfterSecondsOf(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
}

function capWith(retryAfterSeconds: number | undefined, now: Date): AiDailyCap {
  return {
    resetsAt:
      retryAfterSeconds !== undefined
        ? new Date(now.getTime() + retryAfterSeconds * 1000)
        : nextUtcMidnight(now),
  };
}

/**
 * Map an HTTP status + parsed body to a daily cap, or null. The status AND the
 * code must match, so an uncoded throttle 429 stays a short wait.
 */
export function aiDailyCapFromHttp(
  status: number | null | undefined,
  body: unknown,
  retryAfterSeconds?: number,
  now: Date = new Date(),
): AiDailyCap | null {
  const code = capCodeOf(body);
  const bodyRetry = isRecord(body) ? retryAfterSecondsOf(body.retryAfterSeconds) : undefined;
  if (status === 429 && code === ROMAN_RATE_LIMIT_CODE) {
    return capWith(retryAfterSeconds ?? bodyRetry, now);
  }
  if (status === 503 && code === ROMAN_CAPACITY_REACHED_CODE) {
    return capWith(retryAfterSeconds ?? bodyRetry, now);
  }
  if (status === 429 && code === AI_DAILY_QUOTA_EXCEEDED_CODE) {
    // The quota is a UTC-day bucket; the throttler's Retry-After is unrelated.
    return capWith(undefined, now);
  }
  return null;
}

/** Roman's in-stream error frame (HTTP 200): only the spend cap code can arrive here. */
export function aiDailyCapFromStreamCode(
  code: string | null | undefined,
  now: Date = new Date(),
): AiDailyCap | null {
  return code === ROMAN_CAPACITY_REACHED_CODE ? capWith(undefined, now) : null;
}

/** Map an axios-style error (`err.response.{status,data,headers}`) to a daily cap. */
export function aiDailyCapOf(err: unknown, now: Date = new Date()): AiDailyCap | null {
  if (!isRecord(err)) return null;
  const response = err.response;
  if (!isRecord(response)) return null;
  const status = typeof response.status === 'number' ? response.status : null;
  const headers = isRecord(response.headers) ? response.headers : null;
  return aiDailyCapFromHttp(status, response.data, retryAfterSecondsOf(headers?.['retry-after']), now);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The reset time in the person's own time, e.g. "today at 5:00 PM". */
export function aiDailyCapResetPhrase(resetsAt: Date, now: Date = new Date()): string {
  const time = resetsAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDay(resetsAt, now)) return `today at ${time}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameLocalDay(resetsAt, tomorrow)) return `tomorrow at ${time}`;
  const day = resetsAt.toLocaleDateString(undefined, { weekday: 'long' });
  return `on ${day} at ${time}`;
}

/**
 * Pop-up body: when it resets, then what still works. A client with no coach
 * (`coachless`, defaults to the signed-in user) is never pointed to a coach.
 */
export function aiDailyCapBody(
  cap: AiDailyCap,
  audience: AiDailyCapAudience,
  now: Date = new Date(),
  coachless: boolean = signedInClientIsCoachless(),
): string {
  const next =
    audience === 'coach'
      ? 'Your clients, messages and the rest of the app work as usual.'
      : coachless
        ? 'Logging and the rest of the app work as usual.'
        : 'Your coach is in Messages any time, and your plan and logs work as usual.';
  return `AI help resets ${aiDailyCapResetPhrase(cap.resetsAt, now)}. ${next}`;
}
