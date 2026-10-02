/**
 * More > Community (member wins) — App Review 1.2 (B-314-1): every other
 * member's win has Report and Block, the author can delete their own, a
 * filtered post keeps the draft with the server's reason, and load failures
 * say what happened with a retry. Also the render fix: the screen reads the
 * real feed contract (no blank cards, no "NaNd ago").
 */
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommunityScreen, { formatTimeAgo } from '../CommunityScreen';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      onPress,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement(Pressable, { onPress, testID }, children),
  };
});
jest.mock('../../../components/SkeletonLoader', () => ({
  SkeletonCard: () => null,
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u-me', coach_id: 'u-coach' }),
}));
const mockCapture = jest.fn();
jest.mock('../../../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCapture(...a),
}));

const mockGetFeed = jest.fn();
const mockPostWin = jest.fn();
const mockDeleteWin = jest.fn();
jest.mock('../../../api/communityWinsApi', () => ({
  communityWinsApi: {
    getFeed: (...a: unknown[]) => mockGetFeed(...a),
    postWin: (...a: unknown[]) => mockPostWin(...a),
    deleteWin: (...a: unknown[]) => mockDeleteWin(...a),
  },
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
const mockReport = jest.fn();
const mockBlock = jest.fn();
const mockListNotices = jest.fn();
jest.mock('../../../api/communitySafetyApi', () => {
  const actual = jest.requireActual('../../../api/communitySafetyApi');
  return {
    ...actual,
    communitySafetyApi: {
      report: (...a: unknown[]) => mockReport(...a),
      block: (...a: unknown[]) => mockBlock(...a),
      listNotices: () => mockListNotices(),
    },
  };
});

const OTHER_WIN = {
  id: 'win-other',
  userId: 'u-alice',
  displayName: 'Alice',
  title: 'Deadlift PR',
  description: '100 kg',
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  isMine: false,
};
const MY_WIN = {
  id: 'win-mine',
  userId: 'u-me',
  displayName: 'Sam',
  title: 'Seven day streak',
  description: 'Stretched every day',
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  isMine: true,
};

async function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommunityScreen />
    </QueryClientProvider>,
  );
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockGetFeed.mockReset().mockResolvedValue([OTHER_WIN, MY_WIN]);
  mockPostWin.mockReset();
  mockDeleteWin.mockReset().mockResolvedValue(undefined);
  mockReport.mockReset().mockResolvedValue(undefined);
  mockBlock.mockReset().mockResolvedValue(undefined);
  mockCapture.mockReset();
  mockNavigate.mockReset();
  mockListNotices.mockReset().mockResolvedValue({ notices: [], unread_count: 0 });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

function pressAlertButton(text: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const buttons = (call[2] ?? []) as AlertButton[];
  const b = buttons.find((x) => x.text === text);
  if (!b?.onPress) throw new Error(`no alert button ${text}`);
  return b.onPress();
}

describe('More > Community wins', () => {
  it('renders the real feed: first name, title, description and a readable time', async () => {
    const { findByText, getByText } = await renderScreen();
    expect(await findByText('Deadlift PR')).toBeTruthy();
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('100 kg')).toBeTruthy();
    expect(getByText('3h ago')).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
    expect(formatTimeAgo(null)).toBe('');
    expect(formatTimeAgo('not a date')).toBe('');
  });

  it('every other member’s win can be reported as a win', async () => {
    const { findByTestId, getByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('win-menu-win-other'));
    await fireEvent.press(getByTestId('win-menu-win-other-report'));
    await fireEvent.press(getByTestId('win-menu-win-other-reason-harassment'));
    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        target_type: 'win',
        target_id: 'win-other',
        reason: 'harassment',
      }),
    );
  });

  it('the author can block from a win (two-way) and the feed refetches', async () => {
    const { findByTestId, getByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('win-menu-win-other'));
    await fireEvent.press(getByTestId('win-menu-win-other-block'));
    await act(async () => {
      await pressAlertButton('Block');
    });
    expect(mockBlock).toHaveBeenCalledWith('u-alice');
    await waitFor(() => expect(mockGetFeed.mock.calls.length).toBeGreaterThan(1));
  });

  it('the viewer deletes their own win after confirming', async () => {
    const { findByTestId, getByTestId, queryByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('win-menu-win-mine'));
    expect(queryByTestId('win-menu-win-mine-report')).toBeNull();
    await fireEvent.press(getByTestId('win-menu-win-mine-delete'));
    await act(async () => {
      await pressAlertButton('Delete');
    });
    expect(mockDeleteWin).toHaveBeenCalledWith('win-mine');
  });

  it('a filtered win keeps the draft and shows the server reason', async () => {
    mockPostWin.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          code: 'community.content.rejected',
          message:
            'This was not posted because it appears to contain abusive language. Please rephrase it.',
        },
      },
    });
    const { findByTestId, getByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('wins-share'));
    await fireEvent.changeText(getByTestId('wins-title'), 'Bad words');
    await fireEvent.changeText(getByTestId('wins-description'), 'More bad words');
    await fireEvent.press(getByTestId('wins-submit'));
    const error = await findByTestId('wins-post-error');
    expect(error.props.children).toContain('Please rephrase it.');
    expect(getByTestId('wins-title').props.value).toBe('Bad words');
    expect(getByTestId('wins-description').props.value).toBe('More bad words');
  });

  it('a load failure says what happened and offers Try again', async () => {
    mockGetFeed.mockReset().mockRejectedValue({
      isAxiosError: true,
      response: { status: 0 },
      config: { headers: {} },
    });
    const { findByTestId, getByTestId } = await renderScreen();
    expect(await findByTestId('wins-error')).toBeTruthy();
    await fireEvent.press(getByTestId('wins-retry'));
    await waitFor(() => expect(mockGetFeed.mock.calls.length).toBeGreaterThan(1));
  });

  it('the empty state is plain and warm (no exclamation marks, no dash slogans)', async () => {
    mockGetFeed.mockReset().mockResolvedValue([]);
    const { findByText } = await renderScreen();
    const el = await findByText(/Share something you are proud of/);
    expect(String(el.props.children)).not.toMatch(/!|Be the first/);
  });
});

describe('More > Community wins: Community safety is reachable here (B-314-4)', () => {
  it('opens Community safety from the wins screen', async () => {
    const { findByTestId, queryByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('wins-open-safety'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunitySafety');
    expect(queryByTestId('wins-notice-banner')).toBeNull();
  });

  it('shows a banner while a moderator notice is unread, and it opens Community safety', async () => {
    mockListNotices.mockResolvedValue({
      notices: [
        { id: 'n-1', action: 'warn', message: 'Warning text', created_at: '2026-10-01T00:00:00Z', read: false },
      ],
      unread_count: 1,
    });
    const { findByTestId } = await renderScreen();
    const banner = await findByTestId('wins-notice-banner');
    expect(banner.props.accessibilityLabel).toBe(
      'You have a notice from a moderator. Open Community safety to read it.',
    );
    await fireEvent.press(banner);
    expect(mockNavigate).toHaveBeenCalledWith('CommunitySafety');
  });
});
