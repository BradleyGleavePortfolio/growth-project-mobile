/**
 * B-AUTHMAIL-124-1: the anonymous reset response does not prove that mail
 * was sent. Confirm submission only and keep a pre-sign-in support path.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockForgotPassword = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    forgotPassword: (...args: unknown[]) => mockForgotPassword(...args),
  },
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import ForgotPasswordScreen from '../ForgotPasswordScreen';

async function renderRequest() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const view = await render(
    <ForgotPasswordScreen navigation={navigation as never} />,
  );
  await fireEvent.changeText(view.getByLabelText('Email'), '  member@example.test  ');
  return { ...view, navigation };
}

describe('password reset mail readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The backend returns this same response even if SMTP refuses to send.
    mockForgotPassword.mockResolvedValue({
      data: {
        message: 'If an account exists with that email, a reset link has been sent.',
      },
    });
  });

  it('confirms the request, never promises delivery from the anonymous response', async () => {
    const view = await renderRequest();
    await fireEvent.press(view.getByLabelText('Back'));
    expect(view.navigation.goBack).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('Email')).toHaveStyle({ fontFamily: 'Inter_400Regular', borderWidth: undefined });
    await fireEvent.press(view.getByLabelText('Send reset link'));

    await waitFor(() =>
      expect(view.getByText('Reset request submitted')).toBeTruthy(),
    );
    expect(mockForgotPassword).toHaveBeenCalledWith('member@example.test');
    expect(view.getByText('Check your inbox and spam folder')).toBeTruthy();
    expect(view.getByText(/cannot confirm whether an email was sent/)).toBeTruthy();
    expect(view.queryByText(/you'll receive|email shortly|link has been sent/i)).toBeNull();
  });

  it('opens the existing pre-sign-in support screen when no reset link arrives', async () => {
    const view = await renderRequest();
    await fireEvent.press(view.getByLabelText('Send reset link'));
    await fireEvent.press(await view.findByLabelText('Contact support'));
    expect(view.navigation.navigate).toHaveBeenCalledWith('SupportInbox');
  });

  it('keeps a route back to login after submission', async () => {
    const view = await renderRequest();
    await fireEvent.press(view.getByLabelText('Send reset link'));
    await fireEvent.press(await view.findByLabelText('Back to login'));
    expect(view.navigation.navigate).toHaveBeenCalledWith('Login');
  });

  it('does not report submission when the backend refuses the request', async () => {
    mockForgotPassword.mockRejectedValue({
      response: { status: 429, data: { message: 'Too many reset requests. Contact support.' } },
    });
    const view = await renderRequest();
    await fireEvent.press(view.getByLabelText('Send reset link'));
    await waitFor(() =>
      expect(view.getByText('Too many reset requests. Contact support.')).toBeTruthy(),
    );
    expect(view.queryByText('Reset request submitted')).toBeNull();
    expect(view.getByLabelText('Email')).toBeTruthy();
  });

  it('does not report submission when the network request fails', async () => {
    mockForgotPassword.mockRejectedValue(new Error('The server could not be reached.'));
    const view = await renderRequest();
    await fireEvent.press(view.getByLabelText('Send reset link'));
    await waitFor(() =>
      expect(view.getByText('The server could not be reached.')).toBeTruthy(),
    );
    expect(view.queryByText('Reset request submitted')).toBeNull();
    expect(view.getByLabelText('Send reset link')).toBeTruthy();
  });
});
