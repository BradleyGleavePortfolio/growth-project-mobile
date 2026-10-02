/**
 * #306 fix round 7, through the real Google and Apple helpers and the real
 * Login / CreateAccount screens (only the native, Supabase and HTTP
 * boundaries are mocked).
 *  - Sol B-306-5 (residual): an ordinary Google sign-in or client signup
 *    whose backend call fails is a failure. It used to come back as a
 *    provisional `success:true` user, enter RoleSelection, and drop the
 *    status and reference. Now it is mapped, or shows the backend reference
 *    with Contact support and is reported once to Sentry.
 *  - Every other provider failure branch: an unknown one has a reference and
 *    a report, a known one has specific copy and no report.
 *  - Opus C-306-8: Google "email address is not verified" never says "Open
 *    the link we sent".
 *  - Sol C-306-5 (residual): an unconfirmed-attempt marker with no identity
 *    is never bound to, or consumed by, a different person's sign-in.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockStore = new Map<string, string>();
const mockPolicy = jest.fn();
const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockGoogleBackend = jest.fn();
const mockApplePost = jest.fn();
const mockNativeApple = jest.fn();
const mockOpenAuth = jest.fn();
const mockCaptureError = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockApplePost(...a) },
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockPolicy(...a),
    login: (...a: unknown[]) => mockLogin(...a),
    register: (...a: unknown[]) => mockRegister(...a),
    googleAuth: (...a: unknown[]) => mockGoogleBackend(...a),
    attachInviteCode: jest.fn(() => Promise.reject(new Error('not used'))),
    getInvitePreview: jest.fn(),
  },
}));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'tgp://auth/callback' }));
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: (...a: unknown[]) => mockOpenAuth(...a),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      setSession: async () => ({
        data: { user: { id: 'supa-person-A', email: 'audit@example.com', user_metadata: { full_name: 'Audit' } } },
        error: null,
      }),
    },
  }),
}));
jest.mock('../../../config/env', () => ({
  env: { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'anon' },
}));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: (...a: unknown[]) => mockNativeApple(...a),
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
}));
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
    setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
  },
}));
jest.mock('../../../lib/userCache', () => ({ setUserCache: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../services/queryClient', () => ({
  purgePersistedQueryCacheForAllUsers: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../lib/analytics', () => ({ identify: jest.fn(), track: jest.fn() }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
const mockEmit = jest.fn();
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: () => mockEmit() } }));
jest.mock('../../../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

import CreateAccountScreen from '../CreateAccountScreen';
import LoginScreen from '../LoginScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';
import { hasAnyUnconfirmedCoachSignup, rememberUnconfirmedCoachSignup } from '../../../lib/coachSignupAttempt';

type Nav = { navigate: jest.Mock; replace: jest.Mock };
const OFF = { invite_code_required: false, providers: ['email', 'apple', 'google'], role_choice: false };
const ON = { ...OFF, role_choice: true };
const REF = 'feedface-0000-4000-8000-000000000000';
const SECRETS = /private-test-token|PrivateTestPassword|audit@example\.com|tok-1/;
const GOOGLE_OK = { type: 'success', url: 'tgp://auth/callback#access_token=tok-1&refresh_token=ref-1' };

function httpError(status: number, message: string | string[]) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { message, request_id: REF }, headers: { 'X-Request-Id': REF } },
    config: { headers: { Authorization: 'Bearer private-test-token' }, data: '{"password":"PrivateTestPassword"}' },
  });
}

async function renderLogin() {
  const nav: Nav = { navigate: jest.fn(), replace: jest.fn() };
  const ui = await render(
    <LoginScreen navigation={nav as never} route={{ key: 'l', name: 'Login', params: { email: 'audit@example.com' } } as never} />,
  );
  await waitFor(() => expect(mockPolicy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 10));
  return { nav, ...ui };
}

async function renderSignup(role: 'client' | 'coach') {
  mockPolicy.mockResolvedValue({ data: ON });
  const nav: Nav = { navigate: jest.fn(), replace: jest.fn() };
  const ui = await render(<CreateAccountScreen navigation={nav as never} />);
  await fireEvent.press(await ui.findByTestId(`role-choice-${role}`));
  return { nav, ...ui };
}

function expectReportedOnce(status: number | null, reference?: string, code?: string | null) {
  expect(mockCaptureError).toHaveBeenCalledTimes(1);
  const [, context] = mockCaptureError.mock.calls[0];
  expect(context).toMatchObject({ status, ...(reference ? { reference } : {}), ...(code !== undefined ? { code } : {}) });
  expect(JSON.stringify(mockCaptureError.mock.calls[0])).not.toMatch(SECRETS);
}

async function expectNoProvisionalSession() {
  expect(mockStore.has('supabase_token')).toBe(false);
  expect(mockStore.has('supabase_refresh_token')).toBe(false);
  expect(await AsyncStorage.getItem('user_data')).toBeNull();
}

describe('#306 r7 provider failures through the real helpers and screens', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore.clear();
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
    Platform.OS = 'ios';
    mockPolicy.mockResolvedValue({ data: OFF });
    mockOpenAuth.mockResolvedValue(GOOGLE_OK);
    mockNativeApple.mockResolvedValue({ identityToken: 'native-apple-token', user: 'apple-person-B' });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  describe('Sol B-306-5: Google backend failure on ordinary sign-in and client signup', () => {
    it('Login: a 500 is a failure with the backend reference, Contact support and one report; no app entry', async () => {
      mockGoogleBackend.mockRejectedValue(httpError(500, 'Internal server error'));
      const ui = await renderLogin();
      await fireEvent.press(ui.getByLabelText('Continue with Google'));
      expect(await ui.findByText(/Sign in with Google didn’t go through.*reference FEEDFACE/)).toBeTruthy();
      expect(ui.getByTestId('login-error-support')).toBeTruthy();
      expectReportedOnce(500, REF);
      expect(ui.nav.replace).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      await expectNoProvisionalSession();
    });

    it('CreateAccount client signup: a 500 is the same failure, not a provisional account', async () => {
      mockGoogleBackend.mockRejectedValue(httpError(500, 'Internal server error'));
      const ui = await renderSignup('client');
      await fireEvent.press(await ui.findByLabelText('Continue with Google'));
      expect(await ui.findByText(/Sign in with Google didn’t go through.*reference FEEDFACE/)).toBeTruthy();
      expect(ui.getByTestId('signup-error-support')).toBeTruthy();
      expectReportedOnce(500, REF);
      expect(ui.nav.replace).not.toHaveBeenCalled();
      await expectNoProvisionalSession();
    });

    it('Login: no answer at all is a connection message with no report', async () => {
      mockGoogleBackend.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
      const ui = await renderLogin();
      await fireEvent.press(ui.getByLabelText('Continue with Google'));
      expect(await ui.findByText(/couldn’t reach the server/)).toBeTruthy();
      expect(mockCaptureError).not.toHaveBeenCalled();
      expect(ui.nav.replace).not.toHaveBeenCalled();
    });

    it('Opus C-306-8: Google "email address is not verified" says to verify with Google, never "the link we sent"', async () => {
      mockGoogleBackend.mockRejectedValue(httpError(401, 'Google auth failed — email address is not verified'));
      const ui = await renderLogin();
      await fireEvent.press(ui.getByLabelText('Continue with Google'));
      expect(await ui.findByText(/Your Google account’s email is not verified. Verify it with Google/)).toBeTruthy();
      expect(ui.queryByText(/link we sent/)).toBeNull();
      expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('CreateAccount: a refused invite code on Google signup gets the invite copy', async () => {
      mockPolicy.mockResolvedValue({ data: OFF });
      mockGoogleBackend.mockRejectedValue(httpError(400, 'Invalid invite code'));
      const nav: Nav = { navigate: jest.fn(), replace: jest.fn() };
      const ui = await render(<CreateAccountScreen navigation={nav as never} />);
      await fireEvent.changeText(await ui.findByTestId('invite-code-input'), 'GP-NOPE1');
      await fireEvent.press(ui.getByLabelText('Continue with Google'));
      expect(await ui.findByText(/That invite code is not valid/)).toBeTruthy();
      expect(mockCaptureError).not.toHaveBeenCalled();
    });
  });

  describe('every other provider failure branch', () => {
    it('Google: no access token in the redirect is an unknown failure with a local reference and one report', async () => {
      mockOpenAuth.mockResolvedValue({ type: 'success', url: 'tgp://auth/callback#token_type=bearer' });
      const ui = await renderLogin();
      await fireEvent.press(ui.getByLabelText('Continue with Google'));
      expect(await ui.findByText(/Sign in with Google didn’t go through.*quote reference [A-Z0-9]{8}/)).toBeTruthy();
      expectReportedOnce(null);
    });

    it('Google: a provider configuration error has a reference and a report (it is our fault)', async () => {
      mockOpenAuth.mockResolvedValue({ type: 'success', url: 'tgp://auth/callback#error=invalid_client&error_description=bad' });
      const ui = await renderLogin();
      await fireEvent.press(ui.getByLabelText('Continue with Google'));
      expect(await ui.findByText(/Sign in with Google is not available right now.*quote reference [A-Z0-9]{8}/)).toBeTruthy();
      expectReportedOnce(null);
    });

    it('Google: a cancelled sheet stays silent and reports nothing', async () => {
      mockOpenAuth.mockResolvedValue({ type: 'cancel' });
      const ui = await renderLogin();
      await fireEvent.press(ui.getByLabelText('Continue with Google'));
      await new Promise((r) => setTimeout(r, 20));
      expect(ui.queryByTestId('login-error-support')).toBeNull();
      expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('Apple: a native sheet failure keeps its code in the report', async () => {
      mockNativeApple.mockRejectedValue(Object.assign(new Error('The operation couldn’t be completed.'), { code: 'ERR_REQUEST_FAILED' }));
      const ui = await renderLogin();
      await fireEvent.press(ui.getByTestId('apple-button'));
      expect(await ui.findByText(/quote reference [A-Z0-9]{8}/)).toBeTruthy();
      expectReportedOnce(null, undefined, 'ERR_REQUEST_FAILED');
    });

    it('Apple: a client signup 500 on CreateAccount shows the backend reference and reports once', async () => {
      mockApplePost.mockRejectedValue(httpError(500, 'Internal server error'));
      const ui = await renderSignup('client');
      await fireEvent.press(await ui.findByTestId('apple-button'));
      expect(await ui.findByText(/Sign in with Apple didn’t go through.*reference FEEDFACE/)).toBeTruthy();
      expectReportedOnce(500, REF);
    });
  });

  describe('Sol C-306-5: a marker with no identity is never bound to another person', () => {
    it('Login: a different Apple ID signs in with no recovery notice, and the marker is not consumed', async () => {
      await rememberUnconfirmedCoachSignup('apple');
      mockApplePost.mockResolvedValue({
        data: { access_token: 'a', user: { id: 'u-B', email: 'person-b@example.com', role: 'student' }, is_new_user: false },
      });
      const ui = await renderLogin();
      await fireEvent.press(ui.getByTestId('apple-button'));
      await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
      expect(ui.queryByTestId('login-coach-retry-notice')).toBeNull();
      expect(await hasAnyUnconfirmedCoachSignup()).toBe(true);
    });

    it('CreateAccount: a coach refusal still keeps the unresolved step for the device (caution), and consumes nothing', async () => {
      await rememberUnconfirmedCoachSignup('apple');
      mockApplePost.mockRejectedValue({ response: { status: 400, data: { message: ['property intended_role should not exist'] } } });
      const ui = await renderSignup('coach');
      await fireEvent.press(await ui.findByTestId('apple-button'));
      expect(await ui.findByTestId('coach-choice-withdrawn-notice')).toBeTruthy();
      expect(ui.queryByText(/No account was created/)).toBeNull();
      expect(await hasAnyUnconfirmedCoachSignup()).toBe(true);
    });
  });
});
