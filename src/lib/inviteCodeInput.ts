/**
 * Extract an invite code from free text a client pasted (clipboard) or
 * typed. Accepts:
 *
 *   - a bare code:           `GP-7K2Q`, `gp-7k2q`, ` GP-7K2Q\n`
 *   - a join link:           `https://app.trygrowthproject.com/join/GP-7K2Q`
 *   - a custom-scheme link:  `tgp://join/GP-7K2Q`
 *   - a query-style link:    `.../join?code=GP-7K2Q` or `?invite_code=...`
 *   - a sentence that contains one of the above ("Use code GP-7K2Q to join")
 *
 * Returns the upper-cased code, or null if nothing plausible was found.
 * Length bounds mirror the backend (INVITE_CODE_MIN_LENGTH=3,
 * INVITE_CODE_MAX_LENGTH=32). The server stays authoritative: this only
 * decides what to put in the field.
 */

export const INVITE_CODE_MIN_LENGTH = 3;
export const INVITE_CODE_MAX_LENGTH = 32;

const CODE_CHARS = /^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/;
const GP_CODE = /\bGP-[A-Z0-9]{2,29}\b/i;
const JOIN_PATH = /\/join\/([A-Za-z0-9-]{3,32})(?=$|[/?#\s])/;
const QUERY_CODE = /[?&](?:invite_code|code)=([A-Za-z0-9-]{3,32})(?=$|[&#\s])/;

function normalise(candidate: string | undefined | null): string | null {
  if (!candidate) return null;
  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    // keep raw
  }
  const code = decoded.trim().toUpperCase();
  if (code.length < INVITE_CODE_MIN_LENGTH || code.length > INVITE_CODE_MAX_LENGTH) {
    return null;
  }
  return CODE_CHARS.test(code) ? code : null;
}

export function extractInviteCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  // Clipboards can hold megabytes; only look at the head.
  const text = input.slice(0, 2048).trim();
  if (!text) return null;

  const join = text.match(JOIN_PATH);
  if (join) return normalise(join[1]);

  const query = text.match(QUERY_CODE);
  if (query) return normalise(query[1]);

  const gp = text.match(GP_CODE);
  if (gp) return normalise(gp[0]);

  // A bare single token (no spaces, no URL) is accepted as-is.
  if (!/\s/.test(text) && !text.includes('://') && !text.includes('/')) {
    return normalise(text);
  }
  return null;
}
