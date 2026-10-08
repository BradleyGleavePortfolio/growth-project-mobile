/**
 * Audit #303 B3: Login offers Google only when the shared signup policy
 * advertises it (hidden while unknown or disabled), same as CreateAccount.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    login: jest.fn(),
  },
}));
jest.mock('../../../utils/appleAuth', () => ({ signInWithApple: jest.fn() }));
jest.mock('../../../utils/googleAuth', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('../../../components/AppleSignInButton', () => ({ __esModule: true, default: () => null }));
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

import LoginScreen from '../LoginScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

async function renderLogin() {
  const nav = { navigate: jest.fn(), replace: jest.fn() };
  const utils = await render(<LoginScreen navigation={nav as never} route={{ key: 'l', name: 'Login' } as never} />);
  await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
  return { ...utils, nav };
}

describe('Login Google gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
  });

  it('retains forgot-password, account creation and email-submit actions', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { providers: ['email'] } });
    const view = await renderLogin();
    await fireEvent.press(view.getByLabelText('Forgot password'));
    expect(view.nav.navigate).toHaveBeenCalledWith('ForgotPassword');
    await fireEvent.press(view.getByLabelText('Sign up'));
    expect(view.nav.navigate).toHaveBeenCalledWith('CreateAccount');
    await fireEvent.press(view.getByLabelText('Sign in'));
    expect(view.getByText('Please enter email and password')).toBeTruthy();
    expect(view.getByLabelText('Email')).toHaveStyle({ fontFamily: 'Inter_400Regular', borderWidth: undefined });
    expect(view.getByText('Sign in.')).toBeTruthy();
  });

  it('live providers email+apple: no Google', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'apple'] } });
    const { queryByLabelText } = await renderLogin();
    await new Promise((r) => setTimeout(r, 10));
    expect(queryByLabelText('Continue with Google')).toBeNull();
  });

  it('policy request rejected: no Google', async () => {
    mockGetSignupPolicy.mockRejectedValue(new Error('network'));
    const { queryByLabelText } = await renderLogin();
    await new Promise((r) => setTimeout(r, 10));
    expect(queryByLabelText('Continue with Google')).toBeNull();
  });

  it('explicit google in providers: Google shown', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'google'] } });
    const { findByLabelText } = await renderLogin();
    expect(await findByLabelText('Continue with Google')).toBeTruthy();
  });
});
