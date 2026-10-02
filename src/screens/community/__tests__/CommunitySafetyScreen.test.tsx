/**
 * CommunitySafetyScreen — guidelines, contact email, and block list with
 * Unblock (Apple 1.2 published contact + block management).
 */
import { SUPPORT_EMAIL } from '../../../constants/support';
import React from 'react';
import { Alert, Linking, type AlertButton } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommunitySafetyScreen from '../CommunitySafetyScreen';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('../../../components/HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, onPress, testID }: { children: React.ReactNode; onPress?: () => void; testID?: string }) =>
      React.createElement(Pressable, { onPress, testID }, children),
  };
});
jest.mock('../../../components/community', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { ThreadHeader: ({ title }: { title: string }) => React.createElement(Text, null, title) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (v: string) => mockSetString(v) }));

const mockGetInfo = jest.fn();
const mockListBlocks = jest.fn();
const mockUnblock = jest.fn();
const mockListNotices = jest.fn();
const mockMarkRead = jest.fn();
jest.mock('../../../api/communitySafetyApi', () => {
  const actual = jest.requireActual('../../../api/communitySafetyApi');
  return {
    ...actual,
    communitySafetyApi: {
      getSafetyInfo: () => mockGetInfo(),
      listBlocks: () => mockListBlocks(),
      unblock: (id: string) => mockUnblock(id),
      listNotices: () => mockListNotices(),
      markNoticeRead: (id: string) => mockMarkRead(id),
    },
  };
});

// Owner-approved copy, 2026-10-01 09:07 PDT (launch copy sections 2 and 4).
const APPROVED_GUIDELINES = [
  'Be respectful. No harassment, bullying, hate speech or threats.',
  'No sexual or explicit content.',
  'No spam, advertising or scams.',
  'Share training experience, not medical advice. This is a personal-training community.',
  "Keep private things private. Do not share anyone else's personal or health information.",
  'Report anything that breaks these rules. Reports go to your coach and to the team.',
  'This space is not for emergencies. If you are in danger, call 911. If you are struggling emotionally, call or text 988.',
];
const APPROVED_COMMITMENT =
  'Reports are reviewed within 24 hours, every day, by your coach and The Growth Project team. Content that breaks these guidelines is removed, and people who break them repeatedly lose access. If you block someone, they can no longer see your posts or message you, and they are not told.';

async function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={qc}>
      <CommunitySafetyScreen />
    </QueryClientProvider>,
  );
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockGetInfo.mockReset();
  mockListBlocks.mockReset();
  mockUnblock.mockReset().mockResolvedValue(undefined);
  mockListNotices.mockReset().mockResolvedValue({ notices: [], unread_count: 0 });
  mockMarkRead.mockReset().mockResolvedValue(undefined);
  mockSetString.mockReset().mockResolvedValue(true);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

describe('CommunitySafetyScreen', () => {
  it('shows server guidelines, commitment and a mailto contact', async () => {
    mockGetInfo.mockResolvedValue({
      contact_email: 'safety@example.com',
      report_reasons: [],
      guidelines: ['Be kind to each other'],
      response_commitment: 'Reports are reviewed within 24 hours.',
    });
    mockListBlocks.mockResolvedValue([]);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { findByText, getByTestId } = await renderScreen();
    expect(await findByText('Be kind to each other')).toBeTruthy();
    expect(await findByText('Reports are reviewed within 24 hours.')).toBeTruthy();
    expect(await findByText('You have not blocked anyone.')).toBeTruthy();
    await fireEvent.press(getByTestId('community-safety-email'));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^mailto:safety@example\.com/));
    open.mockRestore();
  });

  it('falls back to the published email when safety info fails', async () => {
    mockGetInfo.mockRejectedValue(new Error('offline'));
    mockListBlocks.mockResolvedValue([]);
    const { findByText } = await renderScreen();
    expect(await findByText(SUPPORT_EMAIL)).toBeTruthy();
  });

  it('falls back to the owner-approved guidelines and 24-hour commitment, byte for byte', async () => {
    mockGetInfo.mockRejectedValue(new Error('offline'));
    mockListBlocks.mockResolvedValue([]);
    const { findByText, getByTestId } = await renderScreen();
    for (const rule of APPROVED_GUIDELINES) {
      expect(await findByText(rule)).toBeTruthy();
    }
    expect(getByTestId('community-safety-commitment').props.children).toBe(APPROVED_COMMITMENT);
    expect(await findByText(APPROVED_COMMITMENT)).toBeTruthy();
  });

  it('unblocks a member after confirmation', async () => {
    mockGetInfo.mockRejectedValue(new Error('offline'));
    mockListBlocks.mockResolvedValue([
      { user_id: 'u-1', name: 'Sam', blocked_at: '2026-09-30T00:00:00.000Z' },
    ]);
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('community-safety-unblock-u-1'));
    expect(mockUnblock).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] as AlertButton[];
    await act(async () => {
      buttons.find((b) => b.text === 'Unblock')?.onPress?.();
    });
    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith('u-1'));
  });
});

describe('CommunitySafetyScreen — safety email when no mail app opens (B-314-3)', () => {
  beforeEach(() => {
    mockGetInfo.mockResolvedValue({
      contact_email: 'safety@example.test',
      report_reasons: [],
      guidelines: ['Be kind.'],
      response_commitment: 'Reviewed within 24 hours.',
    });
    mockListBlocks.mockResolvedValue([]);
  });

  it('keeps the address usable: what happened, selectable address, copy and retry', async () => {
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('No Activity found to handle Intent'))
      .mockResolvedValueOnce(true);
    const { getByTestId, findByTestId, findByText, queryByTestId } = await renderScreen();
    // The server contact has loaded (not the fallback address).
    await findByText('safety@example.test');

    fireEvent.press(getByTestId('community-safety-email'));
    const status = await findByTestId('community-safety-email-status');
    expect(status.props.children).toBe(
      'No email app opened on this device. Copy the address and email us from any email app or device.',
    );
    const address = getByTestId('community-safety-email-address');
    expect(address.props.selectable).toBe(true);
    expect(address.props.children).toBe('safety@example.test');

    fireEvent.press(getByTestId('community-safety-email-copy'));
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith('safety@example.test'));
    await waitFor(() =>
      expect(getByTestId('community-safety-email-status').props.children).toBe(
        'Address copied. Paste it into any email app to write to safety@example.test.',
      ),
    );

    // Try again: this time a mail app opens, so the fallback goes away.
    fireEvent.press(getByTestId('community-safety-email-retry'));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open).toHaveBeenLastCalledWith('mailto:safety@example.test?subject=Community%20safety');
    await waitFor(() => expect(queryByTestId('community-safety-email-fallback')).toBeNull());
    open.mockRestore();
  });

  it('says how to select the address when copying fails too', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    mockSetString.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const { getByTestId, findByTestId, findByText } = await renderScreen();
    await findByText('safety@example.test');
    fireEvent.press(getByTestId('community-safety-email'));
    await findByTestId('community-safety-email-copy');
    fireEvent.press(getByTestId('community-safety-email-copy'));
    await waitFor(() =>
      expect(getByTestId('community-safety-email-status').props.children).toBe(
        'The address could not be copied. Press and hold it to select it: safety@example.test',
      ),
    );
    open.mockRestore();
  });
});

describe('CommunitySafetyScreen — moderation notices (B-314-6)', () => {
  beforeEach(() => {
    mockGetInfo.mockResolvedValue({
      contact_email: 'safety@example.test',
      report_reasons: [],
      guidelines: ['Be kind.'],
      response_commitment: 'Reviewed within 24 hours.',
    });
    mockListBlocks.mockResolvedValue([]);
  });

  it('shows the member their warning and marks unread notices read once', async () => {
    mockListNotices.mockResolvedValue({
      notices: [
        {
          id: 'n-1',
          action: 'warn',
          message: 'Your coach or The Growth Project team reviewed a report and is giving you a warning.',
          created_at: '2026-10-01T10:00:00.000Z',
          read: false,
        },
        {
          id: 'n-0',
          action: 'hide',
          message: 'Something you shared was removed.',
          created_at: '2026-09-20T10:00:00.000Z',
          read: true,
        },
      ],
      unread_count: 1,
    });
    const { findByTestId, getByText } = await renderScreen();
    await findByTestId('community-safety-notice-n-1');
    expect(getByText('Warning from a moderator')).toBeTruthy();
    expect(
      getByText('Your coach or The Growth Project team reviewed a report and is giving you a warning.'),
    ).toBeTruthy();
    expect(getByText('Something you shared was removed')).toBeTruthy();
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('n-1'));
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
  });

  it('a failed notices load says what happened and retries', async () => {
    mockListNotices
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { isAxiosError: true }))
      .mockResolvedValueOnce({ notices: [], unread_count: 0 });
    const { findByTestId, getByTestId, queryByTestId } = await renderScreen();
    await findByTestId('community-safety-notices-error');
    fireEvent.press(getByTestId('community-safety-notices-retry'));
    await waitFor(() => expect(queryByTestId('community-safety-notices-error')).toBeNull());
    expect(mockListNotices).toHaveBeenCalledTimes(2);
  });
});
