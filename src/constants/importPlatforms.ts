/**
 * importPlatforms.ts — Data-driven catalog of prior coaching platforms. The
 * product is SITE-AGNOSTIC: these are launch SHORTCUTS to a login page, not
 * per-platform mapped tooling. Custom/Other keeps it site-agnostic. Each
 * `loginUrl` is a hardcoded https allowlist entry (never user-supplied);
 * Custom/Other validates the coach-supplied URL via `safeImportLoginUrl`.
 */
import { Ionicons } from '@expo/vector-icons';

/** The sentinel id for the Custom/Other, coach-supplied-URL path. */
export const CUSTOM_PLATFORM_ID = 'custom';

export interface ImportPlatform {
  /** Stable lowercase slug sent to the backend as `chosen_platform`. */
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Hardcoded https login URL; `null` ONLY for the Custom/Other entry. */
  loginUrl: string | null;
}

/** Custom/Other is always last so the site-agnostic path is always present. */
export const IMPORT_PLATFORMS: readonly ImportPlatform[] = [
  { id: 'truecoach', label: 'TrueCoach', icon: 'barbell-outline', loginUrl: 'https://app.truecoach.co/login' },
  { id: 'trainerize', label: 'Trainerize', icon: 'fitness-outline', loginUrl: 'https://www.trainerize.com/login.aspx' },
  { id: 'everfit', label: 'Everfit', icon: 'pulse-outline', loginUrl: 'https://my.everfit.io/login' },
  { id: 'mytrainer', label: 'My PT Hub', icon: 'clipboard-outline', loginUrl: 'https://app.mypthub.net/login' },
  { id: CUSTOM_PLATFORM_ID, label: 'Custom / Other', icon: 'globe-outline', loginUrl: null },
] as const;

/** Look up a catalog entry by id. Returns undefined for an unknown id. */
export function findImportPlatform(id: string): ImportPlatform | undefined {
  return IMPORT_PLATFORMS.find((p) => p.id === id);
}
