/**
 * Owner decision 28 (OD-M2-2): a first "Continue with Google" or "Sign in with Apple" from the sign-in screen
 * creates an account, so sign-in shows the sign-up agreement line and its two links under those buttons.
 */
import React from 'react';
import { Linking } from 'react-native';
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
jest.mock('../../../components/AppleSignInButton', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <Text testID="apple-button">Sign in with Apple</Text> };
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

import LoginScreen from '../LoginScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../../../config/env';

const flat = (node: unknown): string =>
  typeof node === 'string'
    ? node
    : Array.isArray(node)
      ? node.map(flat).join('')
      : node && typeof node === 'object' && 'props' in node
        ? flat((node as { props: { children?: unknown } }).props.children)
        : '';

describe('Login agreement line (D28)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSignupPolicyCacheForTests();
  });

  it('shows the sign-up agreement line under Google and Apple, with both links', async () => {
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'google', 'apple'] } });
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const view = await render(
      <LoginScreen navigation={{ navigate: jest.fn(), replace: jest.fn() } as never} route={{ key: 'l', name: 'Login' } as never} />,
    );
    await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
    await view.findByLabelText('Continue with Google');
    const line = view.getByTestId('login-legal');
    expect(flat(line.props.children)).toBe('By continuing, you agree to the Terms of Service and the Privacy Policy.');

    // Order on screen: Google, then Apple, then the agreement line.
    const json = JSON.stringify(view.toJSON());
    const google = json.indexOf('Continue with Google');
    const apple = json.indexOf('"apple-button"');
    expect(google).toBeGreaterThan(-1);
    expect(apple).toBeGreaterThan(google);
    expect(json.indexOf('"login-legal"')).toBeGreaterThan(apple);

    await fireEvent.press(view.getByTestId('login-terms-link'));
    expect(openUrl).toHaveBeenCalledWith(TERMS_URL);
    await fireEvent.press(view.getByTestId('login-privacy-link'));
    expect(openUrl).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
    openUrl.mockRestore();
  });
});
