/**
 * Retired by STORE-E4 (agent 185; owner #184-E5 / #184-E6 op 1): there is no Roman and AI sheet after a
 * client joins a coach any more. Roman's AI is asked the first time the client opens Roman ("Before
 * Roman answers", RomanConsentGate), whether or not they have a coach.
 *
 * What stays, for the callers outside this job's files (listed under "Found, not fixed" in the PR):
 *   - ROMAN_JOIN_OFFER_KEY_PREFIX: older builds wrote one word per account id (`roman_join_offer:<id>`);
 *     a confirmed or scheduled account deletion still removes it (authActions deletedAccountKeys).
 *   - useRomanJoinOfferHold / noteCachedUser: called by the coach-code and package sheets and by
 *     userCache; they do nothing now.
 */
import type { CurrentUser } from '../hooks/useCurrentUser';

export const ROMAN_JOIN_OFFER_KEY_PREFIX = 'roman_join_offer:';

/** Retired (STORE-E4): nothing waits for a join sheet to close. */
export function useRomanJoinOfferHold(_active: boolean): void {}

/** Retired (STORE-E4): a cached user change no longer marks an after-join offer. */
export function noteCachedUser(_prev: CurrentUser | null, _next: CurrentUser | null): void {}
