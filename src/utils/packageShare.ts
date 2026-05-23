// Single source of truth for package share URLs. Reused by:
//   • CoachPackageEditScreen.handleShare (native share sheet)
//   • Deep-link parsing in RootNavigator (tgp:// and HTTPS prefixes)
//
// The universal-link host stays in lockstep with the AASA / assetlinks
// templates and the app.json intent filter. Keep this constant in sync if
// the marketing host ever moves.

export const PACKAGE_SHARE_HOST = 'https://app.trygrowthproject.com';
export const PACKAGE_SHARE_PATH = '/p'; // /p/<shareToken>

export function buildPackageShareUrl(shareToken: string): string {
  return `${PACKAGE_SHARE_HOST}${PACKAGE_SHARE_PATH}/${encodeURIComponent(shareToken)}`;
}

// Closed format for package share tokens. The backend will mint these from a
// constrained alphabet — UUID, base62, or short slug — so the mobile parser
// can reject anything else *before* it reaches the network, analytics, or a
// URL interpolation. Rejecting here also blocks path-traversal characters
// (slash, dot-segments), whitespace, and HTML-injection chars from being
// passed downstream by a malicious deep link.
//
// Rules:
//   • Non-empty
//   • Length <= 128
//   • Characters: A–Z a–z 0–9 hyphen underscore only
export function isValidPackageShareToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  if (token.length === 0 || token.length > 128) return false;
  return /^[A-Za-z0-9_-]+$/.test(token);
}
