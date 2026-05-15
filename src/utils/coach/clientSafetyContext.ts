/**
 * Coach-side safety extractors — pull allergies / dietary restrictions off the
 * client profile blob. B14: the coach summary screen displays these and the
 * AI meal-plan request forwards them so the LLM cannot generate a plan that
 * silently ignores a peanut allergy.
 *
 * Empty array means "user answered: none". Undefined means "we have not asked
 * yet"; callers should refuse to ship the meal-plan request until the gap is
 * filled, rather than treating undefined as none.
 */

export type LooseProfileRecord = Record<string, unknown> & {
  allergies?: unknown;
  diet_restrictions?: unknown;
  dietary_restrictions?: unknown;
  restrictions?: unknown;
};

function coerceStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    return trimmed.split(/[,;]/g).map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

export function extractClientAllergies(
  profile: LooseProfileRecord | null | undefined,
): string[] | undefined {
  if (!profile) return undefined;
  return coerceStringArray(profile.allergies);
}

export function extractClientDietaryRestrictions(
  profile: LooseProfileRecord | null | undefined,
): string[] | undefined {
  if (!profile) return undefined;
  return (
    coerceStringArray(profile.diet_restrictions) ??
    coerceStringArray(profile.dietary_restrictions) ??
    coerceStringArray(profile.restrictions) ??
    undefined
  );
}
