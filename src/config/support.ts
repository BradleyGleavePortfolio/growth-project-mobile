/**
 * The one support address for the app's next-step copy (S-SCHED-3 C-325-1;
 * S-SCHED-4 B-325-3). Owner ruling 2026-10-01 14:19 PDT: one SUPPORT_EMAIL
 * everywhere, Bradleyapple1031@gmail.com (the same as backend #611).
 * Screens, error helpers and the consultation copy import this instead of
 * repeating the literal; src/config/__tests__/supportEmail.test.ts pins the
 * value against the ruling, not against this constant.
 */
export const SUPPORT_EMAIL = 'Bradleyapple1031@gmail.com';

export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}
