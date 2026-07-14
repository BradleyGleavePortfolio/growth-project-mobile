/**
 * importPlatforms.ts — Data-driven catalog of prior coaching platforms a coach
 * can import from. The product is SITE-AGNOSTIC: these entries are launch
 * SHORTCUTS to a login page, not per-platform mapped tooling. The Custom/Other
 * entry keeps the semantics site-agnostic — a coach can import from any site by
 * supplying its https login URL.
 *
 * Each `loginUrl` is a hardcoded https allowlist entry (never user-supplied) so
 * the shortcut path cannot be pointed at an arbitrary origin. The Custom/Other
 * path validates a coach-supplied URL through `safeImportLoginUrl` instead.
 */

/** The sentinel id for the Custom/Other, coach-supplied-URL path. */
export const CUSTOM_PLATFORM_ID = 'custom';

export interface ImportPlatform {
  /** Stable lowercase slug sent to the backend as `chosen_platform`. */
  id: string;
  /** Human label shown in the picker. */
  label: string;
  /** Ionicons glyph name for the row. */
  icon: string;
  /**
   * Hardcoded https login URL for the shortcut. `null` ONLY for the
   * Custom/Other entry, whose URL the coach supplies and we validate.
   */
  loginUrl: string | null;
}

/**
 * Launch catalog. Ordered by prevalence among incoming coaches; Custom/Other is
 * always last so the site-agnostic path is a first-class, always-present option.
 */
export const IMPORT_PLATFORMS: readonly ImportPlatform[] = [
  {
    id: 'truecoach',
    label: 'TrueCoach',
    icon: 'barbell-outline',
    loginUrl: 'https://app.truecoach.co/login',
  },
  {
    id: 'trainerize',
    label: 'Trainerize',
    icon: 'fitness-outline',
    loginUrl: 'https://www.trainerize.com/login.aspx',
  },
  {
    id: 'everfit',
    label: 'Everfit',
    icon: 'pulse-outline',
    loginUrl: 'https://my.everfit.io/login',
  },
  {
    id: 'mytrainer',
    label: 'My PT Hub',
    icon: 'clipboard-outline',
    loginUrl: 'https://app.mypthub.net/login',
  },
  {
    id: CUSTOM_PLATFORM_ID,
    label: 'Custom / Other',
    icon: 'globe-outline',
    loginUrl: null,
  },
] as const;

/** Look up a catalog entry by id. Returns undefined for an unknown id. */
export function findImportPlatform(id: string): ImportPlatform | undefined {
  return IMPORT_PLATFORMS.find((p) => p.id === id);
}
