/**
 * #306 fix round 5 (Sol B-306-2 / Opus B-306-1): the role-selection gate and
 * the Login recovery record belong to one account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  COACH_RECOVERY_GATE_KEY,
  NEEDS_ROLE_SELECTION_KEY,
  ROLE_SELECTION_OWNER_KEY,
  clearCoachRecoveryGate,
  clearRoleSelectionPending,
  isCoachLikeRole,
  isRoleSelectionPendingFor,
  markRoleSelectionPending,
  readCoachRecoveryGate,
  settleRoleSelectionGateForSignIn,
  userIdOf,
  writeCoachRecoveryGate,
} from '../roleSelectionGate';

describe('roleSelectionGate', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('records the owner with the flag and clears both', async () => {
    await markRoleSelectionPending('u1');
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBe('true');
    expect(await AsyncStorage.getItem(ROLE_SELECTION_OWNER_KEY)).toBe('u1');
    await clearRoleSelectionPending();
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(ROLE_SELECTION_OWNER_KEY)).toBeNull();
  });

  it('a flag without a known user drops any stale owner', async () => {
    await markRoleSelectionPending('u1');
    await markRoleSelectionPending(null);
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBe('true');
    expect(await AsyncStorage.getItem(ROLE_SELECTION_OWNER_KEY)).toBeNull();
  });

  it('pending only for its owner; an owner-less (older build) flag counts for whoever signs in', async () => {
    await markRoleSelectionPending('u1');
    expect(await isRoleSelectionPendingFor('u1')).toBe(true);
    expect(await isRoleSelectionPendingFor('u2')).toBe(false);
    expect(await isRoleSelectionPendingFor(null)).toBe(false);
    await AsyncStorage.removeItem(ROLE_SELECTION_OWNER_KEY);
    expect(await isRoleSelectionPendingFor('u2')).toBe(true);
    await clearRoleSelectionPending();
    expect(await isRoleSelectionPendingFor('u1')).toBe(false);
  });

  it('settle on sign-in: own unfinished signup -> role-selection; another account -> app and cleared; coach-like -> app and cleared', async () => {
    await markRoleSelectionPending('u1');
    expect(await settleRoleSelectionGateForSignIn({ id: 'u1', role: 'student' })).toBe('role-selection');
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBe('true');

    expect(await settleRoleSelectionGateForSignIn({ id: 'u2', role: 'student' })).toBe('app');
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();

    for (const role of ['coach', 'sub_coach', 'owner']) {
      await markRoleSelectionPending('c1');
      expect(await settleRoleSelectionGateForSignIn({ id: 'c1', role })).toBe('app');
      expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();
    }
    expect(await settleRoleSelectionGateForSignIn({ id: 'u3', role: 'student' })).toBe('app');
  });

  it('recovery record round-trips and rejects malformed data', async () => {
    expect(await readCoachRecoveryGate()).toBeNull();
    await writeCoachRecoveryGate({ userId: 'u1', method: 'apple', priorPending: true, at: 5 });
    expect(await readCoachRecoveryGate()).toEqual({ userId: 'u1', method: 'apple', priorPending: true, at: 5 });
    await writeCoachRecoveryGate({ userId: 'u1', method: 'email', identity: 'pat@example.com', priorPending: false, at: 6 });
    expect(await readCoachRecoveryGate()).toMatchObject({ identity: 'pat@example.com', priorPending: false });
    await AsyncStorage.setItem(COACH_RECOVERY_GATE_KEY, '{not json');
    expect(await readCoachRecoveryGate()).toBeNull();
    await AsyncStorage.setItem(COACH_RECOVERY_GATE_KEY, JSON.stringify({ userId: 'u1', method: 'sms' }));
    expect(await readCoachRecoveryGate()).toBeNull();
    await AsyncStorage.setItem(COACH_RECOVERY_GATE_KEY, JSON.stringify({ method: 'email' }));
    expect(await readCoachRecoveryGate()).toBeNull();
    await clearCoachRecoveryGate();
    expect(await AsyncStorage.getItem(COACH_RECOVERY_GATE_KEY)).toBeNull();
  });

  it('helpers', () => {
    expect(isCoachLikeRole('coach')).toBe(true);
    expect(isCoachLikeRole('sub_coach')).toBe(true);
    expect(isCoachLikeRole('owner')).toBe(true);
    expect(isCoachLikeRole('student')).toBe(false);
    expect(isCoachLikeRole(undefined)).toBe(false);
    expect(userIdOf({ id: 'u1' })).toBe('u1');
    expect(userIdOf({ id: '' })).toBeNull();
    expect(userIdOf({ id: 7 })).toBeNull();
    expect(userIdOf(null)).toBeNull();
  });
});
