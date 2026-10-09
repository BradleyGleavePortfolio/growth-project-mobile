/**
 * SHOTS-134B 5 (CLIENT-POLISH-134 c, B16 B29): sign-in inputs are a bottom
 * hairline only, so they carry no corner radius (a radius curled the hairline
 * up at both ends), and "Continue with Google" on Sign in is in sentence case
 * like Create account (it was uppercase and letter-spaced).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    login: jest.fn(),
    forgotPassword: jest.fn(),
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
import ForgotPasswordScreen from '../ForgotPasswordScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

type Node = { props: { style?: unknown } };
const flat = (node: Node) => StyleSheet.flatten(node.props.style as never) ?? {};

function expectUnderline(node: Node) {
  const style = flat(node) as Record<string, unknown>;
  expect(style.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
  expect(style.borderWidth).toBeUndefined();
  for (const key of ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
    expect(style[key] ?? 0).toBe(0);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetSignupPolicyCacheForTests();
  mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'google'] } });
});

it('Sign in: email and password are underline inputs with no corner radius', async () => {
  const view = await render(<LoginScreen navigation={{ navigate: jest.fn(), replace: jest.fn() } as never} route={{ key: 'l', name: 'Login' } as never} />);
  expectUnderline(view.getByLabelText('Email') as unknown as Node);
  expectUnderline(view.getByLabelText('Password') as unknown as Node);
});

it('Sign in: Continue with Google reads in sentence case, as Google writes it', async () => {
  const view = await render(<LoginScreen navigation={{ navigate: jest.fn(), replace: jest.fn() } as never} route={{ key: 'l', name: 'Login' } as never} />);
  await waitFor(() => expect(view.getByLabelText('Continue with Google')).toBeTruthy());
  const label = view.getByText('Continue with Google');
  const style = flat(label as unknown as Node) as Record<string, unknown>;
  expect(style.textTransform ?? 'none').toBe('none');
  expect(style.letterSpacing ?? 0).toBeLessThan(1);
});

it('Forgot password: the email field is an underline input with no corner radius', async () => {
  const view = await render(<ForgotPasswordScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />);
  expectUnderline(view.getByLabelText('Email') as unknown as Node);
});
