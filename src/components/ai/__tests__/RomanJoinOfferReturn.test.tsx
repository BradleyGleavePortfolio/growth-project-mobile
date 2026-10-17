/**
 * Sol B1 on #685 (owner 62y2): a client with no coach who stays signed in, joins a coach on the web (a
 * coach landing page or storefront checkout) and comes back to the app is offered the Roman and AI
 * choice. The host re-reads the account (GET /auth/me) when the client app opens and on each return
 * from the background; the coach the server confirms reaches the offer through the real user cache.
 * Nobody signs out and no test writes the coach into the cache.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RomanJoinOfferHost from '../RomanJoinOfferHost';
import type { AiConsentSheetApi } from '../AiConsentSheet';
import type { AiConsentOutcome } from '../../../api/aiConsentApi';
import { resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';
import { AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH } from '../../../lib/consultation/copy';
import { resetRomanJoinOfferForTests, ROMAN_JOIN_OFFER_KEY_PREFIX } from '../../../lib/romanJoinOffer';
import { clearUserCache, readUserCacheSync, setUserCache } from '../../../lib/userCache';
import { authApi } from '../../../services/api';
import type { CurrentUser } from '../../../hooks/useCurrentUser';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../join/JoinPackageHost', () => ({ JOIN_SHEET_HANDOFF_MS: 10 }));

const NO_COACH: CurrentUser = { id: 'user-a', email: '', role: 'student', profile: { onboardingCompleted: true } };
const part = (text: string) => ({ text, sha256: 'a'.repeat(64) });
const NOT_GRANTED: AiConsentOutcome = {
  kind: 'ok',
  status: {
    granted: false, state: 'not_granted', version: null, granted_at: null, withdrawn_at: null,
    current_version: 'client-ai-v6', needs_reconsent: false,
    copy: { version: 'client-ai-v6', paragraph: part(AI_CONSENT_PARAGRAPH), box_label: part(AI_CONSENT_CHECKBOX_LABEL), sha256: AI_CONSENT_COPY_SHA256 },
  },
};
const consentApi = () =>
  ({ getStatus: jest.fn(async () => NOT_GRANTED), grantRoman: jest.fn(async () => NOT_GRANTED) }) as unknown as AiConsentSheetApi;
const server = (coachId?: string) => ({ data: { id: 'user-a', role: 'student', coach_id: coachId ?? null } }) as never;
const mark = () => AsyncStorage.getItem(`${ROMAN_JOIN_OFFER_KEY_PREFIX}user-a`);
const pause = () => act(() => new Promise((res) => setTimeout(res, 100)));

let appState: Array<(s: AppStateStatus) => void> = [];
const returnToApp = async () => {
  await act(async () => appState.forEach((h) => h('background')));
  await act(async () => appState.forEach((h) => h('active')));
};
let me: jest.SpyInstance;

beforeEach(async () => {
  resetRomanJoinOfferForTests();
  resetAiLedgerWritesForTests();
  await clearUserCache();
  await AsyncStorage.clear();
  appState = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') appState.push(handler as (s: AppStateStatus) => void);
    return { remove: jest.fn() };
  });
  me = jest.spyOn(authApi, 'me').mockResolvedValue(server());
});

afterEach(() => jest.restoreAllMocks());

/** Signed in on this phone without a coach (the sign-in wrote the account once, as it always does). */
async function signedInWithNoCoach() {
  await setUserCache(NO_COACH);
  await waitFor(async () => expect(await mark()).toBe('no_coach'));
}

describe('a web join while the client stays signed in (Sol B1)', () => {
  it('is offered on the return to the app, once the server confirms the coach', async () => {
    await signedInWithNoCoach();
    me.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(server());
    const r = await render(<RomanJoinOfferHost api={consentApi()} />);
    await waitFor(() => expect(me).toHaveBeenCalledTimes(1));
    await returnToApp(); // the server still has no coach: nothing changes
    await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
    await pause();
    expect(r.queryByTestId('roman-join-offer')).toBeNull();
    expect(readUserCacheSync()?.coach_id).toBeUndefined();

    me.mockResolvedValueOnce(server('coach-1')); // joined on the coach's web page, then back to the app
    await returnToApp();
    await waitFor(() => expect(r.getByTestId('roman-join-offer-allow')).toBeTruthy());
    expect(r.getByTestId('roman-join-offer-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    expect(readUserCacheSync()).toMatchObject({ id: 'user-a', coach_id: 'coach-1' });
    expect(await mark()).toBe('due');
    expect(me).toHaveBeenCalledTimes(3);
  });

  it('is offered when the app opens after a web join made while it was closed', async () => {
    await signedInWithNoCoach();
    me.mockResolvedValue(server('coach-1'));
    const r = await render(<RomanJoinOfferHost api={consentApi()} />);
    await waitFor(() => expect(r.getByTestId('roman-join-offer-allow')).toBeTruthy());
    expect(me).toHaveBeenCalledTimes(1);
  });

  it.each<[string, CurrentUser]>([
    ['a client with a coach', { ...NO_COACH, coach_id: 'coach-1' }],
    ['a coach account', { ...NO_COACH, role: 'coach' }],
  ])('%s sends no extra account read on opening or returning', async (_l, user) => {
    await setUserCache(user);
    const r = await render(<RomanJoinOfferHost api={consentApi()} />);
    await returnToApp();
    await pause();
    expect(me).not.toHaveBeenCalled();
    expect(r.queryByTestId('roman-join-offer')).toBeNull();
  });

  it('an answer that arrives after signing out writes nothing', async () => {
    await signedInWithNoCoach();
    let answer: (v: never) => void = () => undefined;
    me.mockReturnValueOnce(new Promise((res) => (answer = res)) as never);
    const r = await render(<RomanJoinOfferHost api={consentApi()} />);
    await clearUserCache();
    await act(async () => answer(server('coach-1')));
    await pause();
    expect(readUserCacheSync()).toBeNull();
    expect(r.queryByTestId('roman-join-offer')).toBeNull();
  });
});
