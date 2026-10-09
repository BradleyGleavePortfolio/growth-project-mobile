/**
 * #306 fix round 6, through the real screens (and the real Apple helper):
 *  - Sol B-306-4: Login and the CreateAccount verify step tell the backend's
 *    two 401s apart ("Email not confirmed..." vs "Invalid email or
 *    password"), for string and array messages.
 *  - Sol B-306-5: an unknown provider failure keeps the backend reference
 *    all the way to the screen and the Sentry event; an unconfirmed coach
 *    signup (email, Apple, Google) keeps "may or may not have been created"
 *    and now carries a reference, Contact support and a sanitised event.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPolicy = jest.fn();
const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockApplePost = jest.fn();
const mockNativeApple = jest.fn();
const mockGoogle = jest.fn();
const mockCaptureError = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockApplePost(...a) },
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockPolicy(...a),
    login: (...a: unknown[]) => mockLogin(...a),
    register: (...a: unknown[]) => mockRegister(...a),
    getInvitePreview: jest.fn(),
  },
}));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: (...a: unknown[]) => mockNativeApple(...a),
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../../utils/googleAuth', () => ({ signInWithGoogle: (...a: unknown[]) => mockGoogle(...a) }));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }));
jest.mock('../../../components/AppleSignInButton', () => {
  const { TouchableOpacity, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ onPress }: { onPress: () => void }) => (
      <TouchableOpacity testID="apple-button" onPress={onPress}>
        <Text>Apple</Text>
      </TouchableOpacity>
    ),
  };
});
jest.mock('../../../services/secureStorage', () => ({
  secureStorage: {
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('../../../lib/userCache', () => ({ setUserCache: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../services/queryClient', () => ({
  purgePersistedQueryCacheForAllUsers: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../lib/analytics', () => ({ identify: jest.fn(), track: jest.fn() }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

import CreateAccountScreen from '../CreateAccountScreen';
import LoginScreen from '../LoginScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';
import { toAuthErrorDetail } from '../../../utils/authErrorDetail';

type Nav = { navigate: jest.Mock; replace: jest.Mock };
const OFF = { invite_code_required: false, providers: ['email', 'apple', 'google'], role_choice: false };
const ON = { ...OFF, role_choice: true };
const REF = 'feedface-0000-4000-8000-000000000000';
const UNCONFIRMED_401 = 'Email not confirmed. Please check your inbox and verify your email first.';
const SECRETS = /private-test-token|PrivateTestPassword|audit@example\.com/;

function httpError(status: number, message: string | string[]) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { message, request_id: REF }, headers: { 'X-Request-Id': REF } },
    config: { headers: { Authorization: 'Bearer private-test-token' }, data: '{"password":"PrivateTestPassword"}' },
  });
}

async function renderLogin(email = 'audit@example.com') {
  const nav: Nav = { navigate: jest.fn(), replace: jest.fn() };
  const ui = await render(
    <LoginScreen navigation={nav as never} route={{ key: 'l', name: 'Login', params: { email } } as never} />,
  );
  await waitFor(() => expect(mockPolicy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 10));
  return { nav, ...ui };
}

async function renderSignup(role: 'client' | 'coach') {
  mockPolicy.mockResolvedValue({ data: ON });
  const nav: Nav = { navigate: jest.fn(), replace: jest.fn() };
  const ui = await render(<CreateAccountScreen navigation={nav as never} />);
  // Prototype ROLE (01): a row tap selects, Continue commits.
  await fireEvent.press(await ui.findByTestId(`role-choice-${role}`));
  await fireEvent.press(ui.getByTestId('role-choice-continue'));
  return { nav, ...ui };
}

async function emailSignup(role: 'client' | 'coach') {
  const ui = await renderSignup(role);
  await fireEvent.changeText(ui.getByLabelText('Full name'), 'Audit Person');
  await fireEvent.changeText(ui.getByLabelText('Email'), 'audit@example.com');
  await fireEvent.changeText(ui.getByLabelText('Password'), 'Str0ng!pass');
  await fireEvent.press(ui.getByLabelText('Create account'));
  return ui;
}

function expectReported(event: string, status: number | null) {
  expect(mockCaptureError).toHaveBeenCalledTimes(1);
  const [error, context] = mockCaptureError.mock.calls[0];
  expect((error as Error).message).toBe(event);
  expect(context).toMatchObject({ status, reference: REF });
  expect(JSON.stringify(mockCaptureError.mock.calls[0])).not.toMatch(SECRETS);
}

describe('#306 r6 auth failures through the real screens', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
    Platform.OS = 'ios';
    mockPolicy.mockResolvedValue({ data: OFF });
    mockNativeApple.mockResolvedValue({ identityToken: 'native-apple-token', email: 'audit@example.com' });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  describe('Sol B-306-4', () => {
    it.each([[UNCONFIRMED_401], [[UNCONFIRMED_401]]])('Login: 401 %p says the email is not confirmed', async (message) => {
      mockLogin.mockRejectedValue(httpError(401, message));
      const ui = await renderLogin();
      await fireEvent.changeText(ui.getByLabelText('Password'), 'Str0ng!pass');
      await fireEvent.press(ui.getByLabelText('Sign in'));
      expect(await ui.findByText(/Your email is not confirmed yet/)).toBeTruthy();
      expect(ui.queryByText(/don’t match/)).toBeNull();
      expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('Login: 401 "Invalid email or password" is wrong credentials (guard)', async () => {
      mockLogin.mockRejectedValue(httpError(401, 'Invalid email or password'));
      const ui = await renderLogin();
      await fireEvent.changeText(ui.getByLabelText('Password'), 'wrong');
      await fireEvent.press(ui.getByLabelText('Sign in'));
      expect(await ui.findByText(/That email and password don’t match/)).toBeTruthy();
      expect(ui.queryByText(/not confirmed/)).toBeNull();
    });

    it('verify step: a wrong password never says the email is unverified, and offers Log in', async () => {
      mockRegister.mockResolvedValue({ data: { requires_verification: true, role: 'student' } });
      mockLogin.mockRejectedValue(httpError(401, 'Invalid email or password'));
      const ui = await emailSignup('client');
      await fireEvent.press(await ui.findByText('I verified my email'));
      expect(await ui.findByText(/That email and password don’t match an account/)).toBeTruthy();
      expect(ui.queryByText(/not verified/)).toBeNull();
      await fireEvent.press(ui.getByTestId('verify-error-log-in'));
      expect(ui.nav.navigate).toHaveBeenCalledWith('Login', { email: 'audit@example.com' });
    });

    it.each([[UNCONFIRMED_401], [[UNCONFIRMED_401]]])('verify step: 401 %p says the email is not verified yet', async (message) => {
      mockRegister.mockResolvedValue({ data: { requires_verification: true, role: 'student' } });
      mockLogin.mockRejectedValue(httpError(401, message));
      const ui = await emailSignup('client');
      await fireEvent.press(await ui.findByText('I verified my email'));
      expect(await ui.findByText(/Your email is not verified yet/)).toBeTruthy();
      expect(ui.queryByTestId('verify-error-log-in')).toBeNull();
    });
  });

  describe('Sol B-306-5', () => {
    it('real Apple helper -> Login: a 500 keeps the backend reference on screen and in Sentry', async () => {
      mockApplePost.mockRejectedValue(httpError(500, 'Internal server error'));
      const ui = await renderLogin();
      await fireEvent.press(ui.getByTestId('apple-button'));
      expect(await ui.findByText(/Sign in with Apple didn’t go through.*reference FEEDFACE/)).toBeTruthy();
      expect(ui.getByTestId('login-error-support')).toBeTruthy();
      expectReported('auth_sign_in_failed', 500);
    });

    it('real Apple helper -> Login: a provider 401 is not "email and password don’t match" (Opus C-306-6)', async () => {
      mockApplePost.mockRejectedValue(httpError(401, 'Invalid Apple token'));
      const ui = await renderLogin();
      await fireEvent.press(ui.getByTestId('apple-button'));
      expect(await ui.findByText(/reference FEEDFACE/)).toBeTruthy();
      expect(ui.queryByText(/don’t match/)).toBeNull();
      expectReported('auth_sign_in_failed', 401);
    });

    it('Google helper detail -> Login: the reference survives the helper', async () => {
      mockGoogle.mockResolvedValue({
        success: false,
        error: 'Internal server error',
        error_detail: toAuthErrorDetail(httpError(503, 'Service unavailable')),
      });
      const ui = await renderLogin();
      await fireEvent.press(ui.getByLabelText('Continue with Google'));
      expect(await ui.findByText(/Sign in with Google didn’t go through.*reference FEEDFACE/)).toBeTruthy();
      expectReported('auth_sign_in_failed', 503);
    });

    it('email coach signup 500: keeps the uncertainty AND reports a reference', async () => {
      mockRegister.mockRejectedValue(httpError(500, 'Internal server error'));
      const ui = await emailSignup('coach');
      expect(await ui.findByText(/An account may or may not have been created.*reference FEEDFACE/)).toBeTruthy();
      expect(ui.queryByText(/No account was created/)).toBeNull();
      expect(ui.getByTestId('signup-error-support')).toBeTruthy();
      expectReported('auth_sign_up_unconfirmed', 500);
    });

    it('real Apple helper coach signup 500: same, with the Apple status and reference', async () => {
      mockApplePost.mockRejectedValue(httpError(500, 'Internal server error'));
      const ui = await renderSignup('coach');
      await fireEvent.press(await ui.findByTestId('apple-button'));
      expect(await ui.findByText(/An account may or may not have been created.*reference FEEDFACE/)).toBeTruthy();
      expect(ui.getByTestId('signup-error-support')).toBeTruthy();
      expectReported('auth_sign_up_unconfirmed', 500);
    });

    it('Google coach signup unconfirmed: the helper detail gives the reference', async () => {
      mockGoogle.mockResolvedValue({
        success: false,
        error: 'Could not confirm the coach account',
        error_code: 'coach_signup_unconfirmed',
        provider_email: 'audit@example.com',
        provider_subject: 'supa-1',
        error_detail: toAuthErrorDetail(httpError(502, 'Bad gateway')),
      });
      const ui = await renderSignup('coach');
      await fireEvent.press(await ui.findByLabelText('Continue with Google'));
      expect(await ui.findByText(/An account may or may not have been created.*reference FEEDFACE/)).toBeTruthy();
      expectReported('auth_sign_up_unconfirmed', 502);
    });
  });
});
