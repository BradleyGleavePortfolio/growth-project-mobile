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

const mockGetInfo = jest.fn();
const mockListBlocks = jest.fn();
const mockUnblock = jest.fn();
jest.mock('../../../api/communitySafetyApi', () => {
  const actual = jest.requireActual('../../../api/communitySafetyApi');
  return {
    ...actual,
    communitySafetyApi: {
      getSafetyInfo: () => mockGetInfo(),
      listBlocks: () => mockListBlocks(),
      unblock: (id: string) => mockUnblock(id),
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
