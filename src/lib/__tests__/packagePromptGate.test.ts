const mockGetEntitlement = jest.fn();
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
let mockUser: { id: string; coach_id?: string } | null = { id: 'client-1', coach_id: 'coach-1' };
jest.mock('../userCache', () => ({ readUserCache: async () => mockUser }));
const mockDunning = jest.fn();
jest.mock('../../entitlements/dunning/dunningApi', () => ({ dunningApi: { getStatus: () => mockDunning() } }));
const mockOnboardingState = jest.fn();
jest.mock('../../api/consultationApi', () => ({ consultationApi: { getState: () => mockOnboardingState() } }));
let mockTourFlags = { clientTutorial: true, consultationOnboarding: true };
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) => (k in mockTourFlags ? mockTourFlags[k as keyof typeof mockTourFlags] : Reflect.get(t, k)),
    }),
  };
});

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { packagePromptDueAtStart, shouldOfferPackagePrompt } from '../packagePromptGate';
import { __resetTutorialStoreForTests, hydrateTutorial, startClientTutorial } from '../../tutorial/tutorialStore';
import { tutorialStorageKey } from '../../tutorial/tutorialStorage';
import { initialTutorialState } from '../../tutorial/tutorialMachine';

const NO_PLAN = { ok: true, data: { active: false, entitlement_active: false } };
const KEY = 'prefs:onboarding.package_prompt_dismissed_at:client-1';
const NOW = Date.parse('2026-10-20T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(async () => {
  jest.clearAllMocks();
  mockUser = { id: 'client-1', coach_id: 'coach-1' };
  mockDunning.mockResolvedValue({ enabled: true, state: 'none' });
  mockTourFlags = { clientTutorial: true, consultationOnboarding: true };
  mockOnboardingState.mockResolvedValue({ completed: false, answers: null });
  __resetTutorialStoreForTests();
  await AsyncStorage.clear();
});
afterEach(() => setOS(realOS));

describe('shouldOfferPackagePrompt (fail closed, #304 Sol B1; 1:1 rule, #161-5 op 1)', () => {
  it('never offers to an active (comp) entitlement', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, reason: 'comp' } });
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('never offers when entitlement_active is true even if active is false', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false, entitlement_active: true } });
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it.each(['ios', 'android'])('%s: offers the 1:1 packages to a coached client with no active plan', async (os) => {
    setOS(os);
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await shouldOfferPackagePrompt()).toBe(true);
  });

  it.each([
    ['no coach', { id: 'client-1' }],
    ['no cached user', null],
  ])('coachless (%s): never, and no entitlement read', async (_label, user) => {
    mockUser = user;
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await shouldOfferPackagePrompt()).toBe(false);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
  });

  it.each([
    ['ok:false error', { ok: false, reason: 'error', message: 'x' }],
    ['ok:false not_configured', { ok: false, reason: 'not_configured' }],
    ['ok:true empty data', { ok: true, data: {} }],
    ['ok:true null data', { ok: true, data: null }],
    ['ok:true active undefined', { ok: true, data: { active: undefined } }],
    ['ok:true active as string', { ok: true, data: { active: 'false' } }],
    ['undefined result', undefined],
  ])('suppresses the prompt on an unknown entitlement: %s', async (_label, value) => {
    mockGetEntitlement.mockResolvedValue(value);
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('suppresses the prompt when the lookup rejects', async () => {
    mockGetEntitlement.mockRejectedValue(new Error('boom'));
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  // #836 Opus C1: a failing payment, the Day-10 lock or a paused plan keeps the sheet away. The states
  // backend dunning-v2 sends (#836 Opus C2): past_due (days 0-9), locked (day 10), and a dispute or
  // refund pause as past_due or locked with a reason.
  it.each([
    ['payment failing', { state: 'past_due', locked: false, reason: null }],
    ['Day-10 lock', { state: 'locked', locked: true, reason: null }],
    ['dispute pause', { state: 'past_due', locked: false, reason: 'dispute_paused' }],
    ['refund pause, locked', { state: 'locked', locked: true, reason: 'refund_paused' }],
  ])('never offers while dunning is %s', async (_label, status) => {
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    mockDunning.mockResolvedValue({ enabled: true, ...status });
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('fails closed when the dunning read fails', async () => {
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    mockDunning.mockRejectedValue(new Error('network'));
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('an active plan never reads dunning', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    expect(await shouldOfferPackagePrompt()).toBe(false);
    expect(mockDunning).not.toHaveBeenCalled();
  });
});

describe('packagePromptDueAtStart (once per 24 h, #161-5 op 1)', () => {
  const skippedAgo = (ms: number) => AsyncStorage.setItem(KEY, new Date(NOW - ms).toISOString());

  it('iPhone, first Home with no skip yet: offered, and the key is left for the sheet', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('iPhone, not offered (active plan): saves the look, so the next one is a day later', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(await AsyncStorage.getItem(KEY)).toBe(new Date(NOW).toISOString());
    expect(await packagePromptDueAtStart('client-1', NOW + 23 * HOUR)).toBe(false);
    expect(mockGetEntitlement).toHaveBeenCalledTimes(1);
    expect(await packagePromptDueAtStart('client-1', NOW + 25 * HOUR)).toBe(false);
    expect(mockGetEntitlement).toHaveBeenCalledTimes(2);
  });

  it('iPhone, entitlement read fails: never shown (fail closed)', async () => {
    setOS('ios');
    mockGetEntitlement.mockRejectedValue(new Error('network'));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
  });

  it.each(['ios', 'android'])('%s, skipped under 24 h ago: not offered, no entitlement read', async (os) => {
    setOS(os);
    await skippedAgo(23 * HOUR);
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])('%s, skipped over 24 h ago, no plan: offered again', async (os) => {
    setOS(os);
    await skippedAgo(25 * HOUR);
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
  });

  it('Android, no skip yet: unchanged (Day 1 screen only), no read and no write', async () => {
    setOS('android');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('Android, skipped over 24 h ago, active plan: the skip time stays as it was', async () => {
    setOS('android');
    await skippedAgo(25 * HOUR);
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(await AsyncStorage.getItem(KEY)).toBe(new Date(NOW - 25 * HOUR).toISOString());
  });

  it('iPhone, coachless: never, and no entitlement read', async () => {
    setOS('ios');
    mockUser = { id: 'client-1' };
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
  });

  // #836 Opus C4 / Sol B2: Roman's tour comes first, also after a restart or a fresh install; no key, so a later start offers.
  const saveTour = (status: string) =>
    AsyncStorage.setItem(
      tutorialStorageKey('client-1'),
      JSON.stringify({ state: { ...initialTutorialState(), status }, payload: null }),
    );
  const expectNoOfferNoKey = async (at: number) => {
    expect(await packagePromptDueAtStart('client-1', at)).toBe(false);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  };

  it('iPhone, tour starting in this session ("Show me around"): not offered, no read and no key', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    startClientTutorial(undefined);
    await expectNoOfferNoKey(NOW);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])('%s, restart mid-tour (saved tour active, live store empty): not offered, no key', async (os) => {
    setOS(os);
    if (os === 'android') await skippedAgo(25 * HOUR);
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    await saveTour('active');
    if (os === 'ios') await expectNoOfferNoKey(NOW);
    else expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
    // The tour then ends on this phone: the normal rule applies on the next start.
    __resetTutorialStoreForTests();
    await saveTour('completed');
    expect(await packagePromptDueAtStart('client-1', NOW + HOUR)).toBe(true);
  });

  it('iPhone, tour running in this session: not offered; once finished, offered', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    await saveTour('active');
    await hydrateTutorial('client-1', 'Sam', true);
    await expectNoOfferNoKey(NOW);
    __resetTutorialStoreForTests();
    await saveTour('completed');
    await hydrateTutorial('client-1', 'Sam', true);
    expect(await packagePromptDueAtStart('client-1', NOW + HOUR)).toBe(true);
  });

  it('iPhone, fresh install after the consultation (nothing saved, server done): the tour starts, no sheet, no key', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    mockOnboardingState.mockResolvedValue({ completed: true, answers: {} });
    await expectNoOfferNoKey(NOW);
    expect(mockOnboardingState).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['server: no consultation', () => mockOnboardingState.mockResolvedValue({ completed: false, answers: null })],
    ['endpoint absent (404)', () => mockOnboardingState.mockResolvedValue(null)],
  ])('iPhone, nothing saved, %s: no tour starts, so the normal rule applies', async (_label, setup) => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    setup();
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
  });

  it('iPhone, nothing saved and the onboarding read fails: fail closed, no key', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    mockOnboardingState.mockRejectedValue(new Error('network'));
    await expectNoOfferNoKey(NOW);
  });

  it.each(['completed', 'paused'])('iPhone, saved tour %s: normal rule, no onboarding read', async (status) => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    await saveTour(status);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
    expect(mockOnboardingState).not.toHaveBeenCalled();
  });

  it('iPhone, a client with a plan: the onboarding read never runs', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(mockOnboardingState).not.toHaveBeenCalled();
  });

  it('tour flag off: a saved active tour never shows, so the normal rule applies', async () => {
    setOS('ios');
    mockTourFlags = { clientTutorial: false, consultationOnboarding: true };
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    await saveTour('active');
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
  });

  it('another account\'s saved tour on this phone does not apply', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    await AsyncStorage.setItem(tutorialStorageKey('client-OTHER'), JSON.stringify({ state: { ...initialTutorialState(), status: 'active' }, payload: null }));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
  });

  it('a skip by another account on this phone does not apply (R15)', async () => {
    setOS('android');
    await AsyncStorage.setItem('prefs:onboarding.package_prompt_dismissed_at:client-OTHER', new Date(NOW - 48 * HOUR).toISOString());
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
  });
});
