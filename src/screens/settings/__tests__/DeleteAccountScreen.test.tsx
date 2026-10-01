/**
 * DeleteAccountScreen tests
 *
 * Tests render, confirmation gate, success flow, and error flow.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../services/api', () => ({
  deletionApi: {
    issueRecentAuthToken: jest.fn(),
    requestDeletion: jest.fn(),
    getDeletionStatus: jest.fn(),
    cancelDeletion: jest.fn(),
  },
}));

jest.mock('../../../utils/appleAuth', () => ({
  isAppleAuthAvailable: jest.fn(),
  reauthenticateWithApple: jest.fn(),
}));

jest.mock('../../../services/authActions', () => ({
  signOut: jest.fn(),
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: jest.fn(),
}));

jest.mock('../../../utils/haptics', () => ({
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

// Provide a minimal theme so styled components don't crash
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#F5EFE4',
      surface: '#F1E8D5',
      surfaceElevated: '#E8DCC8',
      textPrimary: '#1A1A18',
      textSecondary: '#5C5C5A',
      textMuted: '#B1A89F',
      textOnPrimary: '#F5EFE4',
      primary: '#2C4A36',
      primaryDark: '#1E3326',
      border: '#D9CEBC',
      error: '#4A0404',
      warning: '#C5A253',
      success: '#2C4A36',
      divider: '#E8DCC8',
    },
  }),
}));

jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));

// ─── Import after mocks ────────────────────────────────────────────────────────

import DeleteAccountScreen from '../DeleteAccountScreen';
import { deletionApi } from '../../../services/api';
import { signOut } from '../../../services/authActions';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { isAppleAuthAvailable, reauthenticateWithApple } from '../../../utils/appleAuth';

const mockedDeletionApi = deletionApi as jest.Mocked<typeof deletionApi>;
const mockedSignOut = signOut as jest.Mock;
const mockedUseCurrentUser = useCurrentUser as jest.Mock;
const mockedAppleAvailable = isAppleAuthAvailable as jest.Mock;
const mockedAppleReauth = reauthenticateWithApple as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
};

const PURGE_AFTER = '2026-10-14T12:00:00.000Z';
const PURGE_DATE_TEXT = 'October 14, 2026';

function scheduledResponse(over: Record<string, unknown> = {}) {
  return {
    data: {
      state: 'confirmed',
      already_scheduled: false,
      message: 'scheduled',
      requested_at: '2026-09-30T12:00:00.000Z',
      confirmed_at: '2026-09-30T12:00:00.000Z',
      grace_days: 14,
      purge_after: PURGE_AFTER,
      cancellable: true,
      apple_revocation: 'not_requested',
      ...over,
    },
  };
}

function axiosError(status: number, message?: string) {
  return Object.assign(new Error('Request failed'), {
    response: { status, data: message ? { message } : {} },
  });
}

async function renderScreen() {
  const utils = await render(<DeleteAccountScreen navigation={mockNavigation as never} />);
  // Wait for the initial status load to settle.
  await waitFor(() => expect(mockedDeletionApi.getDeletionStatus).toHaveBeenCalled());
  return utils;
}

function isDisabled(node: { props: { accessibilityState?: { disabled?: boolean }; disabled?: boolean } }) {
  return node.props.accessibilityState?.disabled ?? node.props.disabled;
}

async function fillForm(
  utils: Awaited<ReturnType<typeof renderScreen>>,
  opts: { confirm?: string; password?: string } = {},
) {
  await waitFor(() => utils.getByTestId('confirm-input'));
  await act(async () => {
    fireEvent.changeText(utils.getByTestId('confirm-input'), opts.confirm ?? 'DELETE');
  });
  if (opts.password !== undefined) {
    await act(async () => {
      fireEvent.changeText(utils.getByTestId('password-input'), opts.password as string);
    });
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DeleteAccountScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseCurrentUser.mockReturnValue({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'student',
    });
    mockedDeletionApi.getDeletionStatus.mockResolvedValue({ data: { state: 'none' } } as never);
    mockedAppleAvailable.mockResolvedValue(false);
    jest.spyOn(Alert, 'alert');
  });

  describe('request form', () => {
    it('renders the title, grace-period copy and both lists', async () => {
      const { getByText, getAllByText } = await renderScreen();
      await waitFor(() => getByText(/Your profile, biometrics/i));
      expect(getAllByText('Delete account').length).toBeGreaterThan(0);
      expect(getAllByText(/14-day grace period/i).length).toBeGreaterThan(0);
      expect(getByText(/Billing and invoice records/i)).toBeTruthy();
      expect(getByText(/Health and activity data/i)).toBeTruthy();
      expect(getByText(/conversations with Roman/i)).toBeTruthy();
      expect(getByText(/community posts, comments, messages/i)).toBeTruthy();
    });

    it('does not promise an email step or contacting support', async () => {
      const { toJSON, getByTestId } = await renderScreen();
      await waitFor(() => getByTestId('confirm-input'));
      const json = JSON.stringify(toJSON());
      expect(json).not.toMatch(/confirmation email|Contact support/i);
    });

    it('does not contain forbidden tokens (emoji, income, finance, netWorth)', async () => {
      const { toJSON, getByTestId } = await renderScreen();
      await waitFor(() => getByTestId('confirm-input'));
      const json = JSON.stringify(toJSON());
      const forbiddenTokens = new RegExp(
        ['income', 'finance', 'netWorth', 'conf' + 'etti', '\\ud83c'].join('|'),
      );
      expect(json).not.toMatch(forbiddenTokens);
    });

    it('keeps the delete button disabled until DELETE and a password are entered', async () => {
      const utils = await renderScreen();
      await waitFor(() => utils.getByTestId('confirm-button'));
      expect(isDisabled(utils.getByTestId('confirm-button'))).toBe(true);
      await fillForm(utils, { confirm: 'delete' });
      expect(isDisabled(utils.getByTestId('confirm-button'))).toBe(true);
      await fillForm(utils, { confirm: 'delete', password: 'pw' });
      expect(isDisabled(utils.getByTestId('confirm-button'))).toBe(false);
    });

    it('accepts the account email (case-insensitive) instead of DELETE', async () => {
      const utils = await renderScreen();
      await fillForm(utils, { confirm: 'TEST@example.com', password: 'pw' });
      expect(isDisabled(utils.getByTestId('confirm-button'))).toBe(false);
    });

    it('rejects other confirmation text', async () => {
      const utils = await renderScreen();
      await fillForm(utils, { confirm: 'remove', password: 'pw' });
      expect(isDisabled(utils.getByTestId('confirm-button'))).toBe(true);
    });

    it('hides the Apple option when Sign in with Apple is unavailable', async () => {
      const utils = await renderScreen();
      await waitFor(() => utils.getByTestId('confirm-input'));
      expect(utils.queryByTestId('apple-confirm-button')).toBeNull();
    });
  });

  describe('password re-auth', () => {
    it('mints a recent-auth token, schedules deletion with it and shows the date', async () => {
      mockedDeletionApi.issueRecentAuthToken.mockResolvedValue({
        data: { token: 'recent-tok', expires_in_ms: 300000 },
      } as never);
      mockedDeletionApi.requestDeletion.mockResolvedValue(scheduledResponse() as never);
      const utils = await renderScreen();
      await fillForm(utils, { password: 'hunter2' });
      await act(async () => {
        fireEvent.press(utils.getByTestId('confirm-button'));
      });
      await waitFor(() => utils.getByTestId('deletion-date'));
      expect(mockedDeletionApi.issueRecentAuthToken).toHaveBeenCalledWith({ password: 'hunter2' });
      expect(mockedDeletionApi.requestDeletion).toHaveBeenCalledWith('recent-tok', undefined);
      expect(utils.getByTestId('deletion-date').props.children).toBe(PURGE_DATE_TEXT);
      expect(utils.getByTestId('keep-account-button')).toBeTruthy();
      expect(mockedSignOut).not.toHaveBeenCalled();
    });

    it('shows a wrong-password message on 401 and does not request deletion', async () => {
      mockedDeletionApi.issueRecentAuthToken.mockRejectedValue(axiosError(401) as never);
      const utils = await renderScreen();
      await fillForm(utils, { password: 'nope' });
      await act(async () => {
        fireEvent.press(utils.getByTestId('confirm-button'));
      });
      await waitFor(() => utils.getByText(/password is not correct/i));
      expect(mockedDeletionApi.requestDeletion).not.toHaveBeenCalled();
    });

    it('shows a rate-limit message on 429', async () => {
      mockedDeletionApi.issueRecentAuthToken.mockRejectedValue(axiosError(429) as never);
      const utils = await renderScreen();
      await fillForm(utils, { password: 'pw' });
      await act(async () => {
        fireEvent.press(utils.getByTestId('confirm-button'));
      });
      await waitFor(() => utils.getByText(/Too many attempts/i));
    });

    it('shows the server message when scheduling fails and stays on the form', async () => {
      mockedDeletionApi.issueRecentAuthToken.mockResolvedValue({
        data: { token: 't', expires_in_ms: 1 },
      } as never);
      mockedDeletionApi.requestDeletion.mockRejectedValue(
        axiosError(401, 'Recent authentication required') as never,
      );
      const utils = await renderScreen();
      await fillForm(utils, { password: 'pw' });
      await act(async () => {
        fireEvent.press(utils.getByTestId('confirm-button'));
      });
      await waitFor(() => utils.getByText('Recent authentication required'));
      expect(utils.queryByTestId('deletion-date')).toBeNull();
    });
  });

  describe('Sign in with Apple re-auth', () => {
    beforeEach(() => {
      mockedAppleAvailable.mockResolvedValue(true);
    });

    it('re-authenticates with Apple and forwards the authorization code for revocation', async () => {
      mockedAppleReauth.mockResolvedValue({
        success: true,
        identityToken: 'apple-id',
        authorizationCode: 'apple-code',
      });
      mockedDeletionApi.issueRecentAuthToken.mockResolvedValue({
        data: { token: 'recent-tok', expires_in_ms: 300000 },
      } as never);
      mockedDeletionApi.requestDeletion.mockResolvedValue(
        scheduledResponse({ apple_revocation: 'revoked' }) as never,
      );
      const utils = await renderScreen();
      await waitFor(() => utils.getByTestId('apple-confirm-button'));
      expect(isDisabled(utils.getByTestId('apple-confirm-button'))).toBe(true);
      await fillForm(utils);
      expect(isDisabled(utils.getByTestId('apple-confirm-button'))).toBe(false);
      await act(async () => {
        fireEvent.press(utils.getByTestId('apple-confirm-button'));
      });
      await waitFor(() => utils.getByTestId('deletion-date'));
      expect(mockedDeletionApi.issueRecentAuthToken).toHaveBeenCalledWith({
        provider: 'apple',
        provider_token: 'apple-id',
      });
      expect(mockedDeletionApi.requestDeletion).toHaveBeenCalledWith('recent-tok', 'apple-code');
    });

    it('stays silent when the user cancels the Apple sheet', async () => {
      mockedAppleReauth.mockResolvedValue({ success: false, cancelled: true });
      const utils = await renderScreen();
      await waitFor(() => utils.getByTestId('apple-confirm-button'));
      await fillForm(utils);
      await act(async () => {
        fireEvent.press(utils.getByTestId('apple-confirm-button'));
      });
      expect(mockedDeletionApi.issueRecentAuthToken).not.toHaveBeenCalled();
      expect(utils.queryByText(/Apple could not confirm/i)).toBeNull();
    });
  });

  describe('status view', () => {
    beforeEach(() => {
      mockedDeletionApi.getDeletionStatus.mockResolvedValue({
        data: { state: 'confirmed', purge_after: PURGE_AFTER, cancellable: true },
      } as never);
    });

    it('shows the scheduled date instead of the form when deletion is already scheduled', async () => {
      const utils = await renderScreen();
      await waitFor(() => utils.getByTestId('deletion-date'));
      expect(utils.getByTestId('deletion-date').props.children).toBe(PURGE_DATE_TEXT);
      expect(utils.queryByTestId('confirm-input')).toBeNull();
    });

    it('cancels the deletion after confirmation and returns to the form', async () => {
      mockedDeletionApi.cancelDeletion.mockResolvedValue({ data: { message: 'ok' } } as never);
      const utils = await renderScreen();
      await waitFor(() => utils.getByTestId('keep-account-button'));
      await act(async () => {
        fireEvent.press(utils.getByTestId('keep-account-button'));
      });
      const alertMock = Alert.alert as jest.Mock;
      const buttons = alertMock.mock.calls[0][2] as Array<{ text: string; onPress?: () => unknown }>;
      const keep = buttons.find((b) => b.text === 'Keep my account');
      mockedDeletionApi.getDeletionStatus.mockResolvedValue({ data: { state: 'none' } } as never);
      await act(async () => {
        await keep?.onPress?.();
      });
      expect(mockedDeletionApi.cancelDeletion).toHaveBeenCalledTimes(1);
      await waitFor(() => utils.getByTestId('confirm-input'));
    });

    it('hides cancel once the grace period can no longer be cancelled', async () => {
      mockedDeletionApi.getDeletionStatus.mockResolvedValue({
        data: { state: 'confirmed', purge_after: PURGE_AFTER, cancellable: false },
      } as never);
      const utils = await renderScreen();
      await waitFor(() => utils.getByTestId('deletion-date'));
      expect(utils.queryByTestId('keep-account-button')).toBeNull();
    });

    it('signs out from the status view', async () => {
      const utils = await renderScreen();
      await waitFor(() => utils.getByTestId('sign-out-button'));
      await act(async () => {
        fireEvent.press(utils.getByTestId('sign-out-button'));
      });
      expect(mockedSignOut).toHaveBeenCalled();
    });
  });

  describe('navigation', () => {
    it('goes back from the header back button', async () => {
      const utils = await renderScreen();
      await waitFor(() => utils.getByLabelText('Go back'));
      fireEvent.press(utils.getByLabelText('Go back'));
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });

    it('goes back from "Cancel — keep my account"', async () => {
      const utils = await renderScreen();
      await waitFor(() => utils.getByLabelText('Cancel, go back to Settings'));
      fireEvent.press(utils.getByLabelText('Cancel, go back to Settings'));
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });
  });
});
