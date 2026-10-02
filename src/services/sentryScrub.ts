/**
 * Telemetry boundary for credentials that ride in URLs (B-327-6).
 *
 * A data-export download link is a live bearer credential for the person's
 * whole archive (`/v1/me/data-export/download?token=<jwt>`). React Native's
 * Linking rejections quote the URL they failed to open, and other libraries
 * may log URLs, so every event and breadcrumb is scrubbed before it leaves the
 * phone: token query values, JWT-shaped strings and the download route's
 * query are replaced, wherever they appear (message, exception values,
 * extras, contexts, tags, breadcrumbs, request URL and query string).
 * Support references (request ids) are plain UUID/hex values and survive.
 */

const REDACTED = "[redacted]";

const PATTERNS: Array<[RegExp, string]> = [
  // Anything after the download route's query marker.
  [/(\/data-export\/download)\?[^\s"'<>)]*/gi, `$1?${REDACTED}`],
  // token=..., access_token=..., signature=... in any URL or text.
  [
    /\b((?:access_|refresh_|id_)?token|signature|sig|code)=([^&\s"'<>)]+)/gi,
    `$1=${REDACTED}`,
  ],
  // JWT-shaped values (three base64url segments, the first a JSON header).
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, REDACTED],
  // Signed storage URLs, should one ever be logged.
  [/(\/storage\/v1\/object\/sign\/)[^\s"'<>)]*/gi, `$1${REDACTED}`],
];

/** Scrub one string. */
export function scrubText(text: string): string {
  let out = text;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Scrub every string inside a JSON-like value (bounded depth, cycles cut). */
export function scrubValue<T>(
  value: T,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (typeof value !== "object" || value === null || depth > 8) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1)
      value[i] = scrubValue(value[i], depth + 1, seen);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    record[key] = scrubValue(record[key], depth + 1, seen);
  }
  return value;
}

/** Sentry `beforeSend` / `beforeBreadcrumb` body: scrub in place and return. */
export function scrubEvent<E extends object>(event: E): E {
  return scrubValue(event);
}
