/**
 * Stripe publishable key resolution (S-ENVTRUTH, 2026-10-01).
 *
 * EAS stores the key as EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY. The app used to
 * read only EXPO_PUBLIC_STRIPE_PK, so release builds saw an empty key and the
 * package checkout failed closed. The canonical name is read first; the
 * legacy name stays as a fallback so older local .env files keep working.
 *
 * Both reads are literal `process.env.EXPO_PUBLIC_*` member expressions so
 * babel-preset-expo inlines them into release bundles (a computed lookup
 * would resolve to undefined at runtime).
 *
 * Returns '' when neither is set; callers fail closed on ''.
 */
export function resolveStripePublishableKey(): string {
  const canonical = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').trim();
  if (canonical) return canonical;
  return (process.env.EXPO_PUBLIC_STRIPE_PK ?? '').trim();
}
