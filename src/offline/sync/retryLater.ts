// When a failed send from an offline queue (foods, workouts) is tried again
// later, and how long to wait first. One rule for every queue.
//
// Try again later: no answer (no signal, timeout), 401 (the session is renewed
// first), 408, 425, 429 and 5xx. Any other 4xx refuses this entry for good,
// and the queue parks it on the phone rather than sending it again.

/**
 * Longest Retry-After a queue waits out. The backend's 429 filter sends 3600 s
 * for every throttler, but these routes use per-minute buckets (the same
 * reasoning as MAX_RETRY_WAIT_MS in services/health/ingestBatching.ts).
 */
export const MAX_RETRY_AFTER_MS = 60_000;

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
  const text = String(raw).trim();
  // Clamp the seconds before multiplying, so a huge value saturates at the cap.
  const ms = /^\d+$/.test(text)
    ? Math.min(Number(text), MAX_RETRY_AFTER_MS / 1000) * 1000
    : Date.parse(text) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : 0;
}

/** True while a hold set from retryAfterMs runs; one beyond the cap means the clock went back. */
export const isHeld = (until: number, now = Date.now()) => now < until && until - now <= MAX_RETRY_AFTER_MS;
