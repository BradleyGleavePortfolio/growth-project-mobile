/**
 * RoleSelection against a STATEFUL fake of the backend invite contract
 * (audit #303 A1, A2, B4). The fake mirrors backend 3a9369b9:
 *   - attachUserToCoachByCode resolves BOTH families (permanent CoachProfile
 *     GP- codes and InviteCode rows), consumes one use, and sets
 *     {role:'student', coach_id}
 *   - selectRole(role, code) redeems AGAIN through validate(), which only
 *     knows InviteCode rows
 *   - selectRole(role, undefined) only confirms the role
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

type Row = { coachId: string; used: number; max: number | null; family: 'profile' | 'invite' };
const mockDb: { codes: Record<string, Row>; user: { id: string; role: string | null; coach_id: string | null } } = {
  codes: {},
  user: { id: 'u1', role: null, coach_id: null },
};
const mockCalls: string[] = [];
let mockSelectRoleFails = false;
let mockPolicyFails = false;

function mockReject(status: number, message: string) {
  return Promise.reject({ response: { status, data: { message } } });
}

jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: () =>
      mockPolicyFails
        ? Promise.reject(new Error('network'))
        : Promise.resolve({ data: { invite_code_required: false, providers: ['email', 'apple'] } }),
    getInvitePreview: (code: string) => Promise.resolve({ data: { valid: !!mockDb.codes[code] } }),
    validateInviteCode: (code: string) => {
      const r = mockDb.codes[code];
      return Promise.resolve({ data: { valid: !!r && r.family === 'invite' } });
    },
    attachInviteCode: (code: string) => {
      mockCalls.push(`attach:${code}`);
      const r = mockDb.codes[code];
      if (!r) return mockReject(400, 'Invalid or expired invite code');
      if (r.max !== null && r.used >= r.max) return mockReject(400, 'Invalid or expired invite code');
      r.used += 1;
      mockDb.user = { ...mockDb.user, role: 'student', coach_id: r.coachId };
      return Promise.resolve({ data: { role: 'student', coach_id: r.coachId } });
    },
    selectRole: (role: string, code?: string) => {
      mockCalls.push(`selectRole:${role}:${code ?? ''}`);
      if (mockSelectRoleFails) return Promise.reject(new Error('Network Error'));
      if (code) {
        const r = mockDb.codes[code];
        if (!r || r.family !== 'invite') return mockReject(400, 'Invalid or expired invite code');
        if (r.max !== null && r.used >= r.max) return mockReject(400, 'Invalid or expired invite code');
        r.used += 1;
        mockDb.user = { ...mockDb.user, role: 'student', coach_id: r.coachId };
      } else {
        mockDb.user = { ...mockDb.user, role: 'student' };
      }
      return Promise.resolve({ data: { role: 'student', coach_id: mockDb.user.coach_id } });
    },
  },
}));

let mockCachedUser: { id: string; role: string | null; coach_id?: string | null } | null = null;
jest.mock('../../../lib/userCache', () => ({
  readUserCache: jest.fn(() => Promise.resolve(mockCachedUser ? { ...mockCachedUser } : null)),
  setUserCache: jest.fn((u: typeof mockCachedUser) => {
    mockCachedUser = u ? { ...u } : null;
    return Promise.resolve();
  }),
}));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(() => Promise.resolve('')) }));
const mockEmit = jest.fn();
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: () => mockEmit() } }));
jest.mock('../../../services/queryClient', () => ({
  purgePersistedQueryCacheForAllUsers: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import RoleSelectionScreen from '../RoleSelectionScreen';
import { __resetSignupPolicyCacheForTests, loadSignupPolicy } from '../../../lib/signupPolicy';

function route(params?: { inviteAttachError?: string; inviteCode?: string }) {
  return { key: 'k', name: 'RoleSelection' as const, params };
}

async function submitCode(code: string, params = { inviteAttachError: 'unknown' as string, inviteCode: code }) {
  const utils = await render(<RoleSelectionScreen navigation={{} as never} route={route(params)} />);
  await utils.findByTestId('invite-attach-retry-banner');
  await fireEvent.press(utils.getByTestId('role-continue'));
  return utils;
}

beforeEach(async () => {
  jest.clearAllMocks();
  __resetSignupPolicyCacheForTests();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockCalls.length = 0;
  mockSelectRoleFails = false;
  mockPolicyFails = false;
  mockDb.user = { id: 'u1', role: null, coach_id: null };
  mockDb.codes = {
    'GP-BRADLEY': { coachId: 'coach-bradley', used: 0, max: null, family: 'profile' },
    'INV-ONE': { coachId: 'coach-one', used: 0, max: 1, family: 'invite' },
    'INV-TEN': { coachId: 'coach-ten', used: 3, max: 10, family: 'invite' },
  };
  mockCachedUser = { id: 'u1', role: null, coach_id: null };
  await AsyncStorage.setItem('needs_role_selection', 'true');
});

describe('A2: single redemption against both code families', () => {
  it('permanent CoachProfile GP- code (absent from InviteCode) attaches and finishes', async () => {
    await submitCode('GP-BRADLEY');
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(mockCalls).toEqual(['attach:GP-BRADLEY', 'selectRole:student:']);
    expect(mockCachedUser).toMatchObject({ role: 'student', coach_id: 'coach-bradley' });
    expect(await AsyncStorage.getItem('needs_role_selection')).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('single-use InviteCode is consumed exactly once and reports success', async () => {
    await submitCode('INV-ONE');
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(mockDb.codes['INV-ONE'].used).toBe(1);
    expect(mockCachedUser).toMatchObject({ coach_id: 'coach-one' });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('bounded-use InviteCode increments by exactly one', async () => {
    await submitCode('INV-TEN');
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(mockDb.codes['INV-TEN'].used).toBe(4);
  });

  it('attach success then finalize network failure still commits the coach and finishes', async () => {
    mockSelectRoleFails = true;
    await submitCode('INV-ONE');
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(mockDb.codes['INV-ONE'].used).toBe(1);
    expect(mockCachedUser).toMatchObject({ role: 'student', coach_id: 'coach-one' });
    expect(await AsyncStorage.getItem('needs_role_selection')).toBeNull();
  });

  it('an exhausted code shows mapped copy and leaves role selection pending', async () => {
    mockDb.codes['INV-ONE'].used = 1;
    const utils = await submitCode('INV-ONE');
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(utils.queryByText(/Invalid or expired invite code/)).toBeNull();
    expect(mockCalls).toEqual(['attach:INV-ONE']);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('needs_role_selection')).toBe('true');
  });
});

describe('A1: policy outage never blocks codeless completion', () => {
  it('policy GET fails with nothing cached: Continue with no code completes as client', async () => {
    mockPolicyFails = true;
    const utils = await render(<RoleSelectionScreen navigation={{} as never} route={route()} />);
    await fireEvent.press(await utils.findByTestId('role-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(mockCalls).toEqual(['selectRole:student:']);
    expect(await AsyncStorage.getItem('needs_role_selection')).toBeNull();
  });

  it('policy fetched on CreateAccount, then the RoleSelection GET fails: last-known codeless policy is reused', async () => {
    await loadSignupPolicy(() => Promise.resolve({ data: { invite_code_required: false, providers: ['email'] } }));
    mockPolicyFails = true;
    const utils = await render(<RoleSelectionScreen navigation={{} as never} route={route()} />);
    await fireEvent.press(await utils.findByTestId('role-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(mockCalls).toEqual(['selectRole:student:']);
  });

  it('a last-known policy that REQUIRES a code is still honoured during an outage', async () => {
    await loadSignupPolicy(() => Promise.resolve({ data: { invite_code_required: true, providers: ['email'] } }));
    mockPolicyFails = true;
    const utils = await render(<RoleSelectionScreen navigation={{} as never} route={route()} />);
    await fireEvent.press(await utils.findByTestId('role-continue'));
    expect(await utils.findByText('Enter the invite code your coach shared.')).toBeTruthy();
    expect(mockCalls).toEqual([]);
  });
});

describe('B4: retry mode never auto-skips for a user who already has a coach', () => {
  it('cached coach_id + failed-attach params: no automatic completion; explicit keep-current-coach', async () => {
    mockCachedUser = { id: 'u1', role: 'student', coach_id: 'coach-a' };
    const utils = await render(
      <RoleSelectionScreen navigation={{} as never} route={route({ inviteAttachError: 'coach_inactive', inviteCode: 'GP-B' })} />,
    );
    await utils.findByTestId('invite-attach-retry-banner');
    const keep = await utils.findByTestId('role-keep-current-coach');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockEmit).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('needs_role_selection')).toBe('true');
    await fireEvent.press(keep);
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(mockCalls).toEqual([]);
  });

  it('outside retry mode a cached coach still takes the fast path', async () => {
    mockCachedUser = { id: 'u1', role: 'student', coach_id: 'coach-a' };
    await render(<RoleSelectionScreen navigation={{} as never} route={route()} />);
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
  });
});
