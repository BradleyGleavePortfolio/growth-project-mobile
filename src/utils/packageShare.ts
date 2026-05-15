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
