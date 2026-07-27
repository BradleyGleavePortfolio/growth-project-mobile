/**
 * Request correlation (M5-D).
 *
 * Why this exists: when a coach's import fails there is currently no way to tie
 * what they saw to a backend log line. Support asks "what happened?", the coach
 * can only answer "it said it failed", and the request is unfindable. The
 * backend already stamps a RequestId on responses (`request_id` on the typed
 * ImportErrorEnvelope), but mobile neither sent one nor read one back.
 *
 * Two halves, both deliberately boring:
 *   • OUTBOUND — every request carries a fresh `X-Request-Id`. It is a v4 UUID
 *     from the single crypto-grade source (utils/idempotency), so it is
 *     unlinkable across requests and encodes NOTHING about the user, the
 *     device, or the payload. It is not an identifier, not a session token, and
 *     not a fingerprint; a server that ignores the header loses nothing.
 *   • INBOUND — `extractRequestId` reads back whatever the server chose to
 *     correlate with, preferring the typed `request_id` in the error body and
 *     falling back to the `x-request-id` response header.
 *
 * Honesty (Rule 18): a support reference is NOT a diagnosis. Surfacing one says
 * only "quote this to support"; it never implies the failure is understood, is
 * retryable, or has been reported anywhere.
 */
import { randomUuid } from './idempotency';

/** Header name for the outbound correlation id. Lives in exactly one place. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Fresh, opaque, per-request correlation id. Carries no user or device data. */
export function newRequestId(): string {
  return randomUuid();
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const direct = (headers as Record<string, unknown>)[name];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  // Axios lowercases response header keys, but a raw fetch/Headers-like object
  // may not; scan case-insensitively rather than guessing the casing.
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name && typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Pull the server's correlation id out of a failed request, or null when the
 * server did not supply one. Never invents a value: showing a reference the
 * backend cannot look up is worse than showing none (Rule 18).
 */
export function extractRequestId(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const response = (err as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return null;

  const data = (response as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    const fromBody = (data as { request_id?: unknown }).request_id;
    if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  }
  return headerValue((response as { headers?: unknown }).headers, 'x-request-id');
}
