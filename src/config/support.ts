/**
 * One support address for the app's next-step copy (S-SCHED-3 C-325-1).
 * Screens and error helpers import this instead of repeating the literal.
 */
export const SUPPORT_EMAIL = 'Bradley@Bradleytgpcoaching.com';

export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}
