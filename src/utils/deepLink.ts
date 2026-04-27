// Deep-link parsing for invite URLs.
//
// React Navigation owns the actual link → screen routing (see
// `src/navigation/RootNavigator.tsx`). This module exists so the same parsing
// rules can be exercised in unit tests without spinning up a NavigationContainer
// — and so logic that runs *outside* the navigator (e.g. notifications, share
// previews, debugging utilities) can resolve invite URLs the same way.
//
// Supported shapes (must stay in sync with app.json intent filters and the
// linking config in RootNavigator.tsx):
//
//   tgp://join/<code>
//   tgp://join/<code>?ref=<source>
//   https://app.trygrowthproject.com/join/<code>
//   https://app.trygrowthproject.com/join          (no code — manual entry)
//   https://app.trygrowthproject.com/join/         (trailing slash, no code)
//
// Anything else is `null`. Callers should treat a `null` result as "let the
// navigator handle this" rather than as an error — we deliberately do not
// throw so a malformed URL never crashes the app on cold start.

export const INVITE_CUSTOM_SCHEME = 'tgp';
export const INVITE_UNIVERSAL_HOST = 'app.trygrowthproject.com';
export const INVITE_PATH = '/join';

export interface ParsedInviteLink {
  /** The invite code segment, if present. May be empty when the user opens
   *  the bare `/join` URL (manual entry path). */
  inviteCode: string | null;
  /** Which transport the link came in on — handy for analytics. */
  source: 'custom-scheme' | 'universal-link';
  /** The original URL, untouched. */
  raw: string;
}

/**
 * Parse an invite deep link. Returns null when the URL is not an invite link
 * we recognise (different scheme, different host, different path).
 *
 * Invite codes are passed through `decodeURIComponent` so QR-encoded codes
 * containing `%`-escapes round-trip correctly. Whitespace is trimmed because
 * email clients sometimes wrap long URLs.
 */
export function parseInviteDeepLink(url: string | null | undefined): ParsedInviteLink | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;

  // Custom scheme: tgp://join/<code>
  // We can't use the URL constructor reliably on RN for non-http schemes, so
  // do a structural match. Accept both `tgp://join/CODE` and `tgp://join`.
  const customPrefix = `${INVITE_CUSTOM_SCHEME}://join`;
  if (raw.toLowerCase().startsWith(customPrefix)) {
    const after = raw.slice(customPrefix.length);
    // Strip leading "/" then drop any query / fragment.
    const trimmed = after.replace(/^\/+/, '').split(/[?#]/)[0];
    return {
      inviteCode: trimmed ? safeDecode(trimmed) : null,
      source: 'custom-scheme',
      raw,
    };
  }

  // Universal link: https://app.trygrowthproject.com/join/<code>
  // Use the URL constructor for the https case — it correctly handles ports,
  // queries, fragments, and double slashes.
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.host.toLowerCase() !== INVITE_UNIVERSAL_HOST) return null;

  // Path must be /join or /join/<code>. Anything deeper (/join/x/y) is not ours
  // — return null so the navigator's catch-all can decide what to do.
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path !== INVITE_PATH && !path.startsWith(`${INVITE_PATH}/`)) {
    return null;
  }
  const after = path.slice(INVITE_PATH.length).replace(/^\/+/, '');
  // Reject deeper segments like /join/abc/extra
  if (after.includes('/')) return null;

  return {
    inviteCode: after ? safeDecode(after) : null,
    source: 'universal-link',
    raw,
  };
}

/**
 * Build the canonical universal-link URL for an invite code. Used by the
 * coach-side share sheet so the link a coach pastes into Messages / WhatsApp /
 * email is the *same* shape that App Links / Universal Links are configured
 * to verify on device. Do not emit the custom-scheme `tgp://` form here — it
 * does not work outside the app and breaks when forwarded by SMS.
 */
export function buildInviteUniversalLink(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error('buildInviteUniversalLink: code is required');
  }
  return `https://${INVITE_UNIVERSAL_HOST}${INVITE_PATH}/${encodeURIComponent(trimmed)}`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // Malformed % escape — return the raw segment rather than throwing. The
    // backend will reject it as an invalid code and the user gets a friendly
    // error instead of a crash.
    return s;
  }
}
