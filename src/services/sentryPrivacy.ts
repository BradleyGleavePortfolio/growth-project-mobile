import type { Breadcrumb, Event } from '@sentry/react-native';

import { sanitizeOtaEmergencyContext, sanitizeOtaUpdatesContext } from './otaUpdateShape';

/**
 * What the app lets Sentry keep (owner rule: no health data, no message
 * content, no PII; OR-112-15: the account id only, never the email).
 *
 * `sendDefaultPii: false` does not redact application content: the SDK still
 * records console text, XHR/fetch URLs with their query strings, and native
 * HTTP breadcrumbs that are merged into JS events. This module is the explicit
 * policy applied at the JS boundary (`beforeBreadcrumb`, `beforeSend`,
 * `beforeSendTransaction` in src/services/sentry.ts). Scope sync copies JS
 * breadcrumbs to native only after `beforeBreadcrumb`, so native crash
 * reports carry the same scrubbed breadcrumbs (B-330-3).
 *
 * Policy:
 *   - console breadcrumbs are dropped (their text can hold anything);
 *   - HTTP breadcrumbs (xhr, fetch, native http) keep method, status code and
 *     a route-shaped URL: no query, fragment or credentials, and every path
 *     segment that is not a plain lowercase word becomes `:id`;
 *   - touch breadcrumbs keep component and file names only (no labels);
 *   - every other breadcrumb keeps type, category, level and timestamp, plus
 *     a few structural data keys with identifier-like values; no message;
 *   - events keep `user.id` only, request URLs are route-shaped, and request
 *     bodies, cookies and query strings are removed;
 *   - transaction spans lose `http.query` / `http.fragment`, and URL
 *     attributes and http.client span names are route-shaped;
 *   - the over-the-air update contexts keep only their closed shapes
 *     (src/services/otaUpdateShape.ts, B-305-12): `ota_updates` loses every
 *     key outside its allowlist (the SDK's raw `emergency_launch_reason`
 *     first of all) and `ota_emergency` keeps only `reason_category`.
 */

type Data = Record<string, unknown>;

const SAFE_PATH_SEGMENT = /^(?:[a-z]+(?:[-_][a-z]+)*|v\d{1,2})$/;
const SCHEME_AND_AUTHORITY = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,80}$/;
const HTTP_METHOD = /^[A-Za-z]{3,10}$/;
const HTTP_CATEGORIES = new Set(['xhr', 'fetch', 'http']);
const STRUCTURAL_DATA_KEYS = ['state', 'action', 'from', 'to', 'screen'];
const URL_ATTRIBUTE_KEYS = ['url', 'http.url', 'server.url'];
const DROPPED_SPAN_KEYS = ['http.query', 'http.fragment', 'http.request.body', 'http.response.body'];

/** Placeholder for a URL that is not http(s) (data:, blob:, file:, ...). */
export const REDACTED_URL = '[redacted-url]';

/**
 * A URL reduced to its route: scheme, host and port, and the path with every
 * non-word segment replaced by `:id`. No credentials, query or fragment.
 */
export function routeOnlyUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const value = raw.trim();
  const cut = value.search(/[?#]/);
  const noQuery = cut === -1 ? value : value.slice(0, cut);
  let origin = '';
  let path = noQuery;
  const m = SCHEME_AND_AUTHORITY.exec(noQuery);
  if (m) {
    if (!/^https?:\/\/$/i.test(m[1])) return REDACTED_URL;
    const authority = m[2].includes('@') ? m[2].slice(m[2].lastIndexOf('@') + 1) : m[2];
    origin = `${m[1].toLowerCase()}${authority}`;
    path = m[3];
  } else if (OTHER_SCHEME.test(noQuery)) {
    return REDACTED_URL;
  }
  const route = path
    .split('/')
    .map((segment) => (segment === '' || SAFE_PATH_SEGMENT.test(segment) ? segment : ':id'))
    .join('/');
  return `${origin}${route}`;
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined;
}

function defined(data: Data): Data | undefined {
  const out: Data = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

function base(b: Breadcrumb): Breadcrumb {
  const out: Breadcrumb = {};
  if (typeof b.type === 'string') out.type = b.type;
  if (typeof b.category === 'string') out.category = b.category;
  if (b.level !== undefined) out.level = b.level;
  if (typeof b.timestamp === 'number') out.timestamp = b.timestamp;
  return out;
}

function httpBreadcrumb(b: Breadcrumb): Breadcrumb {
  const d: Data = b.data && typeof b.data === 'object' ? b.data : {};
  const method = typeof d.method === 'string' && HTTP_METHOD.test(d.method) ? d.method.toUpperCase() : undefined;
  const status = typeof d.status_code === 'number' && Number.isFinite(d.status_code) ? d.status_code : undefined;
  const out: Breadcrumb = { ...base(b), type: 'http' };
  const data = defined({ method, url: routeOnlyUrl(d.url), status_code: status });
  if (data) out.data = data;
  return out;
}

function touchBreadcrumb(b: Breadcrumb): Breadcrumb {
  const out = base(b);
  const path = b.data && Array.isArray(b.data.path) ? b.data.path : [];
  const safe = path
    .map((p: unknown) => {
      const entry: Data = p !== null && typeof p === 'object' ? Object.fromEntries(Object.entries(p)) : {};
      return defined({ name: identifier(entry.name), file: identifier(entry.file) });
    })
    .filter((p): p is Data => p !== undefined);
  if (safe.length) {
    out.data = { path: safe };
    if (typeof safe[0].name === 'string') out.message = `Touch event within element: ${safe[0].name}`;
  }
  return out;
}

/** The breadcrumb Sentry may keep, or null to drop it. Never throws. */
export function scrubBreadcrumb(b: Breadcrumb | null | undefined): Breadcrumb | null {
  if (!b || typeof b !== 'object') return null;
  const category = typeof b.category === 'string' ? b.category : '';
  if (category === 'console') return null;
  if (HTTP_CATEGORIES.has(category) || b.type === 'http') return httpBreadcrumb(b);
  if (category === 'touch') return touchBreadcrumb(b);
  const out = base(b);
  const d: Data = b.data && typeof b.data === 'object' ? b.data : {};
  const data = defined(Object.fromEntries(STRUCTURAL_DATA_KEYS.map((k) => [k, identifier(d[k])])));
  if (data) out.data = data;
  return out;
}

function scrubAttributes(data: Data | undefined): void {
  if (!data || typeof data !== 'object') return;
  for (const k of DROPPED_SPAN_KEYS) delete data[k];
  for (const k of URL_ATTRIBUTE_KEYS) {
    if (typeof data[k] === 'string') data[k] = routeOnlyUrl(data[k]);
  }
}

/** `METHOD <url>` http.client span names are reduced to the route. */
function scrubSpanName(name: string | undefined): string | undefined {
  if (typeof name !== 'string') return name;
  const m = /^([A-Za-z]{3,10}) (\S+)$/.exec(name);
  return m ? `${m[1]} ${routeOnlyUrl(m[2])}` : name;
}

/** Over-the-air update contexts reduced to their closed shapes; a context with nothing safe left is removed. */
function scrubOtaContexts(contexts: NonNullable<Event['contexts']>): void {
  if ('ota_updates' in contexts) {
    const safe = sanitizeOtaUpdatesContext(contexts.ota_updates);
    if (safe) contexts.ota_updates = safe;
    else delete contexts.ota_updates;
  }
  if ('ota_emergency' in contexts) {
    const safe = sanitizeOtaEmergencyContext(contexts.ota_emergency);
    if (safe) contexts.ota_emergency = safe;
    else delete contexts.ota_emergency;
  }
}

/**
 * Applies the policy to an error or transaction event in place and returns
 * it. Never drops the event itself.
 */
export function scrubEvent<T extends Event>(event: T): T {
  if (!event || typeof event !== 'object') return event;
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }
  if (event.user) {
    const id = event.user.id;
    if (id !== undefined && id !== null && id !== '') event.user = { id };
    else delete event.user;
  }
  if (event.request) {
    const r = event.request;
    if (r.headers) {
      delete r.headers.Authorization;
      delete r.headers.authorization;
      delete r.headers.Cookie;
      delete r.headers.cookie;
    }
    delete r.cookies;
    delete r.data;
    delete r.query_string;
    if (typeof r.url === 'string') r.url = routeOnlyUrl(r.url);
  }
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      scrubAttributes(span.data);
      if (span.op === 'http.client') span.description = scrubSpanName(span.description);
    }
  }
  const trace = event.contexts && event.contexts.trace;
  if (trace) scrubAttributes(trace.data);
  if (event.contexts) scrubOtaContexts(event.contexts);
  return event;
}
