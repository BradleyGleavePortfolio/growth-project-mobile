// When a failed send from an offline queue (foods, workouts) is tried again
// later, and how long to wait first. One rule for every queue.
//
// Try again later: no answer (no signal, timeout), 401 (the session is renewed
// first), 408, 425, 429 and 5xx. Any other 4xx refuses this entry for good,
// and the queue parks it on the phone rather than sending it again.

/** Longest Retry-After a queue waits out, so a bad header cannot stall it for hours. */
export const MAX_RETRY_AFTER_MS = 15 * 60_000;

const RETRY_LATER_4XX = [401, 408, 425, 429];

type ErrorResponse = { status?: unknown; headers?: Record<string, unknown> };

const responseOf = (err: unknown) => (err as { response?: ErrorResponse } | null)?.response;

export function isRetryLater(err: unknown): boolean {
  const status = responseOf(err)?.status;
  if (typeof status !== 'number' || status < 400 || status >= 500) return true;
  return RETRY_LATER_4XX.includes(status);
}

/** The server's Retry-After (seconds or an HTTP date) in ms, capped; 0 when absent. */
export function retryAfterMs(err: unknown, now = Date.now()): number {
  const raw = responseOf(err)?.headers?.['retry-after'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return 0;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(raw)) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : 0;
}
