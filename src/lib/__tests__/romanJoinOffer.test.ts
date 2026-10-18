/**
 * Owner 62y2 (2): every join path that reaches the app makes the Roman and AI offer due once, for a
 * client this device saw without a coach; never for a client with no coach.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { waitFor } from '@testing-library/react-native';
import { clearUserCache, patchUserCache, setUserCache } from '../userCache';
import {
  finishRomanJoinOffer,
  resetRomanJoinOfferForTests,
  romanJoinOfferDue,
  ROMAN_JOIN_OFFER_KEY_PREFIX,
} from '../romanJoinOffer';
import { claimPendingInviteCode } from '../pendingInviteCode';
import { pairWithCoach } from '../../screens/day-one/api';
import { refreshAfterJoinPaid } from '../../screens/join/JoinPackageScreen';
import type { CurrentUser } from '../../hooks/useCurrentUser';

const mockAttach = jest.fn();
const mockMe = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {},
  authApi: {
    attachInviteCode: (...a: unknown[]) => mockAttach(...a),
    me: () => mockMe(),
    getSignupPolicy: async () => ({ data: {} }),
  },
  profileApi: {},
  preferencesApi: {},
  notificationsApi: {},
}));
jest.mock('../../hooks/usePackagePurchase', () => ({ usePackagePurchase: jest.fn() }));
jest.mock('../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: jest.fn() }) }));
jest.mock('../../api/coachSharingApi', () => ({ acceptFirstSignInSharing: jest.fn(async () => true) }));
jest.mock('../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn(async () => undefined) } }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const NO_COACH: CurrentUser = { id: 'user-a', email: '', role: 'student', profile: { onboardingCompleted: true } };
const mark = () => AsyncStorage.getItem(`${ROMAN_JOIN_OFFER_KEY_PREFIX}user-a`);
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  resetRomanJoinOfferForTests();
  await clearUserCache();
  await AsyncStorage.clear();
  mockAttach.mockReset();
  mockMe.mockReset();
});

async function signedInWithNoCoach() {
  await setUserCache(NO_COACH);
  await waitFor(async () => expect(await mark()).toBe('no_coach'));
  expect(romanJoinOfferDue()).toBeNull();
}

describe('the offer is due after each join path that reaches the app', () => {
  it('a code (the coach-code sheet and Settings > Add coach code write the coach to the user cache)', async () => {
    await signedInWithNoCoach();
    await patchUserCache({ coach_id: 'coach-1' });
    await waitFor(() => expect(romanJoinOfferDue()).toBe('user-a'));
    expect(await mark()).toBe('due');
  });

  it('a link (the pending invite claimed after sign-in)', async () => {
    await signedInWithNoCoach();
    mockAttach.mockResolvedValue({ data: { coach_id: 'coach-1' } });
    await expect(claimPendingInviteCode('ABC123')).resolves.toMatchObject({ ok: true });
    await waitFor(() => expect(romanJoinOfferDue()).toBe('user-a'));
  });

  it('a link or code at Day 1 pairing', async () => {
    await signedInWithNoCoach();
    mockAttach.mockResolvedValue({ data: { coach_id: 'coach-1' } });
    await expect(pairWithCoach('ABC123')).resolves.toEqual({ ok: true });
    await waitFor(() => expect(romanJoinOfferDue()).toBe('user-a'));
  });

  it('the paid in-app join (the user read again after payment)', async () => {
    await signedInWithNoCoach();
    mockMe.mockResolvedValue({ data: { coach_id: 'coach-1' } });
    await refreshAfterJoinPaid();
    await waitFor(() => expect(romanJoinOfferDue()).toBe('user-a'));
  });

  it('a web storefront or guest checkout join (the next sign-in returns the coach), also after signing out', async () => {
    await signedInWithNoCoach();
    await clearUserCache();
    expect(romanJoinOfferDue()).toBeNull();
    await setUserCache({ ...NO_COACH, coach_id: 'coach-1' });
    await waitFor(() => expect(romanJoinOfferDue()).toBe('user-a'));
  });
});

describe('once, and never without a coach', () => {
  it('after Allow or Not now it is done and never due again by itself', async () => {
    await signedInWithNoCoach();
    await patchUserCache({ coach_id: 'coach-1' });
    await waitFor(() => expect(romanJoinOfferDue()).toBe('user-a'));
    await finishRomanJoinOffer('user-a');
    expect(romanJoinOfferDue()).toBeNull();
    expect(await mark()).toBe('done');
    await patchUserCache({ coach_id: undefined });
    await patchUserCache({ coach_id: 'coach-2' });
    await clearUserCache();
    await setUserCache({ ...NO_COACH, coach_id: 'coach-2' });
    await settle();
    expect(romanJoinOfferDue()).toBeNull();
    expect(await mark()).toBe('done');
  });

  const NEVER: Array<[string, CurrentUser, Partial<CurrentUser>]> = [
    ['a client with no coach', NO_COACH, {}],
    ['a coach account', { ...NO_COACH, role: 'coach' }, { coach_id: 'coach-1' }],
    ['a client still onboarding (the coached "Before we start" asks)', { ...NO_COACH, profile: {} }, { coach_id: 'coach-1' }],
  ];
  it.each(NEVER)('%s: never due', async (_l, first, patch) => {
    await setUserCache(first);
    await patchUserCache(patch);
    await settle();
    await settle();
    expect(romanJoinOfferDue()).toBeNull();
    expect(await mark()).not.toBe('due');
  });

  it('a client this device never saw without a coach is not asked (they chose in the coached "Before we start")', async () => {
    await setUserCache({ ...NO_COACH, coach_id: 'coach-1' });
    await settle();
    await settle();
    expect(romanJoinOfferDue()).toBeNull();
    expect(await mark()).toBeNull();
  });

  it('another account signing in on this device is never offered the first account’s join', async () => {
    await signedInWithNoCoach();
    await patchUserCache({ coach_id: 'coach-1' });
    await waitFor(() => expect(romanJoinOfferDue()).toBe('user-a'));
    await clearUserCache();
    await setUserCache({ ...NO_COACH, id: 'user-b', coach_id: 'coach-1' });
    await settle();
    expect(romanJoinOfferDue()).toBeNull();
  });
});
