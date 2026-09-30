/**
 * Extract an invite code from free text a client pasted (clipboard) or
 * typed. Accepts:
 *
 *   - a bare code:           `GP-7K2Q`, `gp-7k2q`, ` GP-7K2Q\n`, `GP-AB-CD`
 *   - a join link:           `https://app.trygrowthproject.com/join/GP-7K2Q`
 *   - a custom-scheme link:  `tgp://join/GP-7K2Q`, `tgp://join/CLINIC2026`
 *   - a query-style link:    `.../join?code=GP-7K2Q` or `?invite_code=...`
 *   - a sentence that contains one of the above ("Use code GP-7K2Q to join")
 *
 * Returns the upper-cased code, or null if nothing plausible was found.
 *
 * Audit B5: a candidate is always normalised as a WHOLE token and is never
 * cut down to a valid-looking prefix. `GP-AB!garbage`, an overlong GP token
 * or `/join/GP-AB%21` return null rather than a different code. The
 * character set matches the backend INVITE_CODE_PATTERN (/^[A-Za-z0-9-]+$/)
 * and its 3 to 32 length bounds. Trailing sentence punctuation and
 * surrounding quotes/brackets are stripped. The server stays authoritative:
 * this only decides what to put in the field, and nothing is auto-attached.
 */

export const INVITE_CODE_MIN_LENGTH = 3;
export const INVITE_CODE_MAX_LENGTH = 32;

const CODE_CHARS = /^[A-Z0-9-]+$/;
const HAS_ALNUM = /[A-Z0-9]/;
const JOIN_SEGMENT = /\/join\/([^/?#\s]+)(?:[/?#]|$)/i;
const QUERY_VALUE = /[?&](?:invite_code|code)=([^&#\s]*)/i;
const WRAPPERS = /^[("'`[<]+|[)"'`\]>]+$/g;
const TRAILING_PUNCT = /[.,;:!?]+$/;

function normalise(candidate: string | undefined | null): string | null {
  if (!candidate) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return null; // malformed percent-encoding: reject, do not guess
  }
  const code = decoded.trim().toUpperCase();
  if (code.length < INVITE_CODE_MIN_LENGTH || code.length > INVITE_CODE_MAX_LENGTH) {
    return null;
  }
  return CODE_CHARS.test(code) && HAS_ALNUM.test(code) ? code : null;
}

function stripToken(token: string): string {
  return token.replace(WRAPPERS, '').replace(TRAILING_PUNCT, '').replace(WRAPPERS, '');
}

function isUrlish(token: string): boolean {
  return token.includes('://') || token.includes('/');
}

/** Code from a URL token (join path first, then query), or null. */
function fromUrl(token: string): string | null {
  const join = token.match(JOIN_SEGMENT);
  if (join) return normalise(join[1]);
  const query = token.match(QUERY_VALUE);
  if (query) return normalise(query[1]);
  return null;
}

export function extractInviteCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  // Clipboards can hold megabytes; only look at the head.
  const text = input.slice(0, 2048).trim();
  if (!text) return null;

  const tokens = text.split(/\s+/);

  // A single token: normalise the whole thing.
  if (tokens.length === 1) {
    const token = stripToken(tokens[0]);
    return isUrlish(token) ? fromUrl(token) : normalise(token);
  }

  // Prose: first a link anywhere, then a complete GP- token.
  for (const raw of tokens) {
    const token = stripToken(raw);
    if (isUrlish(token)) {
      const code = fromUrl(token);
      if (code) return code;
    }
  }
  for (const raw of tokens) {
    const token = stripToken(raw);
    if (/^GP-/i.test(token)) {
      const code = normalise(token);
      if (code) return code;
    }
  }
  return null;
}
