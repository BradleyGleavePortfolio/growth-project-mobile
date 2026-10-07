/**
 * FW-ONB-128 B1: a new client whose confirmation email was lost or expired can
 * ask for a new link from the verify step (CreateAccountScreen.test), the
 * sign-in "not confirmed" error and the expired-link screen. The anonymous
 * response proves nothing about delivery, so the copy never promises it.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockResend = jest.fn();
const mockLogin = jest.fn();
const mockGetSignupPolicy = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    resendVerification: (...a: unknown[]) => mockResend(...a),
    login: (...a: unknown[]) => mockLogin(...a),
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
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

import ResendVerificationLink, { RESEND_COOLDOWN_MS, RESEND_COPY } from '../ResendVerificationLink';
import EmailVerifiedScreen from '../EmailVerifiedScreen';
import LoginScreen from '../LoginScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';

const httpError = (status: number, message = 'x') =>
  Object.assign(new Error(message), { response: { status, data: { message } } });

beforeEach(() => {
  jest.clearAllMocks();
  __resetSignupPolicyCacheForTests();
  mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email'] } });
});

describe('ResendVerificationLink states', () => {
  it('sent: neutral copy, then a 60 s pause before Send another link', async () => {
    jest.useFakeTimers();
    try {
      mockResend.mockResolvedValue({ data: { message: 'Verification request submitted.' } });
      const ui = await render(<ResendVerificationLink email="  pat@example.com " />);
      expect(ui.queryByTestId('resend-verification-email')).toBeNull();
      await fireEvent.press(ui.getByLabelText(RESEND_COPY.action));
      await waitFor(() => expect(mockResend).toHaveBeenCalledWith('pat@example.com'));
      expect(await ui.findByText(RESEND_COPY.sent)).toBeTruthy();
      expect(RESEND_COPY.sent).not.toMatch(/sent to|has been sent|delivered/i);
      expect(ui.queryByTestId('resend-verification-button')).toBeNull();
      await act(async () => { jest.advanceTimersByTime(RESEND_COOLDOWN_MS); });
      expect(ui.getByLabelText(RESEND_COPY.again)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    [httpError(429), RESEND_COPY.limited, true],
    [httpError(400), RESEND_COPY.invalid, false],
    [new Error('Network Error'), RESEND_COPY.offline, false],
    [httpError(500), RESEND_COPY.failed, true],
  ])('failure %# says what happened and keeps the action', async (err, copy, support) => {
    mockResend.mockRejectedValue(err);
    const onContactSupport = jest.fn();
    const ui = await render(<ResendVerificationLink email="pat@example.com" onContactSupport={onContactSupport} />);
    await fireEvent.press(ui.getByLabelText(RESEND_COPY.action));
    expect(await ui.findByText(copy)).toBeTruthy();
    expect(ui.getByLabelText(RESEND_COPY.action)).toBeTruthy();
    if (support) {
      await fireEvent.press(ui.getByTestId('resend-verification-support'));
      expect(onContactSupport).toHaveBeenCalled();
    } else {
      expect(ui.queryByTestId('resend-verification-support')).toBeNull();
    }
  });

  it('no known address: asks for one before calling the server', async () => {
    mockResend.mockResolvedValue({ data: {} });
    const ui = await render(<ResendVerificationLink />);
    await fireEvent.press(ui.getByLabelText(RESEND_COPY.action));
    expect(await ui.findByText(RESEND_COPY.missingEmail)).toBeTruthy();
    expect(mockResend).not.toHaveBeenCalled();
    await fireEvent.changeText(ui.getByLabelText('Email for a new link'), ' pat@example.com ');
    await fireEvent.press(ui.getByLabelText(RESEND_COPY.action));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith('pat@example.com'));
  });
});

describe('EmailVerified expired link', () => {
  const nav = () => ({ navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), getState: () => ({ index: 0, routes: [] }) });

  it('link_problem offers a new link plus Sign in and Contact support', async () => {
    mockResend.mockResolvedValue({ data: {} });
    const navigation = nav();
    const ui = await render(
      <EmailVerifiedScreen navigation={navigation as never} route={{ params: { status: 'link_problem' } } as never} />,
    );
    expect(ui.queryByText(/contact support for a new link/i)).toBeNull();
    await fireEvent.changeText(ui.getByLabelText('Email for a new link'), 'pat@example.com');
    await fireEvent.press(ui.getByLabelText(RESEND_COPY.action));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith('pat@example.com'));
    await fireEvent.press(ui.getByLabelText('Sign in'));
    expect(navigation.replace).toHaveBeenCalledWith('Login');
    await fireEvent.press(ui.getByLabelText('Contact support'));
    expect(navigation.navigate).toHaveBeenCalledWith('SupportInbox');
  });

  it('a confirmed link shows no resend', async () => {
    const ui = await render(<EmailVerifiedScreen navigation={nav() as never} route={{ params: {} } as never} />);
    expect(ui.queryByLabelText(RESEND_COPY.action)).toBeNull();
  });
});

describe('Login "not confirmed" error', () => {
  async function signIn(err: unknown) {
    mockLogin.mockRejectedValue(err);
    const nav = { navigate: jest.fn(), replace: jest.fn() };
    const ui = await render(<LoginScreen navigation={nav as never} route={{ key: 'l', name: 'Login' } as never} />);
    await fireEvent.changeText(ui.getByLabelText('Email'), 'pat@example.com');
    await fireEvent.changeText(ui.getByLabelText('Password'), 'Str0ng!pass');
    await fireEvent.press(ui.getByLabelText('Sign in'));
    await waitFor(() => expect(mockLogin).toHaveBeenCalled());
    return ui;
  }

  it('an unconfirmed email sign-in offers Send a new link for the typed address', async () => {
    mockResend.mockResolvedValue({ data: {} });
    const ui = await signIn(httpError(401, 'Email not confirmed'));
    expect(await ui.findByText(/not confirmed yet/)).toBeTruthy();
    await fireEvent.press(ui.getByLabelText(RESEND_COPY.action));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith('pat@example.com'));
  });

  it('a wrong password shows no resend', async () => {
    const ui = await signIn(httpError(401, 'Invalid email or password'));
    await waitFor(() => expect(ui.queryByTestId('login-resend')).toBeNull());
    expect(ui.queryByLabelText(RESEND_COPY.action)).toBeNull();
  });
});
