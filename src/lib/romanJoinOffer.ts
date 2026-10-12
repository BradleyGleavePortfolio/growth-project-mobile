/**
 * Owner 62y2 (2)-(3): a client with no coach agrees to a "Before we start" without Roman. Right after
 * that client joins a coach, the Roman and AI choice (the coached AiConsentSheet) is offered once.
 *
 * The app learns about a coach only through the user cache (`lib/userCache`): a code (CoachCodeSheet,
 * Settings > Add coach code), a link (pending invite claim, Day 1 pairing), the paid in-app join
 * (`refreshAfterJoinPaid`) and a sign-in that returns the coach (a web storefront or guest checkout
 * join). userCache hands every change to `noteCachedUser`, so one rule covers each path:
 *
 *   - a client (role student, onboarding done) seen here without a coach is marked `no_coach`;
 *   - when that client has a coach (seen without one before, or the change itself is the join),
 *     the mark becomes `due` and RomanJoinOfferHost shows the sheet;
 *   - Allow or Not now marks it `done`; it is never shown again by itself.
 *
 * The mark is one word per account id, no personal data, and is kept across sign-out on purpose: a
 * client who signs out, joins on the web and signs in again still gets the offer, and a client who
 * answered never sees it again. It never applies to another account (the key is the account id).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import type { CurrentUser } from '../hooks/useCurrentUser';
import { profileOnboardingCompleted } from './profileOnboarding';
import { logger } from '../utils/logger';

export const ROMAN_JOIN_OFFER_KEY_PREFIX = 'roman_join_offer:';
type Mark = 'no_coach' | 'due' | 'done';

const listeners = new Set<() => void>();
let due: string | null = null;
let latestId: string | null = null;
let holds = 0;

function notify(): void {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch (err) {
      logger.warn('RomanJoinOffer', 'listener failed', err);
    }
  }
}

export function subscribeRomanJoinOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The account the offer is due for, while no join sheet is on screen; otherwise null. */
export function romanJoinOfferDue(): string | null {
  return holds === 0 && due !== null && due === latestId ? due : null;
}

/** A join sheet (coach code, package) is on screen: the offer waits until it closes. */
export function useRomanJoinOfferHold(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    holds += 1;
    return () => {
      holds -= 1;
      if (holds === 0) notify();
    };
  }, [active]);
}

/** Allow or Not now: the offer is done for this account. */
export async function finishRomanJoinOffer(userId: string): Promise<void> {
  if (due === userId) due = null;
  try {
    await AsyncStorage.setItem(ROMAN_JOIN_OFFER_KEY_PREFIX + userId, 'done');
  } catch (err) {
    logger.warn('RomanJoinOffer', 'done mark not saved', err);
  }
}

/** Called by userCache with the cached user before and after every change (null when signed out). */
export function noteCachedUser(prev: CurrentUser | null, next: CurrentUser | null): void {
  const id = next?.id ?? null;
  latestId = id;
  if (!next || !id) {
    due = null;
    return;
  }
  if (next.role !== 'student' || !profileOnboardingCompleted(next.profile)) return;
  const hasCoach = Boolean(next.coach_id);
  const joinedNow = hasCoach && prev?.id === id && !prev.coach_id;
  const key = ROMAN_JOIN_OFFER_KEY_PREFIX + id;
  void (async () => {
    const mark = (await AsyncStorage.getItem(key)) as Mark | null;
    if (mark === 'done') return;
    if (!hasCoach) {
      if (mark === null) await AsyncStorage.setItem(key, 'no_coach');
      return;
    }
    if (mark === null && !joinedNow) return;
    if (mark !== 'due') await AsyncStorage.setItem(key, 'due');
    if (latestId !== id) return;
    due = id;
    notify();
  })().catch((err: unknown) => logger.warn('RomanJoinOffer', 'mark not read or saved', err));
}

export function resetRomanJoinOfferForTests(): void {
  due = null;
  latestId = null;
  holds = 0;
  listeners.clear();
}
