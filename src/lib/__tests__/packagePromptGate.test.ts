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
import { packagePromptDueAtStart, renewalTapDue, shouldOfferPackagePrompt, takeStartOffer } from '../packagePromptGate';
import { readRenewal, recordRenewalShown } from '../planRenewal';
import { __resetTutorialStoreForTests, hydrateTutorial, startClientTutorial } from '../../tutorial/tutorialStore';
import { tutorialStorageKey } from '../../tutorial/tutorialStorage';
import { initialTutorialState } from '../../tutorial/tutorialMachine';

const NO_PLAN = { ok: true, data: { active: false, entitlement_active: false } };
const KEY = 'prefs:onboarding.package_prompt_dismissed_at:client-1';
const LOOK = 'prefs:onboarding.package_prompt_looked_at:client-1';
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
    expect(await AsyncStorage.getItem(LOOK)).toBe(new Date(NOW).toISOString());
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
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

  it.each(['ios', 'android'])('%s, skipped over 24 h ago, no plan: offered (its one start offer)', async (os) => {
    setOS(os);
    await skippedAgo(25 * HOUR);
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
  });

  it('Android, no skip yet: not offered (Day 1 screen only); one read a day for a renewal block, skip time untouched', async () => {
    setOS('android');
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(await packagePromptDueAtStart('client-1', NOW + 23 * HOUR)).toBe(false);
    expect(mockGetEntitlement).toHaveBeenCalledTimes(1);
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

// RENEWAL-M (backend #1127 contract): the entitlement's `renewal` block drives the sheet at start.
describe('RENEWAL-M: the plan sheet follows the renewal block', () => {
  const ENDED_AT = '2026-10-20T10:00:00.000Z';
  const ended = (step: number, popup: number | null) => ({ ok: true, data: { active: false, entitlement_active: false,
    renewal: { state: 'ended', ended_at: ENDED_AT, step, popup_due: popup !== null, popup_step: popup } } });
  const withRenewal = (renewal: unknown, active = false) => ({ ok: true, data: { active, entitlement_active: active, renewal } });
  const ACK = '/v1/checkout/renewal/popup-ack';
  const show = async () => recordRenewalShown('client-1', takeStartOffer('client-1')?.renewal);

  it.each([
    ['no key (older server, switch off)', {}, undefined],
    ['none', { renewal: { state: 'none', step: null } }, { state: 'none' }],
    ['an unknown state', { renewal: { state: 'paused' } }, { state: 'none' }],
    ['revoked', { renewal: { state: 'revoked' } }, { state: 'revoked' }],
    ['ended, Day 3 due', ended(3, 3).data, { state: 'ended', endedAt: ENDED_AT, popupStep: 3, running: true }],
    ['ended, Day 1 (no pop-up)', ended(1, null).data, { state: 'ended', endedAt: ENDED_AT, popupStep: null, running: true }],
    ['ended, Day 7 seen', ended(7, null).data, { state: 'ended', endedAt: ENDED_AT, popupStep: null, running: false }],
    ['ended, a step the phone does not know', ended(3, 5).data, { state: 'ended', endedAt: ENDED_AT, popupStep: null, running: true }],
  ])('readRenewal: %s', (_label, data, want) => {
    expect(readRenewal(data)).toEqual(want);
  });

  it.each(['ios', 'android'])('%s, Day 0 due with no skip: offered; once shown it is acknowledged and not shown again', async (os) => {
    setOS(os);
    mockGetEntitlement.mockResolvedValue(ended(0, 0));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
    await show();
    expect(mockPost).toHaveBeenCalledWith(ACK, { step: 0 });
    // the ack was lost: the server still says Day 0 is due; not shown again, the ack is retried
    expect(await packagePromptDueAtStart('client-1', NOW + 25 * HOUR)).toBe(false);
    expect(mockPost).toHaveBeenCalledTimes(2);
    mockGetEntitlement.mockResolvedValue(ended(3, 3));
    expect(await packagePromptDueAtStart('client-1', NOW + 50 * HOUR)).toBe(true);
  });

  it('ended, Day 1 (no pop-up): not offered and no look saved, so the Day 3 pop-up is read at the next start', async () => {
    setOS('android');
    mockGetEntitlement.mockResolvedValue(ended(1, null));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(await AsyncStorage.getItem(LOOK)).toBeNull();
    mockGetEntitlement.mockResolvedValue(ended(3, 3));
    expect(await packagePromptDueAtStart('client-1', NOW + HOUR)).toBe(true);
  });

  it('Day 7 seen (sequence over): not offered, and the look is saved', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(ended(7, null));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(await AsyncStorage.getItem(LOOK)).toBe(new Date(NOW).toISOString());
  });

  it('revoked (refund or dispute): never, at start, on Day 1 or from a push tap', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(withRenewal({ state: 'revoked' }));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    expect(await renewalTapDue('client-1')).toBe(false);
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('never bought (none): shown once, never daily; an active plan clears the mark for a plan that ends later', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue(withRenewal({ state: 'none' }));
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(true);
    await show();
    expect(await packagePromptDueAtStart('client-1', NOW + 25 * HOUR)).toBe(false);
    expect(await packagePromptDueAtStart('client-1', NOW + 50 * HOUR)).toBe(false);
    mockGetEntitlement.mockResolvedValue(withRenewal({ state: 'none' }, true));
    expect(await packagePromptDueAtStart('client-1', NOW + 75 * HOUR)).toBe(false);
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false, entitlement_active: false } });
    expect(await packagePromptDueAtStart('client-1', NOW + 100 * HOUR)).toBe(true);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('operator decision: a look within 24 h while the plan was active delays the Day 0 pop-up to the next look', async () => {
    setOS('ios');
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
    mockGetEntitlement.mockResolvedValue(ended(0, 0));
    expect(await packagePromptDueAtStart('client-1', NOW + 5 * HOUR)).toBe(false);
    expect(mockGetEntitlement).toHaveBeenCalledTimes(1);
    expect(await packagePromptDueAtStart('client-1', NOW + 25 * HOUR)).toBe(true);
  });

  it('push tap: due while the plan is ended, even inside the 24 h wait; the opened sheet acknowledges a due pop-up', async () => {
    setOS('android');
    await AsyncStorage.setItem(KEY, new Date(Date.now() - HOUR).toISOString());
    mockGetEntitlement.mockResolvedValue(ended(1, null));
    expect(await renewalTapDue('client-1')).toBe(true);
    await show();
    expect(mockPost).not.toHaveBeenCalled();
    mockGetEntitlement.mockResolvedValue(ended(3, 3));
    expect(await renewalTapDue('client-1')).toBe(true);
    await show();
    expect(mockPost).toHaveBeenCalledWith(ACK, { step: 3 });
  });

  it.each([
    ['never bought', withRenewal({ state: 'none' })],
    ['an active plan', { ok: true, data: { active: true } }],
    ['an older server (no block)', { ok: true, data: { active: false, entitlement_active: false } }],
  ])('push tap with %s: not due', async (_label, ent) => {
    mockGetEntitlement.mockResolvedValue(ent);
    expect(await renewalTapDue('client-1')).toBe(false);
  });

  it('push tap: coachless or a failing payment is never due', async () => {
    mockGetEntitlement.mockResolvedValue(ended(0, 0));
    mockDunning.mockResolvedValue({ enabled: true, state: 'past_due', kind: 'payment', reason: 'payment_failed', purchase_id: 'p1' });
    expect(await renewalTapDue('client-1')).toBe(false);
    mockUser = { id: 'client-1' };
    expect(await renewalTapDue('client-1')).toBe(false);
  });
});
