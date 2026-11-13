/**
 * GOAL-935-M (agent 203, 203-D20 op 1): Create account in C7 Style B draws Google's four-colour mark and the semibold
 * label, exactly as Sign in's Style B already does (B_create_ios390_100.png rows 852-958: the mark left of "Continue with
 * Google"; LoginScreen GoogleMark at 8efe38e0). One GoogleMark, in the auth screens' own parts file (AuthStyleB.tsx).
 * Carries LO-935R5C C1 (btest/LO-935R5C-m935-C1 @ 95039f58). Every handler is today's: the same Google sign-up call, and a
 * coach's unticked terms box still comes first.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const mockApi = {
  getSignupPolicy: jest.fn(),
  login: jest.fn(),
  register: jest.fn(),
  signupWithCode: jest.fn(),
  getInvitePreview: jest.fn(),
  forgotPassword: jest.fn(),
};
jest.mock('../../../services/api', () => ({ get authApi() { return mockApi; } }));
let mockStyleB = true;
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  // A getter defined after the copy (an object spread would read it once, at mock time).
  const flags = { ...actual.featureFlags };
  Object.defineProperty(flags, 'firstRunV2', { get: () => mockStyleB, enumerable: true });
  return { ...actual, featureFlags: flags };
});
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
    colors: new Proxy({}, { get: () => '#000000' }),
    colorScheme: 'light',
  }),
}));
jest.mock('../../../components/AppleSignInButton', () => ({ __esModule: true, default: () => null }));
const mockGoogle = jest.fn();
jest.mock('../../../utils/googleAuth', () => ({ signInWithGoogle: (...a: unknown[]) => mockGoogle(...a) }));
jest.mock('../../../utils/appleAuth', () => ({ signInWithApple: jest.fn() }));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(), setStringAsync: jest.fn() }));
jest.mock('../../../services/secureStorage', () => ({
  secureStorage: { setItem: jest.fn(async () => undefined), getItem: jest.fn(async () => null), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../../../lib/userCache', () => ({ setUserCache: jest.fn(async () => undefined) }));
jest.mock('../../../services/queryClient', () => ({ purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn(), identify: jest.fn() }));
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: jest.fn() } }));

import LoginScreen from '../LoginScreen';
import CreateAccountScreen from '../CreateAccountScreen';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

const OPTIONAL = { invite_code_required: false, providers: ['email', 'google'], role_choice: true };
const HIDDEN = { includeHiddenElements: true };
const CODE = 'TGP-R8N3VW5';
const nav = () => ({ navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => false) });
const create = (params?: { invite_code?: string }) =>
  render(<CreateAccountScreen navigation={nav() as never} route={params ? { params } : undefined} />);
const login = () => render(<LoginScreen navigation={nav() as never} route={{ key: 'l', name: 'Login' } as never} />);
const flat = (el: { props: object }) => (StyleSheet.flatten((el.props as { style?: object }).style) ?? {}) as Record<string, unknown>;
const labelOf = (google: { findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => Array<{ props: Record<string, unknown> }> }) =>
  google.findAll((n) => typeof n.type === 'string' && n.props.children === 'Continue with Google')[0];

beforeEach(async () => {
  jest.clearAllMocks();
  mockStyleB = true;
  __resetSignupPolicyCacheForTests();
  await AsyncStorage.clear();
  for (const k of ['selection', 'softImpact', 'mediumImpact', 'success', 'error'] as const) {
    jest.spyOn(HapticService, k).mockResolvedValue(undefined);
  }
  mockApi.getSignupPolicy.mockResolvedValue({ data: OPTIONAL });
  mockApi.getInvitePreview.mockResolvedValue({ data: { valid: true, coach_name: 'Sam' } });
  mockGoogle.mockResolvedValue({ success: false, error: 'cancelled' });
});

describe('GOAL-935-M S1: Google\'s mark on Create account (C7 Style B)', () => {
  // LO-935R5C C1 (agent 200, btest/LO-935R5C-m935-C1 @ 95039f58), carried here: B_create draws Google's four-colour mark.
  it('LO-935R5C C1: Create account Style B shows Google\'s four-colour mark, not a typed G', async () => {
    const view = await create({ invite_code: CODE });
    await view.findByLabelText('Continue with Google');
    expect(view.queryByText('G')).toBeNull();
  });

  it('S1: Style B draws create-account-google-mark and the semibold label, as Sign in does', async () => {
    const view = await create({ invite_code: CODE });
    const google = await view.findByLabelText('Continue with Google');
    expect(view.getByTestId('create-account-google-mark', HIDDEN)).toBeTruthy();
    expect(flat(labelOf(google as never))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontWeight: '600' });
    const signIn = await login();
    const signInGoogle = await signIn.findByLabelText('Continue with Google');
    expect(flat(labelOf(signInGoogle as never))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontWeight: '600' });
  });

  it('S1 (REC): the classic path (Style B off) keeps its typed "G", as Sign in\'s classic branch does', async () => {
    mockStyleB = false;
    const view = await create({ invite_code: CODE });
    await view.findByLabelText('Continue with Google');
    expect(view.getByText('G')).toBeTruthy();
    expect(view.queryByTestId('create-account-google-mark', HIDDEN)).toBeNull();
  });

  it('Sign in still draws login-google-mark, and no typed "G"', async () => {
    const view = await login();
    await view.findByLabelText('Continue with Google');
    expect(view.getByTestId('login-google-mark', HIDDEN)).toBeTruthy();
    expect(view.queryByText('G')).toBeNull();
  });

  it('GoogleMark lives once: one product file holds the four fills (AuthStyleB.tsx)', () => {
    const SRC = path.join(__dirname, '..', '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== '__mocks__') walk(p); }
        else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
      }
    };
    walk(SRC);
    const holders = files.filter((f) => fs.readFileSync(f, 'utf8').includes('fill="#EA4335"')).map((f) => path.relative(SRC, f));
    expect(holders).toEqual([path.join('screens', 'auth', 'AuthStyleB.tsx')]);
    const parts = fs.readFileSync(path.join(SRC, 'screens', 'auth', 'AuthStyleB.tsx'), 'utf8');
    for (const c of ['#EA4335', '#4285F4', '#FBBC05', '#34A853']) expect(parts).toContain(`fill="${c}"`);
  });

  it('tapping Continue with Google on Create account still makes the same sign-up call', async () => {
    const view = await create({ invite_code: CODE });
    await fireEvent.press(await view.findByLabelText('Continue with Google'));
    await waitFor(() => expect(mockGoogle).toHaveBeenCalledTimes(1));
    expect(mockGoogle.mock.calls[0][0]).toMatchObject({ inviteCode: CODE });
  });

  it('a coach with the terms box unticked still meets the box first: Google is not called', async () => {
    const view = await create();
    await fireEvent.press(await view.findByTestId('role-choice-coach'));
    await fireEvent.press(view.getByTestId('role-choice-continue'));
    const google = await view.findByLabelText('Continue with Google');
    expect(view.getByTestId('create-account-google-mark', HIDDEN)).toBeTruthy();
    expect(flat(view.getByTestId('create-account-providers'))).toMatchObject({ opacity: 0.4 });
    await fireEvent.press(google);
    expect(mockGoogle).not.toHaveBeenCalled();
    expect(view.getByTestId('create-account-coach-terms')).toBeTruthy();
  });
});
