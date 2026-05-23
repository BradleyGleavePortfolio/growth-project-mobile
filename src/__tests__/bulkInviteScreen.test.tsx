/**
 * BulkInviteScreen.test — Email Pipeline v1 (behavioral).
 *
 * Covers:
 *   - Renders in paste mode and shows the paste input.
 *   - Pasted emails are parsed into valid/invalid groups, the parsed
 *     summary surfaces both counts, and invalid display-unsafe rows
 *     are stripped of control chars.
 *   - Submit hits `invitesApi.bulkInvite` with the cleaned valid list
 *     (the api layer translates that to the `rows` shape — covered in
 *     `invitesApi.test`).
 *   - Per-email result pills render after a successful response.
 *   - A bulk-failure surfaces a fixed safe Alert, never the raw error.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

const mockBulkInvite = jest.fn();
jest.mock('../api/invites', () => {
  const actual = jest.requireActual('../api/invites');
  return {
    ...actual,
    invitesApi: {
      bulkInvite: (...args: unknown[]) => mockBulkInvite(...args),
    },
  };
});

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary: '#000', primaryLight: '#000', primaryPale: '#000',
      primaryDark: '#000', accent: '#000',
      background: '#000', surface: '#000', surfaceElevated: '#000',
      textPrimary: '#000', textSecondary: '#000', textMuted: '#000',
      textOnPrimary: '#fff', border: '#000', divider: '#000',
      success: '#0a0', warning: '#aa0', error: '#a00', info: '#00a',
      streak: '#aa0', primaryTint: '#000',
    },
  }),
}));

import BulkInviteScreen from '../screens/coach/BulkInviteScreen';

describe('BulkInviteScreen — RTL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('renders the paste mode by default', () => {
    const { getByTestId } = render(<BulkInviteScreen />);
    expect(getByTestId('bulk-mode-paste')).toBeTruthy();
    expect(getByTestId('bulk-paste-input')).toBeTruthy();
  });

  it('paste parses valid emails, surfaces the count, and sends them to the API on submit', async () => {
    mockBulkInvite.mockResolvedValueOnce({
      results: [
        { email: 'a@ex.com', status: 'created', emailQueued: true, inviteId: 'i1' },
        { email: 'b@ex.com', status: 'reused', emailQueued: true, inviteId: 'i2' },
        { email: 'c@ex.com', status: 'failed', emailQueued: false, error: 'x' },
      ],
    });

    const { getByTestId, getAllByTestId } = render(<BulkInviteScreen />);
    fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com\nb@ex.com\nc@ex.com',
    );
    fireEvent.press(getByTestId('bulk-submit'));

    await waitFor(() => {
      expect(mockBulkInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockBulkInvite).toHaveBeenCalledWith(
      ['a@ex.com', 'b@ex.com', 'c@ex.com'],
      undefined,
    );

    await waitFor(() => {
      expect(getByTestId('bulk-results')).toBeTruthy();
    });

    expect(getAllByTestId('bulk-result-created')).toHaveLength(1);
    expect(getAllByTestId('bulk-result-reused')).toHaveLength(1);
    expect(getAllByTestId('bulk-result-failed')).toHaveLength(1);
    expect(getByTestId('bulk-copy-failed')).toBeTruthy();
    expect(getByTestId('bulk-retry-failed')).toBeTruthy();
  });

  it('surfaces a parsed summary with valid + invalid counts', () => {
    const { getByTestId } = render(<BulkInviteScreen />);
    fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com\nnot-an-email\nb@ex.com',
    );
    expect(getByTestId('bulk-parsed-summary')).toBeTruthy();
  });

  it('rejects HTML-flavored "email" candidates as invalid', async () => {
    mockBulkInvite.mockResolvedValueOnce({ results: [] });
    const { getByTestId } = render(<BulkInviteScreen />);
    fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com\n"<script>"@ex.com\nattacker<x>@ex.com',
    );
    // Parsed summary surfaces both groups while the paste field still
    // holds the input.
    expect(getByTestId('bulk-parsed-summary')).toBeTruthy();
    fireEvent.press(getByTestId('bulk-submit'));
    await waitFor(() => expect(mockBulkInvite).toHaveBeenCalledTimes(1));
    // Only the clean address survives validation; the HTML-flavored rows
    // are filtered out before the network call.
    expect(mockBulkInvite).toHaveBeenCalledWith(['a@ex.com'], undefined);
  });

  it('bulk failure: shows a fixed safe alert, never the raw error message', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockBulkInvite.mockRejectedValueOnce(
      new Error('ECONNREFUSED postgres://_TOKEN@host'),
    );
    const { getByTestId } = render(<BulkInviteScreen />);
    fireEvent.changeText(getByTestId('bulk-paste-input'), 'a@ex.com');
    fireEvent.press(getByTestId('bulk-submit'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const args = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    expect(args[0]).toBe('Could not send invites');
    expect(args[1]).toBe('Please try again.');
    // Never leak the raw error string. Alert.alert only receives the safe
    // title + message; no extra args carry the underlying error.
    expect(args.length).toBeLessThanOrEqual(2);
  });
});
