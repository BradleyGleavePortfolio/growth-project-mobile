/**
 * C7-S1 (MOCKUP3 C7 index-b-join, slice 1): the auth entry in Style B with
 * featureFlags.firstRunV2 ON. Identity path: every sign-in, sign-up and reset
 * request is asserted with the arguments the flag-off screens send. The
 * flag-off screens stay covered by the existing suites, which run with the
 * flag at its default (off, asserted first).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens, colorScheme: 'light' }),
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
const mockSupabase = {
  auth: { setSession: jest.fn(async () => ({ error: null })), updateUser: jest.fn(async () => ({ error: null })), signOut: jest.fn(async () => undefined) },
};
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupabase }));

import WelcomeScreen from '../WelcomeScreen';
import LoginScreen from '../LoginScreen';
import CreateAccountScreen from '../CreateAccountScreen';
import ForgotPasswordScreen from '../ForgotPasswordScreen';
import ResetPasswordScreen from '../ResetPasswordScreen';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

const OPTIONAL = { invite_code_required: false, providers: ['email', 'google'], role_choice: true };
const nav = () => ({ navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => false) });
type Nav = ReturnType<typeof nav>;
const login = (n: Nav) => render(<LoginScreen navigation={n as never} route={{ key: 'l', name: 'Login' } as never} />);
const create = (n: Nav, params?: { invite_code?: string }) =>
  render(<CreateAccountScreen navigation={n as never} route={params ? { params } : undefined} />);

beforeEach(async () => {
  jest.clearAllMocks();
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
  const view = await render(<WelcomeScreen navigation={n as never} />);
  expect(view.getByText('The Growth Project')).toBeTruthy();
  await fireEvent.press(view.getByTestId('welcome-get-started'));
  expect(HapticService.mediumImpact).toHaveBeenCalledTimes(1);
  expect(n.navigate).toHaveBeenLastCalledWith('CreateAccount');
  await fireEvent.press(view.getByTestId('welcome-log-in'));
  expect(n.navigate).toHaveBeenLastCalledWith('Login');
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

it('Sign in: "or" only under a provider on screen; Google keeps the existing-account question and its call', async () => {
  mockApi.getSignupPolicy.mockResolvedValue({ data: { ...OPTIONAL, providers: ['email'] } });
  const bare = await login(nav());
  await waitFor(() => expect(mockApi.getSignupPolicy).toHaveBeenCalled());
  expect(bare.queryByTestId('login-or')).toBeNull();
  bare.unmount();
  mockAppleOnDevice = true;
  const apple = await login(nav());
  expect(await apple.findByTestId('login-or')).toBeTruthy();
  apple.unmount();
  mockAppleOnDevice = false;
  __resetSignupPolicyCacheForTests();
  mockApi.getSignupPolicy.mockResolvedValue({ data: OPTIONAL });
  mockGoogle.mockResolvedValue({ success: false, error: 'cancelled' });
  const google = await login(nav());
  await fireEvent.press(await google.findByLabelText('Continue with Google'));
  expect(google.getByTestId('login-or')).toBeTruthy();
  expect(mockGoogle).not.toHaveBeenCalled();
  await fireEvent.press(google.getByText('Sign in to existing account'));
  await waitFor(() => expect(mockGoogle).toHaveBeenCalledWith());
});

it('Create account, code optional: no code action or field; the same register request', async () => {
  const view = await create(nav());
  await fireEvent.press(await view.findByTestId('role-choice-client'));
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId('role-choice-invite-code')).toBeNull();
  expect(view.getByText('Have a code from your coach? You enter it right after you sign up.')).toBeTruthy();
  await fireEvent.press(view.getByTestId('role-choice-continue'));
  expect(view.queryByTestId('invite-code-input')).toBeNull();
  expect(view.getByText('Minimum 8 characters, 1 uppercase, 1 number, 1 special')).toBeTruthy();
  await fireEvent.changeText(view.getByLabelText('Full name'), 'Jordan');
  await fireEvent.changeText(view.getByLabelText('Email'), 'jordan@example.com');
  await fireEvent.changeText(view.getByLabelText('Password'), 'Secret1!');
  await fireEvent.press(view.getByTestId('create-account-submit'));
  await waitFor(() =>
    expect(mockApi.register).toHaveBeenCalledWith({ name: 'Jordan', email: 'jordan@example.com', password: 'Secret1!', phone: undefined }, 'client'),
  );
  expect(mockApi.signupWithCode).not.toHaveBeenCalled();
  expect(await view.findByTestId('create-account-verify')).toBeTruthy();
});

it('Create account keeps the code field when the policy requires it or does not answer', async () => {
  mockApi.getSignupPolicy.mockResolvedValue({ data: { invite_code_required: true, providers: ['email'] } });
  const required = await create(nav());
  expect(await required.findByTestId('invite-code-input')).toBeTruthy();
  expect(required.getByText('INVITE CODE')).toBeTruthy();
  required.unmount();
  __resetSignupPolicyCacheForTests();
  mockApi.getSignupPolicy.mockRejectedValue(new Error('offline'));
  const unknown = await create(nav());
  await fireEvent.press(await unknown.findByTestId('role-choice-client'));
  expect(unknown.getByTestId('role-choice-invite-code')).toBeTruthy();
  await fireEvent.press(unknown.getByTestId('role-choice-continue'));
  expect(unknown.getByTestId('invite-code-input')).toBeTruthy();
});

it('Create account from a join link keeps the code and today\'s signup-with-code request', async () => {
  const view = await create(nav(), { invite_code: 'TGP-R8N3VW5' });
  expect((await view.findByTestId('invite-code-input')).props.value).toBe('TGP-R8N3VW5');
  await fireEvent.changeText(view.getByLabelText('Full name'), 'Jordan');
  await fireEvent.changeText(view.getByLabelText('Email'), 'jordan@example.com');
  await fireEvent.changeText(view.getByLabelText('Password'), 'Secret1!');
  await fireEvent.press(view.getByTestId('create-account-submit'));
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

it('Reset password: same Supabase session, update and sign-out; success haptic; Go to login', async () => {
  const n = nav();
  const route = { key: 'r', name: 'ResetPassword', params: { access_token: 'a', refresh_token: 'r' } };
  const view = await render(<ResetPasswordScreen navigation={n as never} route={route as never} />);
  await fireEvent.changeText(view.getByLabelText('New password'), 'Newpass1!');
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'Newpass1!');
  await fireEvent.press(view.getByTestId('reset-submit'));
  expect(await view.findByText('Password updated')).toBeTruthy();
  expect(mockSupabase.auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({ password: 'Newpass1!' });
  expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  expect(HapticService.success).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByTestId('reset-go-to-login'));
  expect(n.navigate).toHaveBeenLastCalledWith('Login');
});
