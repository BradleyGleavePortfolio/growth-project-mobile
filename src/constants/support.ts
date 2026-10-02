/**
 * The one support contact the app shows (owner ruling 2026-10-01 14:19 PDT:
 * one support email everywhere).
 *
 * Every "Email us", "Request access" and "Contact support" path uses this
 * constant: SupportInboxScreen shows and opens it, and the "Contact support"
 * buttons on the auth screens navigate there. The app-wide error mapper
 * (S-ERRORS) and community safety copy should import it rather than declare
 * their own address. src/constants/__tests__/supportEmail.guard.test.ts fails
 * the build if any other address appears in src/.
 */
export const SUPPORT_EMAIL = "Bradleyapple1031@gmail.com";

/** `mailto:` link to SUPPORT_EMAIL, with an optional subject line. */
export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}
