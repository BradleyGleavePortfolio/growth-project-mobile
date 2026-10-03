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

/** Deeper than this a branch is replaced, never forwarded unscrubbed. */
const MAX_DEPTH = 8;
/** Entries kept per array or object; the rest are dropped (C-327-2 breadth bound). */
const MAX_ENTRIES = 200;
const CIRCULAR = "[circular]";
const TOO_DEEP = "[redacted: nested too deep]";

/**
 * Return a scrubbed COPY of a JSON-like value (C-327-2). The caller's value
 * is never written to: console breadcrumbs carry the app's live objects by
 * reference, so an in-place scrub would rewrite the running app's state.
 * Arrays and objects are rebuilt; an Error becomes { name, message, stack }
 * with scrubbed text; cycles become "[circular]"; branches deeper than
 * MAX_DEPTH become a fixed marker; at most MAX_ENTRIES entries per level.
 */
export function scrubValue<T>(value: T): T {
  return scrubAny(value, 0, new WeakSet()) as T;
}

function scrubAny(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return scrubText(value);
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (depth > MAX_DEPTH) return TOO_DEEP;
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ENTRIES)
        .map((item) => scrubAny(item, depth + 1, seen));
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: scrubText(value.message),
        ...(value.stack ? { stack: scrubText(value.stack) } : {}),
      };
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, MAX_ENTRIES)) {
      out[key] = scrubAny(Reflect.get(value, key), depth + 1, seen);
    }
    return out;
  } finally {
    // Siblings may share a sub-object; only a true cycle is cut.
    seen.delete(value);
  }
}

/** Sentry `beforeSend` / `beforeBreadcrumb` body: return a scrubbed copy. */
export function scrubEvent<E extends object>(event: E): E {
  return scrubValue(event);
}
