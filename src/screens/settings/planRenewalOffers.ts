/**
 * STORE-B2 (App Store 4.5.4): the person's yes to plan renewal offers, the Day 1 and Day 7 app notifications after a
 * plan ends. One source for the words, the server field and who sees the switch, shared by Settings > Notifications
 * (screens/notifications, every client route opens it) and the category screen.
 */

/** Owner 184-W4 op 1: W1 and W2 approved (W2 without its last sentence); the save-failed noun (W3) as built. */
export const PLAN_RENEWAL_OFFERS_COPY = {
  label: 'Plan renewal offers',
  description: 'A note the day after your plan ends and a week later, with plans you can choose.',
  noun: 'plan renewal offers',
} as const;

/** PATCH body field: true is a yes, false a no (backend #1184). */
export const PLAN_RENEWAL_OFFERS_WRITE_FIELD = 'plan_renewal_offers';

/** GET and PATCH answer: the time of the yes, null for no; an older server leaves it out. */
const READ_FIELD = 'plan_renewal_offers_opt_in_at';

/** The server's yes (true) or no (false); null when the answer does not carry the field (older server). */
export function planRenewalOffersFromServer(data: unknown): boolean | null {
  if (typeof data !== 'object' || data === null || !(READ_FIELD in data)) return null;
  const at = (data as Record<string, unknown>)[READ_FIELD];
  if (at === null) return false;
  return typeof at === 'string' && at !== '' ? true : null;
}

/** Clients only: a known coach or owner role never sees the switch (renewal offers go to clients). */
export function planRenewalOffersForRole(role: string | null | undefined): boolean {
  return !(typeof role === 'string' && role.length > 0 && role !== 'student');
}
