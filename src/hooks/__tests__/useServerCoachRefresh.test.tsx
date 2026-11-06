/**
 * FIX-913M (LS-913M B1): the app-open and foreground account refresh kept from the retired
 * RomanJoinOfferHost, without its sheet. Real user cache; only GET /auth/me and AppState are stubbed.
 * Fences: signed out, account switch, offline, a coach account, an already coached client, another
 * account's answer, a sign-out while the read is in flight, foreground only after background.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { learnServerCoach, useServerCoachRefresh } from '../useServerCoachRefresh';
import { clearUserCache, readUserCacheSync, setUserCache } from '../../lib/userCache';
import { authApi } from '../../services/api';
import type { CurrentUser } from '../useCurrentUser';

jest.mock('../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

const NO_COACH: CurrentUser = { id: 'user-a', email: '', role: 'student', profile: { onboardingCompleted: true } };
const server = (coachId: unknown, id = 'user-a') => ({ data: { id, role: 'student', coach_id: coachId } }) as never;
const pause = () => act(() => new Promise((res) => setTimeout(res, 20)));

function Host() {
  useServerCoachRefresh();
  return null;
}

let appState: Array<(s: AppStateStatus) => void> = [];
const fire = async (...states: AppStateStatus[]) => {
  for (const s of states) await act(async () => appState.forEach((h) => h(s)));
};
let me: jest.SpyInstance;

beforeEach(async () => {
  await clearUserCache();
  await AsyncStorage.clear();
  appState = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') appState.push(handler as (s: AppStateStatus) => void);
    return { remove: jest.fn() };
  });
  me = jest.spyOn(authApi, 'me').mockResolvedValue(server(null));
});

afterEach(() => jest.restoreAllMocks());

describe('learnServerCoach fences (table)', () => {
  it.each<[string, CurrentUser | null, () => void, number, string | undefined]>([
    ['signed out: no read, nothing written', null, () => undefined, 0, undefined],
    ['a coach account: no read', { ...NO_COACH, role: 'coach' }, () => undefined, 0, undefined],
    ['already coached: no read, coach kept', { ...NO_COACH, coach_id: 'coach-0' }, () => undefined, 0, 'coach-0'],
    ['server confirms a coach: written', NO_COACH, () => me.mockResolvedValueOnce(server('coach-1')), 1, 'coach-1'],
    ['server has no coach yet: nothing written', NO_COACH, () => undefined, 1, undefined],
    ['answer for another account: nothing written', NO_COACH, () => me.mockResolvedValueOnce(server('coach-1', 'user-b')), 1, undefined],
    ['coach_id not a string: nothing written', NO_COACH, () => me.mockResolvedValueOnce(server(42)), 1, undefined],
    ['offline (read fails): rejects, nothing written', NO_COACH, () => me.mockRejectedValueOnce(new Error('offline')), 1, undefined],
  ])('%s', async (_label, cached, arrange, reads, coachAfter) => {
    if (cached) await setUserCache(cached);
    arrange();
    await learnServerCoach().catch(() => undefined);
    expect(me).toHaveBeenCalledTimes(reads);
    expect(readUserCacheSync()?.coach_id).toBe(coachAfter);
  });

  it.each<[string, () => Promise<void>, string | null, string | undefined]>([
    ['signed out while the read is in flight', () => clearUserCache(), null, undefined],
    ['account switched while the read is in flight', () => setUserCache({ ...NO_COACH, id: 'user-b' }), 'user-b', undefined],
  ])('%s: the late answer writes nothing', async (_label, during, idAfter, coachAfter) => {
    await setUserCache(NO_COACH);
    let answer: (v: never) => void = () => undefined;
    me.mockReturnValueOnce(new Promise((res) => (answer = res)) as never);
    const pending = learnServerCoach();
    await during();
    answer(server('coach-1'));
    await pending;
    expect(readUserCacheSync()?.id ?? null).toBe(idAfter);
    expect(readUserCacheSync()?.coach_id).toBe(coachAfter);
  });
});

describe('useServerCoachRefresh (app open and foreground)', () => {
  it('reads on open, again only on a return from the background, and survives offline', async () => {
    await setUserCache(NO_COACH);
    me.mockRejectedValueOnce(new Error('offline'));
    await render(<Host />);
    await waitFor(() => expect(me).toHaveBeenCalledTimes(1));
    await fire('inactive', 'active'); // no background in between: no read
    await pause();
    expect(me).toHaveBeenCalledTimes(1);
    await fire('background', 'active'); // server still has no coach
    await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
    expect(readUserCacheSync()?.coach_id).toBeUndefined();
    me.mockResolvedValueOnce(server('coach-1')); // joined on the web, then back to the app
    await fire('background', 'active');
    await waitFor(() => expect(readUserCacheSync()).toMatchObject({ id: 'user-a', coach_id: 'coach-1' }));
    await fire('background', 'active'); // coached now: nothing extra is sent
    await pause();
    expect(me).toHaveBeenCalledTimes(3);
  });
});
