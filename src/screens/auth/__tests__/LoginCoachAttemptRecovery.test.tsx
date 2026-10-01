/**
 * #306 fix round 4 (Sol B2-R3): "Sign in to check" after an unconfirmed coach
 * signup lands here. The Login screen uses the same reconciliation as
 * CreateAccount (lib/coachSignupAttempt): when the sign-in recovers an
 * account for that attempt and the server says it is not a coach, the user
 * is told "coach sign-up was not applied" and must acknowledge it before the
 * client flow, including users who already have a coach. Unrelated sign-ins
 * are not affected.
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

import LoginScreen from '../LoginScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';
import { SIGNUP_ROLE_NOTICE_KEY } from '../../../lib/signupRoleNotice';
import {
  hasAnyUnconfirmedCoachSignup,
  rememberUnconfirmedCoachSignup,
} from '../../../lib/coachSignupAttempt';

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

describe('Login reconciles an unconfirmed coach signup (Sol B2-R3)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
    mockGetSignupPolicy.mockResolvedValue({ data: POLICY_OFF });
  });

  it('withdrawal -> Sign in to check (email) -> recovered client: notice first, client flow only after Continue', async () => {
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
    mockLogin.mockResolvedValue({
      data: { access_token: 'a', refresh_token: 'r', user: { id: 'u1', email: 'pat@example.com', role: 'student' } },
    });
    const utils = await renderLogin('Pat@Example.com');
    await signInWithEmail(utils);
    expect(await utils.findByTestId('login-coach-retry-notice')).toBeTruthy();
    expect(utils.getByText(/Coach sign-up was not applied to this account/)).toBeTruthy();
    expect(mockEmit).not.toHaveBeenCalled();
    // Durable while shown: a cold start cannot enter the client app first.
    expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('coach_retry_not_applied');
    expect(await AsyncStorage.getItem('needs_role_selection')).toBe('true');
    await fireEvent.press(utils.getByTestId('login-coach-retry-support'));
    expect(utils.nav.navigate).toHaveBeenCalledWith('SupportInbox');
    await fireEvent.press(utils.getByTestId('login-coach-retry-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem('needs_role_selection')).toBeNull();
    expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
    expect(await hasAnyUnconfirmedCoachSignup()).toBe(false);
  });

  it('Apple: a recovered client who already has a coach is still told before entering the app', async () => {
    await rememberUnconfirmedCoachSignup('apple');
    mockSignInWithApple.mockResolvedValue({
      success: true,
      is_new_user: false,
      user: { id: 'u1', email: 'x@privaterelay.appleid.com', role: 'student', coach_id: 'coach-1' },
    });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByTestId('apple-button'));
    expect(await utils.findByTestId('login-coach-retry-notice')).toBeTruthy();
    expect(mockEmit).not.toHaveBeenCalled();
    await fireEvent.press(utils.getByTestId('login-coach-retry-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(await hasAnyUnconfirmedCoachSignup()).toBe(false);
  });

  it('Google (server answer): recovered client is told before entering the app', async () => {
    await rememberUnconfirmedCoachSignup('google', 'pat@gmail.com');
    mockSignInWithGoogle.mockResolvedValue({
      success: true,
      server_confirmed: true,
      is_new_user: false,
      user: { id: 'u1', email: 'Pat@gmail.com', role: 'student' },
    });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByText('Continue with Google'));
    expect(await utils.findByTestId('login-coach-retry-notice')).toBeTruthy();
    expect(mockEmit).not.toHaveBeenCalled();
    await fireEvent.press(utils.getByTestId('login-coach-retry-continue'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
  });

  it('a recovered server coach: no notice, straight in, and the attempt is resolved', async () => {
    await rememberUnconfirmedCoachSignup('apple');
    mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: false, user: { id: 'c1', role: 'coach' } });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByTestId('apple-button'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(utils.queryByTestId('login-coach-retry-notice')).toBeNull();
    expect(await hasAnyUnconfirmedCoachSignup()).toBe(false);
  });

  it('unrelated identity (email): another address signs in normally and the marker is kept', async () => {
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com');
    mockLogin.mockResolvedValue({
      data: { access_token: 'a', user: { id: 'u2', email: 'other@example.com', role: 'student' } },
    });
    const utils = await renderLogin('other@example.com');
    await signInWithEmail(utils);
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(utils.queryByTestId('login-coach-retry-notice')).toBeNull();
    expect(await hasAnyUnconfirmedCoachSignup()).toBe(true);
  });

  it('unrelated identity (Google): another Google account signs in normally', async () => {
    await rememberUnconfirmedCoachSignup('google', 'pat@gmail.com');
    mockSignInWithGoogle.mockResolvedValue({
      success: true,
      server_confirmed: true,
      is_new_user: false,
      user: { id: 'u2', email: 'someone@gmail.com', role: 'student' },
    });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByText('Continue with Google'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(utils.queryByTestId('login-coach-retry-notice')).toBeNull();
  });

  it('another method (an unconfirmed Apple attempt, then email sign-in): no notice', async () => {
    await rememberUnconfirmedCoachSignup('apple');
    mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', email: 'pat@example.com', role: 'student' } } });
    const utils = await renderLogin('pat@example.com');
    await signInWithEmail(utils);
    await waitFor(() => expect(mockEmit).toHaveBeenCalledTimes(1));
    expect(utils.queryByTestId('login-coach-retry-notice')).toBeNull();
  });

  it('the Google legacy fallback (no server answer) neither shows nor resolves it', async () => {
    await rememberUnconfirmedCoachSignup('google');
    mockSignInWithGoogle.mockResolvedValue({
      success: true,
      server_confirmed: false,
      is_new_user: true,
      user: { id: 's1', email: 'pat@gmail.com', name: 'Pat' },
    });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByText('Continue with Google'));
    await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
    expect(utils.queryByTestId('login-coach-retry-notice')).toBeNull();
    expect(await hasAnyUnconfirmedCoachSignup()).toBe(true);
  });

  it('email sign-in trims surrounding spaces and keeps the typed case (legacy mixed-case rows)', async () => {
    mockLogin.mockResolvedValue({ data: { access_token: 'a', user: { id: 'u1', email: 'Pat@Example.com', role: 'student' } } });
    const utils = await renderLogin();
    await fireEvent.changeText(utils.getByLabelText('Email'), ' Pat@Example.com ');
    await signInWithEmail(utils);
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith({ email: 'Pat@Example.com', password: 'Str0ng!pass' }));
  });
});
