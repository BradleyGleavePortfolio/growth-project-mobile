/**
 * CreateAccountScreen, #306 fix round 5.
 *
 *  - Sol B-306-1: a refusal after an unresolved coach attempt (same method,
 *    same mount or after a remount, email / Apple / Google) keeps the
 *    "may or may not have been created" state; it never says "No account
 *    was created".
 *  - Opus C-306-1: an invite / QR signup never shows or consumes a provider
 *    coach-attempt marker.
 *  - Opus C-306-2: a signup with no notice clears one left on the device.
 *  - Opus C-306-3: `signup_pending` is never "already exists"; an unconfirmed
 *    Apple coach signup drops any session it stored.
 *  - Owner 13:28 / 13:34: open signup copy; known signup failures mapped
 *    (409 exists with Log in / Reset password, signup_pending with Reset
 *    password / Back, password rule text, invalid code); unknown failures
 *    show a reference and Contact support and are reported without the
 *    request body.
 */
import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
const mockSignupWithCode = jest.fn();
const mockValidate = jest.fn();
const mockPreview = jest.fn();
const mockLogin = jest.fn();
const mockRegister = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    signupWithCode: (...a: unknown[]) => mockSignupWithCode(...a),
    validateInviteCode: (...a: unknown[]) => mockValidate(...a),
    getInvitePreview: (...a: unknown[]) => mockPreview(...a),
    login: (...a: unknown[]) => mockLogin(...a),
    register: (...a: unknown[]) => mockRegister(...a),
  },
}));

const mockGetString = jest.fn();
jest.mock('expo-clipboard', () => ({ getStringAsync: () => mockGetString() }));

const mockSignInWithApple = jest.fn();
jest.mock('../../../utils/appleAuth', () => ({
  signInWithApple: (...a: unknown[]) => mockSignInWithApple(...a),
}));
const mockSignInWithGoogle = jest.fn();
jest.mock('../../../utils/googleAuth', () => ({
  signInWithGoogle: (...a: unknown[]) => mockSignInWithGoogle(...a),
}));

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
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));

const mockEmit = jest.fn();
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: () => mockEmit() } }));
const mockCaptureError = jest.fn();
jest.mock('../../../services/sentry', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));

import CreateAccountScreen from '../CreateAccountScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';
import { secureStorage } from '../../../services/secureStorage';
import { CoachSignupUnavailableError } from '../../../lib/intendedRole';
import { SIGNUP_ROLE_NOTICE_KEY } from '../../../lib/signupRoleNotice';
import {
  hasAnyUnconfirmedCoachSignup,
  rememberUnconfirmedCoachSignup,
} from '../../../lib/coachSignupAttempt';
import { NEEDS_ROLE_SELECTION_KEY, ROLE_SELECTION_OWNER_KEY } from '../../../lib/roleSelectionGate';

function makeNav() {
  return { replace: jest.fn(), navigate: jest.fn() };
}

// Live policy WITH the C13 role choice (backend #597).
const ROLE_CHOICE_POLICY = {
  invite_code_required: false,
  providers: ['email', 'apple'],
  role_choice: true,
  role_choice_field: 'intended_role',
  role_choice_values: ['client', 'coach'],
};

async function renderScreen(params?: { invite_code?: string }, role: 'client' | 'coach' | null = 'client') {
  const nav = makeNav();
  const utils = await render(
    <CreateAccountScreen navigation={nav as never} route={params ? { params } : undefined} />,
  );
  await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
  // The form (or the role step) is held back until the policy answers.
  await waitFor(() => expect(utils.queryByTestId('signup-policy-loading')).toBeNull());
  // C13: without an invite code, and only when the live policy advertises
  // role_choice, the first step is the role choice.
  if (!params?.invite_code && role && utils.queryByTestId('role-choice')) {
    // Prototype ROLE (01): a row tap selects, Continue commits.
    await fireEvent.press(utils.getByTestId(`role-choice-${role}`));
    await fireEvent.press(utils.getByTestId('role-choice-continue'));
  }
  return { nav, ...utils };
}

const PROVIDERS = ['email', 'apple', 'google'];
const COACH_POLICY = { ...ROLE_CHOICE_POLICY, providers: PROVIDERS };
const NO_ACCOUNT = /No account was created/;
const MAYBE_CREATED = /An account may or may not have been created/;
const UNCONFIRMED = /Your coach account could not be confirmed/;

async function fillAndSubmit(utils: Awaited<ReturnType<typeof renderScreen>>, email = 'pat@example.com') {
  await fireEvent.changeText(utils.getByLabelText('Full name'), 'Pat Example');
  await fireEvent.changeText(utils.getByLabelText('Email'), email);
  await fireEvent.changeText(utils.getByLabelText('Password'), 'Str0ng!pass');
  await fireEvent.press(utils.getByLabelText('Create account'));
}

function expectStillUnresolved(utils: Awaited<ReturnType<typeof renderScreen>>) {
  expect(utils.getByTestId('coach-choice-withdrawn-unconfirmed')).toBeTruthy();
  expect(utils.getByText(MAYBE_CREATED)).toBeTruthy();
  expect(utils.queryByText(NO_ACCOUNT)).toBeNull();
  expect(utils.queryByTestId('coach-choice-withdrawn-client')).toBeNull();
  expect(utils.getByTestId('coach-choice-withdrawn-sign-in')).toBeTruthy();
}

function httpError(status: number, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data, headers: {} },
    ...extra,
  });
}

describe('CreateAccountScreen, #306 fix round 5', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
    mockPreview.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley' } });
    mockValidate.mockResolvedValue({ data: { valid: true, coach_name: 'Bradley' } });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  describe('Sol B-306-1: a refusal after an unresolved attempt is never "No account was created"', () => {
    beforeEach(() => {
      mockGetSignupPolicy.mockResolvedValue({ data: COACH_POLICY });
    });

    it('email, same mount: lost request, then the retry is refused', async () => {
      const utils = await renderScreen(undefined, 'coach');
      mockRegister.mockRejectedValueOnce(new Error('Cannot reach server. Please check your connection and try again.'));
      await fillAndSubmit(utils);
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      mockRegister.mockRejectedValueOnce(new CoachSignupUnavailableError());
      await fireEvent.press(utils.getByLabelText('Create account'));
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectStillUnresolved(utils);
    });

    it('email, after a remount: the stored attempt still decides the copy', async () => {
      await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
      const utils = await renderScreen(undefined, 'coach');
      mockRegister.mockRejectedValueOnce(new CoachSignupUnavailableError());
      await fillAndSubmit(utils, 'Pat@Example.com');
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectStillUnresolved(utils);
    });

    it('Apple, same mount: unconfirmed, then refused', async () => {
      const utils = await renderScreen(undefined, 'coach');
      mockSignInWithApple.mockResolvedValueOnce({
        success: false, error: 'x', error_code: 'coach_signup_unconfirmed', provider_email: 'pat@icloud.com',
      });
      await fireEvent.press(utils.getByTestId('apple-button'));
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      mockSignInWithApple.mockResolvedValueOnce({
        success: false, error: 'x', error_code: 'coach_signup_unavailable', provider_email: 'pat@icloud.com',
      });
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectStillUnresolved(utils);
    });

    it('Apple, after a remount (marker without an email): refused retry keeps the unresolved state', async () => {
      await rememberUnconfirmedCoachSignup('apple');
      const utils = await renderScreen(undefined, 'coach');
      mockSignInWithApple.mockResolvedValueOnce({ success: false, error: 'x', error_code: 'coach_signup_unavailable' });
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectStillUnresolved(utils);
    });

    it('Apple: a refusal thrown (not returned) after an unresolved attempt', async () => {
      await rememberUnconfirmedCoachSignup('apple', 'pat@icloud.com');
      const utils = await renderScreen(undefined, 'coach');
      mockSignInWithApple.mockRejectedValueOnce(new CoachSignupUnavailableError());
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectStillUnresolved(utils);
    });

    it('Google, same mount: unconfirmed, then refused', async () => {
      const utils = await renderScreen(undefined, 'coach');
      mockSignInWithGoogle.mockResolvedValueOnce({
        success: false, error: 'x', error_code: 'coach_signup_unconfirmed', provider_email: 'pat@gmail.com',
      });
      await fireEvent.press(utils.getByText('Continue with Google'));
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      mockSignInWithGoogle.mockResolvedValueOnce({
        success: false, error: 'x', error_code: 'coach_signup_unavailable', provider_email: 'pat@gmail.com',
      });
      await fireEvent.press(utils.getByText('Continue with Google'));
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectStillUnresolved(utils);
    });

    it('Google, after a remount: refused retry keeps the unresolved state', async () => {
      await rememberUnconfirmedCoachSignup('google', 'pat@gmail.com');
      const utils = await renderScreen(undefined, 'coach');
      mockSignInWithGoogle.mockResolvedValueOnce({
        success: false, error: 'x', error_code: 'coach_signup_unavailable', provider_email: 'Pat@gmail.com',
      });
      await fireEvent.press(utils.getByText('Continue with Google'));
      await waitFor(() => expect(utils.getByTestId('coach-choice-withdrawn-notice')).toBeTruthy());
      expectStillUnresolved(utils);
    });

    it('no earlier attempt: a refusal still says plainly that no account was created', async () => {
      const utils = await renderScreen(undefined, 'coach');
      mockRegister.mockRejectedValueOnce(new CoachSignupUnavailableError());
      await fillAndSubmit(utils);
      expect(await utils.findByText(NO_ACCOUNT)).toBeTruthy();
      expect(utils.queryByTestId('coach-choice-withdrawn-unconfirmed')).toBeNull();
    });

    it('a refusal for a different email than the unresolved attempt is a plain refusal', async () => {
      await rememberUnconfirmedCoachSignup('email', 'someone@example.com');
      const utils = await renderScreen(undefined, 'coach');
      mockRegister.mockRejectedValueOnce(new CoachSignupUnavailableError());
      await fillAndSubmit(utils);
      expect(await utils.findByText(NO_ACCOUNT)).toBeTruthy();
    });
  });

  describe('Opus C-306-1 / C-306-2 / C-306-3', () => {
    it('C-306-1: an invite (QR) Apple signup neither shows nor consumes a provider coach-attempt marker', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: COACH_POLICY });
      await rememberUnconfirmedCoachSignup('apple');
      mockSignInWithApple.mockResolvedValue({
        success: true,
        is_new_user: false,
        invite_attached: true,
        user: { id: 'u9', email: 'x@privaterelay.appleid.com', role: 'student', coach_id: 'coach-1' },
      });
      const utils = await renderScreen({ invite_code: 'GP-TEST1' });
      await fireEvent.press(utils.getByTestId('apple-button'));
      await waitFor(() => expect(utils.nav.replace).toHaveBeenCalled());
      const [, params] = utils.nav.replace.mock.calls[0];
      expect(params?.signupNotice).toBeUndefined();
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
      expect(await hasAnyUnconfirmedCoachSignup()).toBe(true);
    });

    it('C-306-2: a plain signup clears a notice left on the device by an earlier one', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
      await AsyncStorage.setItem(SIGNUP_ROLE_NOTICE_KEY, 'coach_retry_not_applied');
      mockSignupWithCode.mockResolvedValue({ data: { requires_verification: true, invite_attached: true } });
      mockLogin.mockResolvedValue({
        data: { access_token: 'a', refresh_token: 'r', user: { id: 'u1', email: 'pat@example.com', role: 'student', coach_id: 'c1' } },
      });
      const utils = await renderScreen({ invite_code: 'GP-TEST1' });
      await fillAndSubmit(utils);
      await fireEvent.press(await utils.findByText('I verified my email'));
      await waitFor(() => expect(utils.nav.replace).toHaveBeenCalled());
      expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
      // The gate records whose it is (Sol B-306-2).
      expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBe('true');
      expect(await AsyncStorage.getItem(ROLE_SELECTION_OWNER_KEY)).toBe('u1');
    });

    it('C-306-3 (i): signup_pending after an unresolved coach attempt is never "already exists"', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: COACH_POLICY });
      await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
      const utils = await renderScreen(undefined, 'coach');
      mockRegister.mockRejectedValueOnce(
        httpError(409, { code: 'signup_pending', message: 'Check your email to finish signing up, or reset your password.' }),
      );
      await fillAndSubmit(utils);
      expect(await utils.findByTestId('signup-issue-signup_pending')).toBeTruthy();
      expect(utils.queryByText(/already exists/)).toBeNull();
    });

    it('C-306-3 (ii): an unconfirmed Apple coach signup drops any session it stored', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: COACH_POLICY });
      const utils = await renderScreen(undefined, 'coach');
      mockSignInWithApple.mockResolvedValueOnce({ success: false, error: 'x', error_code: 'coach_signup_unconfirmed' });
      await fireEvent.press(utils.getByTestId('apple-button'));
      expect(await utils.findByText(UNCONFIRMED)).toBeTruthy();
      expect(secureStorage.removeItem).toHaveBeenCalledWith('supabase_token');
      expect(secureStorage.removeItem).toHaveBeenCalledWith('supabase_refresh_token');
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('owner 13:28 / 13:34: open signup and specific failure copy', () => {
    beforeEach(() => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
    });

    it('client title is neutral and the code is optional', async () => {
      const utils = await renderScreen();
      expect(utils.getByText('Create your account.')).toBeTruthy();
      expect(utils.getByText('INVITE CODE (OPTIONAL)')).toBeTruthy();
      expect(utils.queryByText('Join your coach')).toBeNull();
    });

    it('the coach path never asks for a code', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: COACH_POLICY });
      const utils = await renderScreen(undefined, 'coach');
      expect(utils.getByText('Create your coach account.')).toBeTruthy();
      expect(utils.queryByTestId('invite-code-input')).toBeNull();
    });

    it('flag off (no role_choice): clean client-only signup, no role UI, no intended_role', async () => {
      mockRegister.mockResolvedValue({ data: { requires_verification: true } });
      const utils = await renderScreen(undefined, null);
      expect(utils.queryByTestId('role-choice')).toBeNull();
      expect(utils.queryByTestId('role-choice-change')).toBeNull();
      expect(utils.queryByText(/coach account/i)).toBeNull();
      await fillAndSubmit(utils);
      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockRegister.mock.calls[0][1]).toBeUndefined();
      expect(mockRegister.mock.calls[0][0]).not.toHaveProperty('intended_role');
    });

    it('409 "Email already registered": says so, with Log in and Reset password that work', async () => {
      mockRegister.mockRejectedValueOnce(httpError(409, { statusCode: 409, message: 'Email already registered', error: 'Conflict' }));
      const utils = await renderScreen();
      await fillAndSubmit(utils);
      expect(await utils.findByTestId('signup-issue-email_exists')).toBeTruthy();
      expect(utils.getByText('An account with this email already exists.')).toBeTruthy();
      expect(utils.queryByText(/Sign-in didn.t complete/)).toBeNull();
      await fireEvent.press(utils.getByTestId('signup-issue-log-in'));
      expect(utils.nav.navigate).toHaveBeenCalledWith('Login', { email: 'pat@example.com' });
      await fireEvent.press(utils.getByTestId('signup-issue-reset-password'));
      expect(utils.nav.navigate).toHaveBeenCalledWith('ForgotPassword');
    });

    it('409 "already exists" after an unresolved coach attempt: Log in and Contact support', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: COACH_POLICY });
      await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
      mockRegister.mockRejectedValueOnce(httpError(409, { message: 'Email already registered' }));
      const utils = await renderScreen(undefined, 'coach');
      await fillAndSubmit(utils);
      expect(await utils.findByTestId('signup-issue-email_exists_after_coach')).toBeTruthy();
      expect(utils.getByText(/Your earlier coach sign-up may have created it/)).toBeTruthy();
      await fireEvent.press(utils.getByTestId('signup-issue-support'));
      expect(utils.nav.navigate).toHaveBeenCalledWith('SupportInbox');
    });

    it('409 signup_pending: the contract copy, Reset password and Back; no resend button (no endpoint)', async () => {
      mockRegister.mockRejectedValueOnce(
        httpError(409, { code: 'signup_pending', message: 'Check your email to finish signing up, or reset your password.' }),
      );
      const utils = await renderScreen();
      await fillAndSubmit(utils);
      expect(await utils.findByTestId('signup-issue-signup_pending')).toBeTruthy();
      expect(utils.getByText('Check your email to finish signing up, or reset your password.')).toBeTruthy();
      expect(utils.queryByText(/Resend/i)).toBeNull();
      expect(utils.queryByTestId('signup-issue-log-in')).toBeNull();
      await fireEvent.press(utils.getByTestId('signup-issue-reset-password'));
      expect(utils.nav.navigate).toHaveBeenCalledWith('ForgotPassword');
      await fireEvent.press(utils.getByTestId('signup-issue-back'));
      expect(utils.queryByTestId('signup-issue-signup_pending')).toBeNull();
      expect(utils.getByLabelText('Create account')).toBeTruthy();
    });

    it('400 password rule: shows the backend rule text', async () => {
      const rule = 'Password must be at least 8 characters with one uppercase letter, one number, and one special character.';
      mockRegister.mockRejectedValueOnce(httpError(400, { statusCode: 400, message: rule, error: 'Bad Request' }));
      const utils = await renderScreen();
      await fillAndSubmit(utils);
      expect(await utils.findByText(rule)).toBeTruthy();
      expect(utils.queryByTestId('signup-error-support')).toBeNull();
    });

    it('400 invalid invite code from signup-with-code: the invite copy', async () => {
      mockSignupWithCode.mockRejectedValueOnce(httpError(400, { message: 'Invalid or expired invite code' }));
      const utils = await renderScreen({ invite_code: 'GP-BAD01' });
      await fillAndSubmit(utils);
      expect(
        await utils.findByText('That invite code is not valid. Check it with your coach, or clear the field to sign up without one.'),
      ).toBeTruthy();
    });

    it('unknown 500: a reference from the response, Contact support, and a Sentry event without the request body', async () => {
      mockRegister.mockRejectedValueOnce(
        httpError(
          500,
          { message: 'Internal server error', request_id: 'feedface-0000-4000-8000-000000000000' },
          { config: { headers: { Authorization: 'Bearer secret-token' }, data: '{"password":"Str0ng!pass"}' } },
        ),
      );
      const utils = await renderScreen();
      await fillAndSubmit(utils);
      expect(await utils.findByText(/reference FEEDFACE/)).toBeTruthy();
      expect(utils.queryByText(/Sign-in didn.t complete/)).toBeNull();
      await fireEvent.press(utils.getByTestId('signup-error-support'));
      expect(utils.nav.navigate).toHaveBeenCalledWith('SupportInbox');
      expect(mockCaptureError).toHaveBeenCalledTimes(1);
      const [captured, context] = mockCaptureError.mock.calls[0];
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toBe('auth_sign_up_failed');
      const serialised = JSON.stringify(context);
      expect(serialised).not.toMatch(/Str0ng!pass|secret-token/);
      expect(context).toMatchObject({ flow: 'sign_up', status: 500 });
    });

    it('network failure: says the server could not be reached, no reference needed', async () => {
      mockRegister.mockRejectedValueOnce(new Error('Cannot reach server. Please check your connection and try again.'));
      const utils = await renderScreen();
      await fillAndSubmit(utils);
      expect(await utils.findByText(/server could not be reached/i)).toBeTruthy();
      expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('Google with a typed code the server did not attach (already has a coach): retry step with the code', async () => {
      mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'google'] } });
      mockSignInWithGoogle.mockResolvedValue({
        success: true,
        server_confirmed: true,
        is_new_user: false,
        invite_attached: false,
        invite_code: 'GP-TEST1',
        user: { id: 'u1', email: 'pat@gmail.com', role: 'student', coach_id: 'coach-A' },
      });
      const utils = await renderScreen();
      await fireEvent.changeText(utils.getByTestId('invite-code-input'), 'GP-TEST1');
      await fireEvent.press(await utils.findByText('Continue with Google'));
      await waitFor(() =>
        expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', {
          inviteAttachError: 'not_attached',
          inviteCode: 'GP-TEST1',
        }),
      );
    });
  });
});
