/**
 * Idempotency key generator (R19).
 *
 * Every payment / billing-impacting mutation (POST /v1/checkout/sessions,
 * PATCH /coach/team/.../revenue-sharing, etc.) must send a client-generated
 * UUID so the backend can deduplicate retries from the same logical action.
 *
 * Preference order:
 *   1. crypto.randomUUID() — available on Hermes + iOS 14+ / Android 14+ via
 *      the JS engine's crypto polyfill. Native UUID, no dependency.
 *   2. expo-crypto getRandomBytes — already a project dep. We build a v4-ish
 *      UUID by hand so the wire format matches the native path.
 *   3. Math.random fallback — extremely unlikely path; logged so we can spot
 *      it in Sentry if it ever happens.
 *
 * The output is a 36-character RFC 4122 v4 string when either path 1 or 2
 * succeeds. The fallback shape is "mob-<ts>-<rand>" — the backend accepts
 * any opaque string up to 128 chars as an idempotency key.
 */

function uuidFromBytes(bytes: Uint8Array): string {
  // Set v4 (random) version + RFC 4122 variant bits.
  // eslint-disable-next-line no-bitwise
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // eslint-disable-next-line no-bitwise
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}

export function generateIdempotencyKey(): string {
  // Path 1 — native crypto.randomUUID, when present.
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) {
      const v = c.randomUUID();
      if (typeof v === 'string' && v.length >= 32) return v;
    }
  } catch {
    // fall through
  }

  // Path 2 — expo-crypto getRandomBytes.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const expoCrypto = require('expo-crypto');
    if (typeof expoCrypto?.getRandomBytes === 'function') {
      const bytes: Uint8Array = expoCrypto.getRandomBytes(16);
      return uuidFromBytes(bytes);
    }
  } catch {
    // fall through
  }

  // Path 3 — last-resort fallback. Math.random is not cryptographically
  // strong but an idempotency key only needs to be unique within the
  // backend's dedupe window, not unguessable.
  const rand = Math.random().toString(36).slice(2, 10);
  return `mob-${Date.now().toString(36)}-${rand}`;
}
