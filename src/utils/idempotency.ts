/**
 * Idempotency key generator (R19).
 *
 * Every payment / billing-impacting mutation (POST /v1/checkout/sessions,
 * PATCH /coach/team/.../revenue-sharing, etc.) must send a client-generated
 * UUID so the backend can deduplicate retries from the same logical action.
 *
 * Crypto source: `crypto.getRandomValues` (Web Crypto API), polyfilled for
 * React Native / Hermes by `react-native-get-random-values` which is
 * imported as the very first module in `index.ts`. This ensures a single
 * crypto-grade code path in ALL builds — dev, Expo Go, and production —
 * with no `Math.random` fallback anywhere in the chain.
 *
 * The polyfill MUST be imported before this module. If it is missing, the
 * function will throw (via the error below) rather than silently fall back
 * to a weak source, honoring R19's "no Math.random sources, ever" requirement.
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
  // Single crypto-grade path: Web Crypto API polyfilled by
  // react-native-get-random-values (imported at the top of index.ts).
  // Works identically in dev builds, Expo Go, and production — no
  // Math.random fallback at any layer.
  const c = (globalThis as { crypto?: { getRandomValues?: <T extends ArrayBufferView>(array: T) => T } }).crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return uuidFromBytes(bytes);
  }

  // R19 — no Math.random fallback. If crypto.getRandomValues is unavailable
  // (polyfill not imported before this module), throw rather than silently
  // emit a weak key.
  throw new Error(
    'generateIdempotencyKey: crypto.getRandomValues is unavailable. ' +
      'Ensure react-native-get-random-values is imported first in index.ts.',
  );
}
