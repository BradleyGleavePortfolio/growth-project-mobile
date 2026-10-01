/**
 * #306 fix round 5 (Sol B-306-2 / Opus B-306-1): the recovery notice and the
 * role-selection gate are owned by one account (lib/roleSelectionGate).
 *
 *  - An interrupted notice (shown, never acknowledged, screen unmounted) is
 *    shown again on that account's next sign-in, even after the attempt
 *    marker expired, and Continue then clears the gate so RootNavigator's
 *    bootstrap reaches the app (no strand on the auth stack).
 *  - Another account signing in on the device never inherits it.
 *  - A genuinely unfinished signup (gate owned by this account) goes to
 *    RoleSelection instead of a bare emit.
 *  - Login failures say what happened; unknown ones carry a reference and
 *    Contact support (owner rule 13:34).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
const mockLogin = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    login: (...a: unknown[]) => mockLogin(...a),
  },
}));
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
  secureStorage: { setItem: jest.fn(() => Promise.resolve()), getItem: jest.fn(() => Promise.resolve(null)) },
}));
jest.mock('../../../lib/userCache', () => ({ setUserCache: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../services/queryClient', () => ({
  purgePersistedQueryCacheForAllUsers: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn(), identify: jest.fn() }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
const mockEmit = jest.fn();
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: () => mockEmit() } }));
const mockCaptureError = jest.fn();
jest.mock('../../../services/sentry', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));

import LoginScreen from '../LoginScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';
import { SIGNUP_ROLE_NOTICE_KEY } from '../../../lib/signupRoleNotice';
import {
  COACH_SIGNUP_UNCONFIRMED_KEY,
  rememberUnconfirmedCoachSignup,
} from '../../../lib/coachSignupAttempt';
import {
  COACH_RECOVERY_GATE_KEY,
  NEEDS_ROLE_SELECTION_KEY,
  ROLE_SELECTION_OWNER_KEY,
  markRoleSelectionPending,
  readCoachRecoveryGate,
} from '../../../lib/roleSelectionGate';

// Coach sign-up was withdrawn (D4 fallback), so the Login provider buttons
// sign in directly, as in production today.
const POLICY_OFF = {
  invite_code_required: false,
  providers: ['email', 'google', 'apple'],
  role_choice: false,
  role_choice_field: 'intended_role',
  role_choice_values: ['client', 'coach'],
};

async function renderLogin(email?: string) {
  const nav = { navigate: jest.fn(), replace: jest.fn() };
  const utils = await render(
    <LoginScreen navigation={nav as never} route={{ key: 'l', name: 'Login', params: email ? { email } : undefined } as never} />,
  );
  await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 10));
  return { nav, ...utils };
}

async function signInWithEmail(utils: Awaited<ReturnType<typeof renderLogin>>, password = 'Str0ng!pass') {
  await fireEvent.changeText(utils.getByLabelText('Password'), password);
  await fireEvent.press(utils.getByLabelText('Sign in'));
}

const PAT = { id: 'u1', email: 'pat@example.com', role: 'student' };

function loginAs(user: Record<string, unknown>) {
  mockLogin.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r', user } });
}

describe('#306 fix round 5: owner-scoped role-selection gate on Login', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
    mockGetSignupPolicy.mockResolvedValue({ data: POLICY_OFF });
  });

  it('email: notice shown -> screen unmounted -> next sign-in shows it again -> Continue clears the gate and enters the app', async () => {
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
    loginAs(PAT);
    const first = await renderLogin('pat@example.com');
    await signInWithEmail(first);
    expect(await first.findByTestId('login-coach-retry-notice')).toBeTruthy();
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBe('true');
    expect(await AsyncStorage.getItem(ROLE_SELECTION_OWNER_KEY)).toBe('u1');
    expect(await readCoachRecoveryGate()).toMatchObject({ userId: 'u1', method: 'email', priorPending: false });
    // Back gesture / app closed: the screen goes away without Continue.
    await first.unmount();

    const second = await renderLogin('pat@example.com');
    await signInWithEmail(second);
    expect(await second.findByTestId('login-coach-retry-notice')).toBeTruthy();
    expect(mockEmit).not.toHaveBeenCalled();
    await fireEvent.press(second.getByTestId('login-coach-retry-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    // What RootNavigator.bootstrapAuth reads: the gate is clear, so the app opens.
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(ROLE_SELECTION_OWNER_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(COACH_RECOVERY_GATE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
    expect(second.nav.replace).not.toHaveBeenCalled();
  });

  it('the attempt marker expired before the second sign-in: the unacknowledged notice is still shown, then released', async () => {
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
    loginAs(PAT);
    const first = await renderLogin('pat@example.com');
    await signInWithEmail(first);
    expect(await first.findByTestId('login-coach-retry-notice')).toBeTruthy();
    await first.unmount();
    await AsyncStorage.removeItem(COACH_SIGNUP_UNCONFIRMED_KEY);

    const second = await renderLogin('pat@example.com');
    await signInWithEmail(second);
    expect(await second.findByTestId('login-coach-retry-notice')).toBeTruthy();
    await fireEvent.press(second.getByTestId('login-coach-retry-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();
  });

  it('Apple replay: interrupted, then the same Apple account signs in again: notice, Continue, app', async () => {
    await rememberUnconfirmedCoachSignup('apple', { subject: 'apple-sub-1' });
    const apple = {
      success: true,
      provider_subject: 'apple-sub-1',
      is_new_user: false,
      user: { id: 'u1', email: 'x@privaterelay.appleid.com', role: 'student' },
    };
    mockSignInWithApple.mockResolvedValue(apple);
    const first = await renderLogin();
    await fireEvent.press(first.getByTestId('apple-button'));
    expect(await first.findByTestId('login-coach-retry-notice')).toBeTruthy();
    await first.unmount();

    const second = await renderLogin();
    await fireEvent.press(second.getByTestId('apple-button'));
    expect(await second.findByTestId('login-coach-retry-notice')).toBeTruthy();
    await fireEvent.press(second.getByTestId('login-coach-retry-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();
    expect(second.nav.replace).not.toHaveBeenCalled();
  });

  it('Google replay: interrupted, then the same Google account signs in again: notice, Continue, app', async () => {
    await rememberUnconfirmedCoachSignup('google', 'pat@gmail.com');
    mockSignInWithGoogle.mockResolvedValue({
      success: true,
      server_confirmed: true,
      is_new_user: false,
      user: { id: 'u1', email: 'pat@gmail.com', role: 'student' },
    });
    const first = await renderLogin();
    await fireEvent.press(first.getByText('Continue with Google'));
    expect(await first.findByTestId('login-coach-retry-notice')).toBeTruthy();
    await first.unmount();

    const second = await renderLogin();
    await fireEvent.press(second.getByText('Continue with Google'));
    expect(await second.findByTestId('login-coach-retry-notice')).toBeTruthy();
    await fireEvent.press(second.getByTestId('login-coach-retry-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();
  });

  it('a different account signing in after the interruption does not inherit the notice or the gate', async () => {
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
    loginAs(PAT);
    const first = await renderLogin('pat@example.com');
    await signInWithEmail(first);
    expect(await first.findByTestId('login-coach-retry-notice')).toBeTruthy();
    await first.unmount();

    loginAs({ id: 'u2', email: 'sam@example.com', role: 'student', coach_id: 'coach-1' });
    const other = await renderLogin('sam@example.com');
    await signInWithEmail(other);
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(other.queryByTestId('login-coach-retry-notice')).toBeNull();
    expect(other.nav.replace).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();
    // Pat's own unacknowledged notice is kept for Pat.
    expect(await readCoachRecoveryGate()).toMatchObject({ userId: 'u1' });
  });

  it('a genuinely unfinished signup (gate owned by this account) goes to RoleSelection, not a bare emit', async () => {
    await markRoleSelectionPending('u1');
    loginAs(PAT);
    const utils = await renderLogin('pat@example.com');
    await signInWithEmail(utils);
    await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
    expect(mockEmit).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBe('true');
  });

  it('an owner-less flag from an older build counts as unfinished: RoleSelection', async () => {
    await AsyncStorage.setItem(NEEDS_ROLE_SELECTION_KEY, 'true');
    loginAs(PAT);
    const utils = await renderLogin('pat@example.com');
    await signInWithEmail(utils);
    await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
  });

  it('unfinished signup AND a recovery notice: Continue keeps the requirement and opens RoleSelection', async () => {
    await markRoleSelectionPending('u1');
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
    loginAs(PAT);
    const utils = await renderLogin('pat@example.com');
    await signInWithEmail(utils);
    expect(await utils.findByTestId('login-coach-retry-notice')).toBeTruthy();
    expect(await readCoachRecoveryGate()).toMatchObject({ priorPending: true });
    await fireEvent.press(utils.getByTestId('login-coach-retry-continue'));
    await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
    expect(mockEmit).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBe('true');
    expect(await AsyncStorage.getItem(COACH_RECOVERY_GATE_KEY)).toBeNull();
  });

  it('a server coach with a stale gate on the device: the gate is cleared and the app opens', async () => {
    await markRoleSelectionPending('c1');
    loginAs({ id: 'c1', email: 'coach@example.com', role: 'coach' });
    const utils = await renderLogin('coach@example.com');
    await signInWithEmail(utils);
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(utils.nav.replace).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(NEEDS_ROLE_SELECTION_KEY)).toBeNull();
  });

  it('wrong password (401) says so and offers a next step, never the generic line', async () => {
    mockLogin.mockRejectedValue({ response: { status: 401, data: { message: 'Invalid credentials' } } });
    const utils = await renderLogin('pat@example.com');
    await signInWithEmail(utils);
    expect(await utils.findByText(/That email and password don.t match/)).toBeTruthy();
    expect(utils.queryByText(/Sign-in didn.t complete/)).toBeNull();
    expect(utils.queryByTestId('login-error-support')).toBeNull();
  });

  it('an unknown server failure shows a reference from the response and a working Contact support link', async () => {
    mockLogin.mockRejectedValue({
      response: { status: 500, data: { message: 'boom', request_id: 'abcd1234-0000-4000-8000-000000000000' }, headers: {} },
    });
    const utils = await renderLogin('pat@example.com');
    await signInWithEmail(utils);
    expect(await utils.findByText(/reference ABCD1234/)).toBeTruthy();
    expect(utils.queryByText(/^Please try again\.?$/)).toBeNull();
    await fireEvent.press(utils.getByTestId('login-error-support'));
    expect(utils.nav.navigate).toHaveBeenCalledWith('SupportInbox');
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [captured, context] = mockCaptureError.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(JSON.stringify(context)).not.toMatch(/Str0ng!pass/);
    expect(context).toMatchObject({ status: 500, reference: 'abcd1234-0000-4000-8000-000000000000' });
  });
});
