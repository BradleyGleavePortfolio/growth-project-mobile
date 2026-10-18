/**
 * C7-S1 (MOCKUP3 C7 index-b-join, slice 1): the auth entry in Style B with
 * featureFlags.firstRunV2 ON. Identity path: every sign-in, sign-up and reset
 * request is asserted with the arguments the flag-off screens send. The
 * flag-off screens stay covered by the existing suites, which run with the
 * flag at its default (off, asserted first).
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { StatusBarBand, STATUS_BAR_BONE } from '../../../components/StatusBarBand';
import { lightTokens } from '../../../theme/tokens';

const mockApi = {
  getSignupPolicy: jest.fn(),
  login: jest.fn(),
  register: jest.fn(),
  signupWithCode: jest.fn(),
  getInvitePreview: jest.fn(),
  forgotPassword: jest.fn(),
};
jest.mock('../../../services/api', () => ({ get authApi() { return mockApi; } }));
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, firstRunV2: true } };
});
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
    colors: new Proxy({}, { get: () => '#000000' }),
    colorScheme: 'light',
  }),
}));
let mockAppleOnDevice = false;
jest.mock('../../../components/AppleSignInButton', () => {
  const { useEffect } = jest.requireActual('react');
  const { Pressable } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: function Apple({ onPress, onAvailable }: { onPress: () => void; onAvailable?: () => void }) {
      useEffect(() => { if (mockAppleOnDevice) onAvailable?.(); }, [onAvailable]);
      return mockAppleOnDevice ? <Pressable testID="apple-button" onPress={onPress} /> : null;
    },
  };
});
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
jest.mock('react-native/Libraries/Components/StatusBar/StatusBar', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: object) => <View testID="status-bar" {...p} /> };
});
jest.mock('expo-status-bar', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { StatusBar: (p: object) => createElement(View, { testID: 'band-icons', ...p }) };
});

import WelcomeScreen from '../WelcomeScreen';
import LoginScreen from '../LoginScreen';
import CreateAccountScreen from '../CreateAccountScreen';
import ForgotPasswordScreen from '../ForgotPasswordScreen';
import ResetPasswordScreen from '../ResetPasswordScreen';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

const OPTIONAL = { invite_code_required: false, providers: ['email', 'google'], role_choice: true };
const HIDDEN = { includeHiddenElements: true };
const nav = () => ({ navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => false) });
type Nav = ReturnType<typeof nav>;
const login = (n: Nav) => render(<LoginScreen navigation={n as never} route={{ key: 'l', name: 'Login' } as never} />);
const create = (n: Nav, params?: { invite_code?: string }) =>
  render(<CreateAccountScreen navigation={n as never} route={params ? { params } : undefined} />);
let focused = true;
const focusListeners = new Map<string, Set<() => void>>();
const focusNavigation = {
  isFocused: () => focused,
  addListener: (event: string, listener: () => void) => {
    const handlers = focusListeners.get(event) ?? new Set();
    handlers.add(listener);
    focusListeners.set(event, handlers);
    return () => { handlers.delete(listener); };
  },
};
const welcome = (n: Nav) => (
  <NavigationContext.Provider value={focusNavigation as never}>
    <WelcomeScreen navigation={n as never} />
  </NavigationContext.Provider>
);
const changeFocus = async (next: boolean) => {
  await act(() => {
    focused = next;
    focusListeners.get(next ? 'focus' : 'blur')?.forEach((listener) => listener());
  });
};

beforeEach(async () => {
  jest.clearAllMocks();
  focused = true;
  focusListeners.clear();
  mockAppleOnDevice = false;
  __resetSignupPolicyCacheForTests();
  await AsyncStorage.clear();
  for (const k of ['selection', 'softImpact', 'mediumImpact', 'success', 'error'] as const) {
    jest.spyOn(HapticService, k).mockResolvedValue(undefined);
  }
  mockApi.getSignupPolicy.mockResolvedValue({ data: OPTIONAL });
  mockApi.getInvitePreview.mockResolvedValue({ data: { valid: true, coach_name: 'Sam' } });
  mockApi.register.mockResolvedValue({ data: { requires_verification: true, role: 'student' } });
  mockApi.signupWithCode.mockResolvedValue({ data: { invite_attached: true } });
});

it('the flag is off by default, so the existing auth suites cover main', () => {
  expect(jest.requireActual('../../../config/featureFlags').featureFlags.firstRunV2).toBe(false);
});

it('Welcome: Get started opens Create account with mediumImpact; Log in opens Sign in', async () => {
  const n = nav();
  const view = await render(welcome(n));
  expect(view.getByText('The Growth Project')).toBeTruthy();
  await fireEvent.press(view.getByTestId('welcome-get-started'));
  expect(HapticService.mediumImpact).toHaveBeenCalledTimes(1);
  expect(n.navigate).toHaveBeenLastCalledWith('CreateAccount');
  await fireEvent.press(view.getByTestId('welcome-log-in'));
  expect(n.navigate).toHaveBeenLastCalledWith('Login');
});

// The native stack retains Welcome behind the next screen: blur must release
// its forest inset and light icons even though Welcome has not unmounted.
const overWelcome: Array<[string, (n: Nav) => React.ReactNode]> = [
  ['Welcome', () => null],
  ['Sign in', (n) => <LoginScreen navigation={n as never} route={{ key: 'l', name: 'Login' } as never} />],
  ['Create account, role step', (n) => <CreateAccountScreen navigation={n as never} route={undefined} />],
  ['Create account, form', (n) => <CreateAccountScreen navigation={n as never} route={{ params: { invite_code: 'TGP-R8N3VW5' } }} />],
  ['Forgot password', (n) => <ForgotPasswordScreen navigation={n as never} />],
  ['Reset password', (n) => <ResetPasswordScreen navigation={n as never} route={{ key: 'r', name: 'ResetPassword', params: { access_token: 'a', refresh_token: 'r' } } as never} />],
];
it.each(overWelcome)('%s: focused Welcome alone owns the forest band and light icons', async (screen, top) => {
  const n = nav();
  const view = await render(
    <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
      <StatusBar barStyle="dark-content" />
      {welcome(n)}{top(n)}
      <StatusBarBand />
    </SafeAreaInsetsContext.Provider>,
  );
  const bandColor = () => StyleSheet.flatten(view.getByTestId('status-bar-band').props.style).backgroundColor;
  expect(bandColor()).toBe(lightTokens.surface.forestBand);
  expect(view.getByTestId('band-icons', HIDDEN).props.style).toBe('light');
  if (screen === 'Welcome') return;
  await changeFocus(false);
  expect(bandColor()).toBe(STATUS_BAR_BONE);
  expect(view.queryByTestId('band-icons', HIDDEN)).toBeNull();
  expect(view.getAllByTestId('status-bar', HIDDEN).map((bar) => bar.props.barStyle)).toEqual(['dark-content']);
  await changeFocus(true);
  expect(bandColor()).toBe(lightTokens.surface.forestBand);
  expect(view.getByTestId('band-icons', HIDDEN).props.style).toBe('light');
});

it('unmounting focused Welcome restores the band even without a blur event', async () => {
  const content = (showWelcome: boolean) => (
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: 16, left: 0, right: 0 }}>
      {showWelcome ? welcome(nav()) : null}
      <StatusBarBand />
    </SafeAreaInsetsContext.Provider>
  );
  const view = await render(content(true));
  expect(view.getByTestId('band-icons', HIDDEN).props.style).toBe('light');
  await view.rerender(content(false));
  expect(StyleSheet.flatten(view.getByTestId('status-bar-band').props.style).backgroundColor).toBe(STATUS_BAR_BONE);
  expect(view.queryByTestId('band-icons', HIDDEN)).toBeNull();
});

it('Sign in: same login request; a wrong password shows the hint under the field, error haptic once', async () => {
  mockApi.login.mockRejectedValue({ response: { status: 401, data: { message: 'Invalid email or password' } } });
  const n = nav();
  const view = await login(n);
  await fireEvent.changeText(view.getByLabelText('Email'), ' jordan@example.com ');
  await fireEvent.changeText(view.getByLabelText('Password'), 'Secret1!');
  await fireEvent.press(view.getByTestId('login-submit'));
  await waitFor(() => expect(mockApi.login).toHaveBeenCalledWith({ email: 'jordan@example.com', password: 'Secret1!' }));
  expect(await view.findByText('Invalid email or password')).toBeTruthy();
  expect(view.getByText('Check the email and password, or reset your password.')).toBeTruthy();
  expect(HapticService.error).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Password').props.value).toBe('Secret1!');
  await fireEvent.press(view.getByLabelText('Show password'));
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Password').props.secureTextEntry).toBe(false);
});

it('Sign in: every action lands on a real screen', async () => {
  const n = nav();
  const view = await login(n);
  const taps: Array<[string, unknown[]]> = [
    ['Forgot password?', ['ForgotPassword']],
    ['Contact support', ['SupportInbox']],
    ['Sign up', ['CreateAccount']],
    ['Back', ['Welcome']],
  ];
  for (const [label, args] of taps) {
    await fireEvent.press(view.getByLabelText(label));
    expect(n.navigate).toHaveBeenLastCalledWith(...args);
  }
});

it('Sign in: no "or" without a provider on screen', async () => {
  mockApi.getSignupPolicy.mockResolvedValue({ data: { ...OPTIONAL, providers: ['email'] } });
  const view = await login(nav());
  await waitFor(() => expect(mockApi.getSignupPolicy).toHaveBeenCalled());
  expect(view.queryByTestId('login-or', HIDDEN)).toBeNull();
  expect(view.queryByText('or', HIDDEN)).toBeNull();
});

it('Sign in: "or" under the Apple button on iPhone', async () => {
  mockApi.getSignupPolicy.mockResolvedValue({ data: { ...OPTIONAL, providers: ['email'] } });
  mockAppleOnDevice = true;
  const view = await login(nav());
  expect(await view.findByTestId('login-or', HIDDEN)).toBeTruthy();
});

it('Sign in: Google keeps "or", the existing-account question and its call', async () => {
  mockGoogle.mockResolvedValue({ success: false, error: 'cancelled' });
  const view = await login(nav());
  await fireEvent.press(await view.findByLabelText('Continue with Google'));
  expect(view.getByTestId('login-or', HIDDEN)).toBeTruthy();
  expect(mockGoogle).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Sign in to existing account'));
  await waitFor(() => expect(mockGoogle).toHaveBeenCalledWith());
});

const fill = async (view: Awaited<ReturnType<typeof create>>) => {
  await fireEvent.changeText(view.getByLabelText('Full name'), 'Jordan');
  await fireEvent.changeText(view.getByLabelText('Email'), 'jordan@example.com');
  await fireEvent.changeText(view.getByLabelText('Password'), 'Secret1!');
  await fireEvent.press(view.getByTestId('create-account-submit'));
};

it('Create account, code optional: no role-step code action; the optional code field shows; no code sends register', async () => {
  const view = await create(nav());
  await fireEvent.press(await view.findByTestId('role-choice-client'));
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId('role-choice-invite-code')).toBeNull();
  expect(view.getByText('No coach code yet? You can add one after you sign up.')).toBeTruthy();
  await fireEvent.press(view.getByTestId('role-choice-continue'));
  expect(view.getByTestId('invite-code-input').props.value).toBe('');
  expect(view.getByText('INVITE CODE (OPTIONAL)')).toBeTruthy();
  expect(view.getByText('Minimum 8 characters, 1 uppercase, 1 number, 1 special')).toBeTruthy();
  await fill(view);
  await waitFor(() =>
    expect(mockApi.register).toHaveBeenCalledWith({ name: 'Jordan', email: 'jordan@example.com', password: 'Secret1!', phone: undefined }, 'client'),
  );
  expect(mockApi.signupWithCode).not.toHaveBeenCalled();
  expect(await view.findByTestId('create-account-verify')).toBeTruthy();
});

it('Create account, code optional: a typed code submits today\'s signup-with-code request', async () => {
  const view = await create(nav());
  await fireEvent.press(await view.findByTestId('role-choice-client'));
  await fireEvent.press(view.getByTestId('role-choice-continue'));
  await fireEvent.changeText(view.getByTestId('invite-code-input'), ' TGP-R8N3VW5 ');
  await fill(view);
  await waitFor(() => expect(mockApi.signupWithCode).toHaveBeenCalledTimes(1));
  expect(mockApi.signupWithCode.mock.calls[0][0]).toMatchObject({ name: 'Jordan', email: 'jordan@example.com', password: 'Secret1!', invite_code: 'TGP-R8N3VW5' });
  expect(mockApi.getInvitePreview).toHaveBeenCalledWith('TGP-R8N3VW5');
  expect(mockApi.register).not.toHaveBeenCalled();
});

it('Create account keeps the code field when the policy requires it', async () => {
  mockApi.getSignupPolicy.mockResolvedValue({ data: { invite_code_required: true, providers: ['email'] } });
  const view = await create(nav());
  expect(await view.findByTestId('invite-code-input')).toBeTruthy();
  expect(view.getByText('INVITE CODE')).toBeTruthy();
});

it('Create account keeps the code action and field when the policy does not answer', async () => {
  mockApi.getSignupPolicy.mockRejectedValue(new Error('offline'));
  const view = await create(nav());
  await fireEvent.press(await view.findByTestId('role-choice-client'));
  expect(view.getByTestId('role-choice-invite-code')).toBeTruthy();
  await fireEvent.press(view.getByTestId('role-choice-continue'));
  expect(view.getByTestId('invite-code-input')).toBeTruthy();
});

it('Create account from a join link keeps the code and today\'s signup-with-code request', async () => {
  const view = await create(nav(), { invite_code: 'TGP-R8N3VW5' });
  expect((await view.findByTestId('invite-code-input')).props.value).toBe('TGP-R8N3VW5');
  await fill(view);
  await waitFor(() => expect(mockApi.signupWithCode).toHaveBeenCalledTimes(1));
  expect(mockApi.signupWithCode.mock.calls[0][0]).toMatchObject({ email: 'jordan@example.com', invite_code: 'TGP-R8N3VW5' });
  expect(mockApi.register).not.toHaveBeenCalled();
});

it('Forgot password: same request; the sent card, softImpact, Back to login and Contact support', async () => {
  mockApi.forgotPassword.mockResolvedValue({ data: {} });
  const n = nav();
  const view = await render(<ForgotPasswordScreen navigation={n as never} />);
  await fireEvent.changeText(view.getByLabelText('Email'), ' jordan@example.com ');
  await fireEvent.press(view.getByTestId('forgot-send'));
  await waitFor(() => expect(mockApi.forgotPassword).toHaveBeenCalledWith('jordan@example.com'));
  expect(await view.findByTestId('forgot-sent')).toBeTruthy();
  expect(view.getByText('Reset request submitted')).toBeTruthy();
  expect(HapticService.softImpact).toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('forgot-back-to-login'));
  expect(n.navigate).toHaveBeenLastCalledWith('Login');
  await fireEvent.press(view.getByTestId('forgot-support'));
  expect(n.navigate).toHaveBeenLastCalledWith('SupportInbox');
});

it('Reset password: the flag-on form keeps the same validator and handler; Back goes to Sign in', async () => {
  const n = nav();
  const route = { key: 'r', name: 'ResetPassword', params: { access_token: 'a', refresh_token: 'r' } };
  const view = await render(<ResetPasswordScreen navigation={n as never} route={route as never} />);
  await fireEvent.changeText(view.getByLabelText('New password'), 'Newpass1!');
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'Different1!');
  await fireEvent.press(view.getByTestId('reset-submit'));
  expect(view.getByText('Passwords do not match.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Back to login'));
  expect(n.navigate).toHaveBeenLastCalledWith('Login');
});

it('Reset password: same Supabase calls, then the success haptic and Go to login (source; jest cannot run the dynamic import)', () => {
  // Like ResetPasswordScreen.test.ts: the screen imports supabase-js lazily, which jest
  // only runs with --experimental-vm-modules, so the success path is checked in the source.
  const src = fs.readFileSync(path.join(__dirname, '..', 'ResetPasswordScreen.tsx'), 'utf8');
  expect(src).toMatch(/label="Update password" onPress=\{handleSubmit\}/);
  expect(src).toMatch(/setSession\(\{\s*access_token: accessToken,\s*refresh_token: refreshToken,\s*\}\)/);
  expect(src).toMatch(/await supabase\.auth\.signOut\(\);\s*setDone\(true\);\s*if \(authStyleB\(\)\) void HapticService\.success\(\);/);
  expect(src).toMatch(/label="Go to login" onPress=\{\(\) => navigation\.navigate\('Login'\)\}/);
});
