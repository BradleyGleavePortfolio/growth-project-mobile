const mockGetEntitlement = jest.fn();
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
let mockUser: { id: string; coach_id?: string } | null = { id: 'client-1', coach_id: 'coach-1' };
jest.mock('../userCache', () => ({ readUserCache: async () => mockUser }));
// GET /v1/checkout/dunning body, read through the real mobile normaliser (#836 Opus C2).
const mockDunning = jest.fn();
jest.mock('../../entitlements/dunning/dunningApi', () => {
  const { normalizeDunningStatus } = jest.requireActual('../../entitlements/dunning/dunningApi');
  return { dunningApi: { getStatus: async () => normalizeDunningStatus(await mockDunning()) } };
});
const mockPost = jest.fn(async (..._a: unknown[]) => ({ data: {} }));
jest.mock('../../services/api', () => ({ __esModule: true, default: { post: (...a: unknown[]) => mockPost(...a) } }));
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
import { markShownOnce, readRenewal, takeRenewalPopup, type Renewal } from '../planRenewal';
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
  mockDunning.mockResolvedValue({ enabled: true, state: 'none', kind: null, reason: null, purchase_id: null });
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

  // #836 Opus C1: a failing payment, the Day-10 lock or a paused plan keeps the sheet away. Bodies as backend dunning-v2
  // getClientStatus sends them (Opus C2): state 'none' | 'past_due' | 'locked'; a pause adds kind and reason.
  const cycle = { enabled: true, purchase_id: 'pur-1', currency: 'usd', failed_at: '2026-10-10T00:00:00.000Z' };
  it.each([
    ['payment failing (days 0-9)', { ...cycle, state: 'past_due', kind: 'payment', reason: 'payment_failed' }],
    ['Day-10 lock', { ...cycle, state: 'locked', kind: 'payment', reason: 'payment_failed' }],
    ['dispute pause', { ...cycle, state: 'past_due', kind: 'dispute', reason: 'dispute_paused', access_ended: true }],
    ['dispute pause, locked', { ...cycle, state: 'locked', kind: 'dispute', reason: 'dispute_paused', access_ended: true }],
    ['refund pause', { ...cycle, state: 'locked', kind: 'refund', reason: 'refund_paused', access_ended: true }],
  ])('never offers while dunning is %s', async (_label, body) => {
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    mockDunning.mockResolvedValue(body);
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it.each([
    ['no cycle', { enabled: true, state: 'none', purchase_id: null }, true],
    ['switched off', { enabled: false, state: 'none', purchase_id: null }, true],
    ['a state the backend never sends (fail closed)', { enabled: true, state: 'dispute_paused', purchase_id: 'pur-1' }, false],
  ])('dunning %s', async (_label, body, offered) => {
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    mockDunning.mockResolvedValue(body);
    expect(await shouldOfferPackagePrompt()).toBe(offered);
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
    expect(mockOnboardingState).not.toHaveBeenCalled(); // the tour's server read runs only for a client about to be offered
  });

  it('iPhone, coachless: never, and no entitlement read', async () => {
    setOS('ios');
    mockUser = { id: 'client-1' };
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
  });

  // #836 Opus C4 / Sol B2: Roman's tour comes first, also after a restart or a fresh install (real tour store and
  // storage; the live store is empty at start-up). No key is saved, so a later start offers.
  const saveTour = (status: string, id = 'client-1') =>
    AsyncStorage.setItem(tutorialStorageKey(id), JSON.stringify({ state: { ...initialTutorialState(), status }, payload: null }));

  it.each([
    ['starting in this session ("Show me around")', async () => startClientTutorial(undefined)],
    ['saved active, then the app restarted', () => saveTour('active')],
    ['active in this session', async () => saveTour('active').then(() => hydrateTutorial('client-1', 'Sam', true))],
  ])('iPhone, tour %s: not offered, no read, no key; once the tour is finished, offered', async (_label, setup) => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    await setup();
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    __resetTutorialStoreForTests();
    await saveTour('completed');
    expect(await packagePromptDueAtStart('client-1', NOW + HOUR)).toBe(true);
  });

  it('Android, 24 h re-offer due, restart mid-tour: not offered', async () => {
    setOS('android');
    await skippedAgo(25 * HOUR);
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    await saveTour('active');
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
  });

  it.each([
    ['the server has the consultation, so the tour starts', () => mockOnboardingState.mockResolvedValue({ completed: true }), false],
    ['the onboarding read fails (fail closed)', () => mockOnboardingState.mockRejectedValue(new Error('network')), false],
    ['no consultation on the server', () => mockOnboardingState.mockResolvedValue({ completed: false }), true],
    ['the onboarding endpoint is absent (404)', () => mockOnboardingState.mockResolvedValue(null), true],
  ])('iPhone, fresh install (no saved tour), %s', async (_label, setup, offered) => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    setup();
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(offered);
    if (!offered) expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ['saved tour completed', () => saveTour('completed')],
    ['saved tour paused ("Skip the tour")', () => saveTour('paused')],
    ['another account\'s active tour on this phone', () => saveTour('active', 'client-OTHER')],
    ['tour flag off', async () => { mockTourFlags = { ...mockTourFlags, clientTutorial: false }; await saveTour('active'); }],
  ])('iPhone, %s: the normal rule applies', async (_label, setup) => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    await setup();
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
  });

  it('a skip by another account on this phone does not apply (R15)', async () => {
    setOS('android');
    await AsyncStorage.setItem('prefs:onboarding.package_prompt_dismissed_at:client-OTHER', new Date(NOW - 48 * HOUR).toISOString());
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
  });
});

// RENEWAL-M (RENEWAL3; backend #1127 CONTRACT 6328688356): the entitlement's `renewal` block.
describe('RENEWAL-M: renewal block, start sheet and Home pop-up', () => {
  const AT = '2026-10-21T10:00:00.000Z';
  const C = { id: 'coach-1', firstName: 'Jordan' };
  const block = (step: number | null, extra: Record<string, unknown> = {}) => ({ state: 'ended', ended_at: AT, popup_due: step !== null,
    popup_step: step, banner_due: true, coach: { id: 'coach-1', first_name: 'Jordan' }, house_coach: null, ...extra });
  const ended = (step: number | null) => readRenewal({ renewal: block(step) }) as Extract<Renewal, { state: 'ended' }>;
  const plan = (renewal: unknown) => ({ ok: true, data: { active: false, entitlement_active: false, renewal } });
  const ACK = '/v1/checkout/renewal/popup-ack';

  it.each([
    ['no key (older server, switch off)', {}, undefined],
    ['an unknown state', { renewal: { state: 'paused' } }, { state: 'none' }],
    ['revoked', { renewal: { state: 'revoked' } }, { state: 'revoked' }],
    ['Day 7 due', { renewal: block(7) }, { state: 'ended', endedAt: AT, popupStep: 7, bannerDue: true, coach: C, houseCoach: null }],
    ['a step the phone does not know (old Day 3)', { renewal: block(3) }, { state: 'ended', endedAt: AT, popupStep: null, bannerDue: true, coach: C, houseCoach: null }],
  ])('readRenewal: %s', (_l, data, want) => expect(readRenewal(data)).toEqual(want));

  it.each([['ended', block(0)], ['revoked', { state: 'revoked' }]])('%s: the start sheet never opens (ended: Home shows the pop-up)', async (_l, r) => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(plan(r));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
  });

  it('never bought: the first offer opens once, never daily', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(plan({ state: 'none' }));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
    await markShownOnce('client-1'); // the sheet saves this when it opens (recordShown)
    await AsyncStorage.setItem(KEY, new Date(NOW).toISOString());
    expect(await packagePromptDueAtStart('client-1', NOW + 50 * HOUR)).toBe(false);
  });

  it('pop-up: once per step, acked while due; a tap opens it again; a new step opens; a banner day never', async () => {
    expect(await takeRenewalPopup('client-1', ended(0), false)).toBe(true);
    expect(await takeRenewalPopup('client-1', ended(0), false)).toBe(false);
    expect(mockPost).toHaveBeenCalledTimes(2); // the ack is retried while the server still has it due
    expect(await takeRenewalPopup('client-1', ended(0), true)).toBe(true);
    expect(await takeRenewalPopup('client-1', ended(1), false)).toBe(true);
    expect(mockPost).toHaveBeenLastCalledWith(ACK, { step: 1 });
    expect(await takeRenewalPopup('client-1', ended(null), true)).toBe(false);
    expect(mockPost).toHaveBeenCalledTimes(4);
  });

});
