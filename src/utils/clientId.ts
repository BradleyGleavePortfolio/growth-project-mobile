/**
 * generateClientId — a stable, crypto-grade per-row client identifier.
 *
 * MWB-4 #237 (D-045): the coach workout builder must distinguish "this exact
 * on-device row" across the autosave insert/adoption window. A row added on
 * device has no server `row_id` until the post-insert refetch adopts one, so a
 * delete issued in that window cannot be named by server id. We therefore stamp
 * every local row with a `clientId` at creation and track deletes by that
 * stable key, so a delete-before-adoption is preserved (and re-deleted on the
 * server) rather than resurrected by the refetch.
 *
 * This is a CLIENT-ONLY field: it is never serialized into the autosave op diff
 * or the explicit-Save (PUT replace-all) payload — the working copy the diff
 * runs over carries only the server-facing fields, so the wire contract and the
 * DB schema are unchanged (R69).
 *
 * Crypto source: `crypto.getRandomValues` (Web Crypto API), polyfilled for
 * React Native / Hermes by `react-native-get-random-values` (imported as the
 * very first module in `index.ts`). This mirrors `generateIdempotencyKey` so
 * there is a single crypto-grade code path in ALL builds — dev, Expo Go, and
 * production — with NO `Math.random` fallback anywhere (R19). If the polyfill
 * is missing the function THROWS rather than silently emitting a weak id.
 */

function uuidV4FromBytes(bytes: Uint8Array): string {
  // Set v4 (random) version + RFC 4122 variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
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

export function generateClientId(): string {
  // Single crypto-grade path: Web Crypto API polyfilled by
  // react-native-get-random-values (imported at the top of index.ts). Works
  // identically in dev builds, Expo Go, and production — no Math.random
  // fallback at any layer (R19).
  const c = (
    globalThis as {
      crypto?: { getRandomValues?: <T extends ArrayBufferView>(array: T) => T };
    }
  ).crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return uuidV4FromBytes(bytes);
  }

  // R19 — no Math.random fallback. If crypto.getRandomValues is unavailable
  // (polyfill not imported before this module), throw rather than silently
  // emit a weak key.
  throw new Error(
    'generateClientId: crypto.getRandomValues is unavailable. ' +
      'Ensure react-native-get-random-values is imported first in index.ts.',
  );
}
