/**
 * STORE-E4 (agent 185; owner #184-E5 / #184-E6 op 1): the Roman and AI sheet after a client joins a coach
 * is retired. Roman's AI is asked the first time the client opens Roman ("Before Roman answers"). A join
 * marks nothing and nothing is mounted to show an offer.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { noteCachedUser, ROMAN_JOIN_OFFER_KEY_PREFIX } from '../romanJoinOffer';
import type { CurrentUser } from '../../hooks/useCurrentUser';

const client = (coach_id: string | null): CurrentUser =>
  ({ id: 'u1', role: 'student', coach_id, profile: { onboarding_completed: true } }) as unknown as CurrentUser;

describe('no Roman sheet after a join (retired, STORE-E4)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('a client who joins a coach is marked nothing', async () => {
    noteCachedUser(null, client(null));
    noteCachedUser(client(null), client('coach-1'));
    await Promise.resolve();
    expect(await AsyncStorage.getItem(ROMAN_JOIN_OFFER_KEY_PREFIX + 'u1')).toBeNull();
  });

  it('the client tabs mount no after-join host', () => {
    const nav = readFileSync(join(__dirname, '../../navigation/ClientNavigator.tsx'), 'utf8');
    expect(nav).not.toMatch(/RomanJoinOffer/);
    expect(existsSync(join(__dirname, '../../components/ai/RomanJoinOfferHost.tsx'))).toBe(false);
  });

  it('account deletion still knows the key older builds wrote', () => {
    expect(ROMAN_JOIN_OFFER_KEY_PREFIX).toBe('roman_join_offer:');
  });
});
