/**
 * BulkInviteScreen.test — Email Pipeline v1 (behavioral).
 *
 * Covers:
 *   - Renders in paste mode and shows the paste input.
 *   - Pasted lines are parsed into rows (email, name, note), every row is
 *     previewed valid or invalid, and display-unsafe rows never reach the API.
 *   - Submit hits `invitesApi.bulkInvite` with the cleaned valid rows, each
 *     with its name and note (the api layer translates that to the `rows`
 *     shape — covered in `invitesApi.test`).
 *   - Per-email result pills render after a successful response; Retry puts
 *     the failed rows back with their names and notes (INVITE-ONE-M).
 *   - A bulk failure shows a fixed safe notice, never the raw error.
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

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ canGoBack: () => true, goBack: mockGoBack }),
  useFocusEffect: (effect: () => void | (() => void)) => jest.requireActual('react').useEffect(effect, [effect]),
}));

import BulkInviteScreen from '../screens/coach/BulkInviteScreen';

describe('BulkInviteScreen — RTL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('renders the paste mode by default', async () => {
    const { getByTestId, getByLabelText } = await render(<BulkInviteScreen />);
    expect(getByLabelText('Paste').props.accessibilityState).toMatchObject({ checked: true });
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

    const { getByTestId, getAllByTestId } = await render(<BulkInviteScreen />);
    await fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com\nb@ex.com\nc@ex.com',
    );
    await fireEvent.press(getByTestId('bulk-submit'));

    await waitFor(() => {
      expect(mockBulkInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockBulkInvite).toHaveBeenCalledWith(
      [{ email: 'a@ex.com' }, { email: 'b@ex.com' }, { email: 'c@ex.com' }],
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

  it('surfaces a parsed summary with valid + invalid counts', async () => {
    const { getByTestId } = await render(<BulkInviteScreen />);
    await fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com\nnot-an-email\nb@ex.com',
    );
    expect(getByTestId('bulk-parsed-summary')).toBeTruthy();
  });

  it('rejects HTML-flavored "email" candidates as invalid', async () => {
    mockBulkInvite.mockResolvedValueOnce({ results: [] });
    const { getByTestId } = await render(<BulkInviteScreen />);
    await fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com\n"<script>"@ex.com\nattacker<x>@ex.com',
    );
    // Parsed summary surfaces both groups while the paste field still
    // holds the input.
    expect(getByTestId('bulk-parsed-summary')).toBeTruthy();
    await fireEvent.press(getByTestId('bulk-submit'));
    await waitFor(() => expect(mockBulkInvite).toHaveBeenCalledTimes(1));
    // Only the clean address survives validation; the HTML-flavored rows
    // are filtered out before the network call.
    expect(mockBulkInvite).toHaveBeenCalledWith([{ email: 'a@ex.com' }], undefined);
  });

  it('bulk failure: shows a fixed safe notice, never the raw error message, and keeps the list', async () => {
    mockBulkInvite.mockRejectedValueOnce(
      new Error('ECONNREFUSED postgres://_TOKEN@host'),
    );
    const { getByTestId, queryByText } = await render(<BulkInviteScreen />);
    await fireEvent.changeText(getByTestId('bulk-paste-input'), 'a@ex.com, Alice');
    await fireEvent.press(getByTestId('bulk-submit'));
    await waitFor(() => expect(getByTestId('bulk-send-failed')).toBeTruthy());
    expect(queryByText(
      'Could not send invites. Your email list is still here. Check your connection and try sending the invites again.',
    )).toBeTruthy();
    expect(queryByText(/ECONNREFUSED/)).toBeNull();
    expect(getByTestId('bulk-paste-input').props.value).toBe('a@ex.com, Alice');
  });

  it('previews every row with its name and note, and sends them (INVITE-ONE-M)', async () => {
    mockBulkInvite.mockResolvedValueOnce({ results: [] });
    const { getByTestId, getAllByTestId, getByText } = await render(<BulkInviteScreen />);
    await fireEvent.changeText(
      getByTestId('bulk-paste-input'),
      'a@ex.com, Alice, Knee first, then hips\nbad-row, Bob\nb@ex.com\tBea',
    );
    expect(getByText('Parsed rows (3)')).toBeTruthy();
    expect(getAllByTestId('bulk-row-valid')).toHaveLength(2);
    expect(getAllByTestId('bulk-row-invalid')).toHaveLength(1);
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Knee first, then hips')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
    await fireEvent.changeText(getByTestId('bulk-message-input'), 'Welcome aboard');
    await fireEvent.press(getByTestId('bulk-submit'));
    await waitFor(() => expect(mockBulkInvite).toHaveBeenCalledTimes(1));
    expect(mockBulkInvite).toHaveBeenCalledWith(
      [
        { email: 'a@ex.com', name: 'Alice', note: 'Knee first, then hips' },
        { email: 'b@ex.com', name: 'Bea' },
      ],
      'Welcome aboard',
    );
  });

  it('retry puts the failed rows back with their names, notes and the message', async () => {
    mockBulkInvite.mockResolvedValueOnce({
      results: [
        { email: 'a@ex.com', status: 'created', emailQueued: true, inviteId: 'i1' },
        { email: 'b@ex.com', status: 'failed', emailQueued: false, error: 'x' },
      ],
    });
    const { getByTestId, getByText } = await render(<BulkInviteScreen />);
    await fireEvent.changeText(getByTestId('bulk-paste-input'), 'a@ex.com, Alice\nb@ex.com, Bea, Mon, Wed');
    await fireEvent.changeText(getByTestId('bulk-message-input'), 'Hi');
    await fireEvent.press(getByTestId('bulk-submit'));
    await waitFor(() => expect(getByTestId('bulk-results')).toBeTruthy());
    expect(getByText('Bea')).toBeTruthy();
    await fireEvent.press(getByTestId('bulk-retry-failed'));
    expect(getByTestId('bulk-paste-input').props.value).toBe('b@ex.com, Bea, Mon, Wed');
    expect(getByTestId('bulk-message-input').props.value).toBe('Hi');
  });

  it('over the cap of 100: the summary says so and Send stays off', async () => {
    const { getByTestId, getByText } = await render(<BulkInviteScreen />);
    const lines = Array.from({ length: 101 }, (_, i) => `u${i}@ex.com`).join('\n');
    await fireEvent.changeText(getByTestId('bulk-paste-input'), lines);
    expect(getByText('101 valid · over cap (max 100)')).toBeTruthy();
    expect(getByText('+1 more')).toBeTruthy();
    expect(getByTestId('bulk-submit').props.accessibilityState).toMatchObject({ disabled: true });
  });
});
