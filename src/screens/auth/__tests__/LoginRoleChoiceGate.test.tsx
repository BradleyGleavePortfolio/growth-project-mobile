/**
 * C13 (#306 audit F3): while the signup policy offers a role choice at
 * account creation, the Login screen's Sign in with Apple / Google must not
 * create an account before the role question. The backend fixes the role
 * when it inserts the User row on the first provider call, so this screen
 * asks "Already have an account?" first and sends new people to
 * CreateAccount (role step first). Without role_choice nothing changes.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    login: jest.fn(),
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

const ROLE_CHOICE_POLICY = {
  invite_code_required: false,
  providers: ['email', 'google', 'apple'],
  role_choice: true,
  role_choice_field: 'intended_role',
  role_choice_values: ['client', 'coach'],
};
const LEGACY_POLICY = { invite_code_required: false, providers: ['email', 'google', 'apple'] };

async function renderLogin() {
  const nav = { navigate: jest.fn(), replace: jest.fn() };
  const utils = await render(<LoginScreen navigation={nav as never} route={{ key: 'l', name: 'Login' } as never} />);
  await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
  // let the policy promise settle into state
  await new Promise((r) => setTimeout(r, 10));
  return { nav, ...utils };
}

describe('Login provider sign-in vs signup role choice (C13 F3)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
    await AsyncStorage.clear();
  });

  it('without role_choice (production today): Apple signs in immediately, as before', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: LEGACY_POLICY });
    mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'u1' } });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByTestId('apple-button'));
    await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
    expect(utils.queryByTestId('existing-account-confirm')).toBeNull();
    await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
    expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
  });

  it('with role_choice: tapping Apple asks first and does NOT call the provider', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByTestId('apple-button'));
    expect(await utils.findByTestId('existing-account-confirm')).toBeTruthy();
    expect(utils.getByText(/Sign in with Apple creates a new account the first time/)).toBeTruthy();
    expect(mockSignInWithApple).not.toHaveBeenCalled();
  });

  it('with role_choice: "I am new" goes to CreateAccount (role step first), no provider call', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByTestId('apple-button'));
    await fireEvent.press(await utils.findByTestId('existing-account-create'));
    expect(utils.nav.navigate).toHaveBeenCalledWith('CreateAccount');
    expect(mockSignInWithApple).not.toHaveBeenCalled();
    expect(utils.queryByTestId('existing-account-confirm')).toBeNull();
  });

  it('with role_choice: "Yes, sign me in" runs the provider; a returning coach lands in the app', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
    mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: false, user: { id: 'c1', role: 'coach' } });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByTestId('apple-button'));
    await fireEvent.press(await utils.findByTestId('existing-account-continue'));
    await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
    expect(mockSignInWithApple).toHaveBeenCalledWith();
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(utils.nav.replace).not.toHaveBeenCalled();
  });

  it('with role_choice: the provider still created a new account: say so, persisted, never silent', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
    mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'u1', role: 'student' } });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByTestId('apple-button'));
    await fireEvent.press(await utils.findByTestId('existing-account-continue'));
    await waitFor(() =>
      expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'new_account_from_sign_in' }),
    );
    expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('new_account_from_sign_in');
    expect(await AsyncStorage.getItem('needs_role_selection')).toBe('true');
  });

  it('with role_choice: Google gets the same question', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
    mockSignInWithGoogle.mockResolvedValue({ success: true, is_new_user: false, user: { id: 'u1', role: 'student' } });
    const utils = await renderLogin();
    await fireEvent.press(await utils.findByLabelText('Continue with Google'));
    expect(await utils.findByTestId('existing-account-confirm')).toBeTruthy();
    expect(utils.getByText(/Continue with Google creates a new account the first time/)).toBeTruthy();
    expect(mockSignInWithGoogle).not.toHaveBeenCalled();
    await fireEvent.press(utils.getByTestId('existing-account-continue'));
    await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
  });

  it('policy GET failed, nothing cached: degrades to today\'s behaviour (no question, provider runs)', async () => {
    mockGetSignupPolicy.mockRejectedValue(new Error('network'));
    mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: false, user: { id: 'u1', role: 'student', coach_id: 'c' } });
    const utils = await renderLogin();
    await fireEvent.press(utils.getByTestId('apple-button'));
    await waitFor(() => expect(mockSignInWithApple).toHaveBeenCalledTimes(1));
    expect(utils.queryByTestId('existing-account-confirm')).toBeNull();
  });

  it('policy still loading: asks first rather than risk creating an account without the role question', async () => {
    mockGetSignupPolicy.mockReturnValue(new Promise(() => undefined));
    const nav = { navigate: jest.fn(), replace: jest.fn() };
    const utils = await render(<LoginScreen navigation={nav as never} route={{ key: 'l', name: 'Login' } as never} />);
    await fireEvent.press(utils.getByTestId('apple-button'));
    expect(await utils.findByTestId('existing-account-confirm')).toBeTruthy();
    expect(mockSignInWithApple).not.toHaveBeenCalled();
  });

  // #306 fix round 2 (Opus C3 / Sol C2): the confirm panel treats an unknown
  // policy as "ask", so the new-account notice must use the same predicate.
  it('Opus C3: policy still loading + provider created a new account: the notice is shown, not skipped', async () => {
    mockGetSignupPolicy.mockReturnValue(new Promise(() => undefined));
    mockSignInWithApple.mockResolvedValue({ success: true, is_new_user: true, user: { id: 'u1', role: 'student' } });
    const nav = { navigate: jest.fn(), replace: jest.fn() };
    const utils = await render(<LoginScreen navigation={nav as never} route={{ key: 'l', name: 'Login' } as never} />);
    await fireEvent.press(utils.getByTestId('apple-button'));
    await fireEvent.press(await utils.findByTestId('existing-account-continue'));
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'new_account_from_sign_in' }),
    );
    expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('new_account_from_sign_in');
  });

  it('Google: a server-confirmed new account is still told (guard for the B1 rule below)', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
    mockSignInWithGoogle.mockResolvedValue({
      success: true, is_new_user: true, server_confirmed: true, user: { id: 'u1', role: 'student' },
    });
    const utils = await renderLogin();
    await fireEvent.press(await utils.findByLabelText('Continue with Google'));
    await fireEvent.press(await utils.findByTestId('existing-account-continue'));
    await waitFor(() =>
      expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection', { signupNotice: 'new_account_from_sign_in' }),
    );
  });

  it('B1 (Login): the Google legacy fallback (server_confirmed:false) is never told "a new client account was created"', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: ROLE_CHOICE_POLICY });
    mockSignInWithGoogle.mockResolvedValue({
      success: true, is_new_user: true, server_confirmed: false, user: { id: 'supa-1', email: 'a@b.c', name: 'A' },
    });
    const utils = await renderLogin();
    await fireEvent.press(await utils.findByLabelText('Continue with Google'));
    await fireEvent.press(await utils.findByTestId('existing-account-continue'));
    await waitFor(() => expect(utils.nav.replace).toHaveBeenCalledWith('RoleSelection'));
    expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBeNull();
  });
});
