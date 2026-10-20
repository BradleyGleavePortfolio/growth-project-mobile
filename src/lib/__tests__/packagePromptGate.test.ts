const mockGetEntitlement = jest.fn();
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
let mockUser: { id: string; coach_id?: string } | null = { id: 'client-1', coach_id: 'coach-1' };
jest.mock('../userCache', () => ({ readUserCache: async () => mockUser }));

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { packagePromptDueAtStart, shouldOfferPackagePrompt } from '../packagePromptGate';

const NO_PLAN = { ok: true, data: { active: false, entitlement_active: false } };
const KEY = 'prefs:onboarding.package_prompt_dismissed_at:client-1';
const NOW = Date.parse('2026-10-20T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(async () => {
  jest.clearAllMocks();
  mockUser = { id: 'client-1', coach_id: 'coach-1' };
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

  it('a skip by another account on this phone does not apply (R15)', async () => {
    setOS('android');
    await AsyncStorage.setItem('prefs:onboarding.package_prompt_dismissed_at:client-OTHER', new Date(NOW - 48 * HOUR).toISOString());
    mockGetEntitlement.mockResolvedValue(NO_PLAN);
    expect(await packagePromptDueAtStart('client-1', NOW)).toBe(false);
  });
});
