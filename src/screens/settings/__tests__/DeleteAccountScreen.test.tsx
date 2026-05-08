/**
 * DeleteAccountScreen tests
 *
 * Tests render, confirmation gate, success flow, and error flow.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../services/api', () => ({
  deletionApi: {
    requestDeletion: jest.fn(),
  },
}));

jest.mock('../../services/authActions', () => ({
  signOut: jest.fn(),
}));

jest.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: jest.fn(),
}));

jest.mock('../../utils/haptics', () => ({
  warningTap: jest.fn(),
}));

// Provide a minimal theme so styled components don't crash
jest.mock('../../theme/ThemeProvider', () => ({
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

// ─── Import after mocks ────────────────────────────────────────────────────────

import DeleteAccountScreen from '../DeleteAccountScreen';
import { deletionApi } from '../../services/api';
import { signOut } from '../../services/authActions';
import { useCurrentUser } from '../../hooks/useCurrentUser';

const mockedDeletionApi = deletionApi as jest.Mocked<typeof deletionApi>;
const mockedSignOut = signOut as jest.Mock;
const mockedUseCurrentUser = useCurrentUser as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
};

function renderScreen() {
  return render(
    <DeleteAccountScreen navigation={mockNavigation as never} />,
  );
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
    jest.spyOn(Alert, 'alert');
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  describe('render', () => {
    it('renders the screen title', () => {
      const { getByText } = renderScreen();
      expect(getByText('Delete account')).toBeTruthy();
    });

    it('renders the 14-day grace period copy', () => {
      const { getByText } = renderScreen();
      expect(getByText(/14-day grace period/i)).toBeTruthy();
    });

    it('renders the permanently deleted list', () => {
      const { getByText } = renderScreen();
      expect(getByText(/Your profile, biometrics/i)).toBeTruthy();
    });

    it('renders the kept-for-legal list', () => {
      const { getByText } = renderScreen();
      expect(getByText(/Billing and invoice records/i)).toBeTruthy();
    });

    it('renders the confirmation input field', () => {
      const { getByTestId } = renderScreen();
      expect(getByTestId('confirm-input')).toBeTruthy();
    });

    it('renders the confirm deletion button as disabled initially', () => {
      const { getByTestId } = renderScreen();
      const btn = getByTestId('confirm-button');
      expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBe(true);
    });

    it('does not contain forbidden tokens (emoji, income, finance, netWorth)', () => {
      const { toJSON } = renderScreen();
      const json = JSON.stringify(toJSON());
      expect(json).not.toMatch(/income|finance|netWorth|confetti|\ud83c/);
    });
  });

  // ── Confirmation gate ───────────────────────────────────────────────────────

  describe('confirmation gate', () => {
    it('disables the button when input is empty', () => {
      const { getByTestId } = renderScreen();
      const btn = getByTestId('confirm-button');
      expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBe(true);
    });

    it('disables the button when input is wrong text', () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'wrong text');
      const btn = getByTestId('confirm-button');
      expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBe(true);
    });

    it('enables the button when input is "DELETE" (case-insensitive)', () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'delete');
      const btn = getByTestId('confirm-button');
      expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeFalsy();
    });

    it('enables the button when input matches the user email', () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'test@example.com');
      const btn = getByTestId('confirm-button');
      expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeFalsy();
    });

    it('is case-insensitive for the email match', () => {
      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'TEST@EXAMPLE.COM');
      const btn = getByTestId('confirm-button');
      expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeFalsy();
    });
  });

  // ── Success state ───────────────────────────────────────────────────────────

  describe('success state', () => {
    it('calls deletionApi.requestDeletion on confirm', async () => {
      mockedDeletionApi.requestDeletion.mockResolvedValue({
        data: { message: 'Email sent', expires_at: '2026-01-01T00:00:00Z' },
      } as never);

      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'DELETE');

      await act(async () => {
        fireEvent.press(getByTestId('confirm-button'));
      });

      await waitFor(() => {
        expect(mockedDeletionApi.requestDeletion).toHaveBeenCalledTimes(1);
      });
    });

    it('shows a success Alert with the 14-day grace message', async () => {
      mockedDeletionApi.requestDeletion.mockResolvedValue({
        data: { message: 'Email sent', expires_at: '2026-01-01T00:00:00Z' },
      } as never);

      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'DELETE');

      await act(async () => {
        fireEvent.press(getByTestId('confirm-button'));
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          expect.stringContaining('scheduled for deletion'),
          expect.stringContaining('14 days'),
          expect.any(Array),
          expect.any(Object),
        );
      });
    });

    it('calls signOut after the Alert button is pressed', async () => {
      mockedDeletionApi.requestDeletion.mockResolvedValue({
        data: { message: 'Email sent', expires_at: '2026-01-01T00:00:00Z' },
      } as never);

      // Capture the Alert callback so we can simulate pressing OK
      let alertCallback: (() => void) | undefined;
      (Alert.alert as jest.Mock).mockImplementation(
        (_title: string, _msg: string, buttons: Array<{ onPress?: () => void }>) => {
          alertCallback = buttons[0]?.onPress;
        },
      );

      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'DELETE');

      await act(async () => {
        fireEvent.press(getByTestId('confirm-button'));
      });

      await waitFor(() => {
        expect(alertCallback).toBeDefined();
      });

      act(() => {
        alertCallback?.();
      });

      expect(mockedSignOut).toHaveBeenCalledTimes(1);
    });
  });

  // ── Error state ─────────────────────────────────────────────────────────────

  describe('error state', () => {
    it('shows an error message when the API call fails', async () => {
      mockedDeletionApi.requestDeletion.mockRejectedValue(
        new Error('Network error'),
      );

      const { getByTestId, findByText } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'DELETE');

      await act(async () => {
        fireEvent.press(getByTestId('confirm-button'));
      });

      const errorText = await findByText(/Network error|Could not request/i);
      expect(errorText).toBeTruthy();
    });

    it('does not call signOut when the API fails', async () => {
      mockedDeletionApi.requestDeletion.mockRejectedValue(new Error('Server down'));

      const { getByTestId } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'DELETE');

      await act(async () => {
        fireEvent.press(getByTestId('confirm-button'));
      });

      expect(mockedSignOut).not.toHaveBeenCalled();
    });

    it('clears the error when the user edits the confirmation input', async () => {
      mockedDeletionApi.requestDeletion.mockRejectedValue(new Error('Failed'));

      const { getByTestId, queryByText } = renderScreen();
      fireEvent.changeText(getByTestId('confirm-input'), 'DELETE');

      await act(async () => {
        fireEvent.press(getByTestId('confirm-button'));
      });

      // Edit the input — error should clear
      fireEvent.changeText(getByTestId('confirm-input'), 'DELETE2');
      expect(queryByText(/Failed/)).toBeNull();
    });
  });

  // ── Navigation ──────────────────────────────────────────────────────────────

  describe('navigation', () => {
    it('calls navigation.goBack when the back button is pressed', () => {
      const { getAllByRole } = renderScreen();
      const buttons = getAllByRole('button');
      const backButton = buttons.find(
        (b) => b.props.accessibilityLabel === 'Go back',
      );
      expect(backButton).toBeTruthy();
      fireEvent.press(backButton!);
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });

    it('calls navigation.goBack when "Cancel — keep my account" is pressed', () => {
      const { getByText } = renderScreen();
      fireEvent.press(getByText('Cancel — keep my account'));
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });
  });
});
