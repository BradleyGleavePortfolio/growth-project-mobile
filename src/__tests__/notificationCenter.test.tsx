/**
 * Phase 9 — Notification center tests.
 *
 * Covers:
 *   1. NotificationCenterScreen renders the list.
 *   2. Tapping a row calls markNotificationRead and updates the unread count.
 *   3. Badge count drops after mark-as-read interaction.
 *   4. NotificationPreferencesScreen renders all kind sections.
 *   5. Toggling a preference calls saveNotificationPreferences.
 *   6. Mute-all toggle disables per-kind push and in_app switches.
 *   7. NotificationBadge renders "99+" for counts above 99.
 *   8. NotificationBadge renders nothing for count === 0.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { routeInAppNotification } from '../services/pushTapRouter';
jest.mock('../services/pushTapRouter', () => ({ routeInAppNotification: jest.fn(() => false) }));

// @expo/vector-icons depends on expo-font → expo-asset which is not available
// in the Jest environment. Provide a lightweight stub that renders nothing.
jest.mock('@expo/vector-icons', () => {
  function Icon(_props: {
    name?: string;
    size?: number;
    color?: string;
    accessibilityElementsHidden?: boolean;
  }) {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});

import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';
import NotificationPreferencesScreen from '../screens/notifications/NotificationPreferencesScreen';
import NotificationBadge from '../components/NotificationBadge';

// ─── Service mocks ────────────────────────────────────────────────────────────

jest.mock('../services/notificationsApi', () => {
  const MOCK_PREFS = {
    muteAll: false,
    quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
    channels: {
      coach:      { email: true, push: true, in_app: true },
      milestone:  { email: true, push: true, in_app: true },
      check_in:   { email: true, push: true, in_app: true },
      message:    { email: true, push: true, in_app: true },
      build_week: { email: true, push: true, in_app: true },
      system:     { email: true, push: true, in_app: true },
      reminder:   { email: true, push: true, in_app: true },
      tip:        { email: true, push: true, in_app: true },
    },
  };

  const notifications = [
    {
      id: 'n_test_001',
      kind: 'coach',
      title: 'Coach note available',
      body: 'Your coach left feedback on this week check-in.',
      read: false,
      createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
    {
      id: 'n_test_002',
      kind: 'milestone',
      title: 'Milestone reached',
      body: 'Seven consecutive check-ins logged.',
      read: false,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'n_test_003',
      kind: 'system',
      title: 'Platform update',
      body: 'New features are available.',
      read: true,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    },
  ];

  return {
    NOTIFICATIONS_MOCK_ENABLED: true,
    // B-NOTIF-6: the kinds with a backend switch (same table as the module).
    KIND_PREFS_PREFIX: {
      message: 'message',
      milestone: 'milestone',
      check_in: 'missed_checkin',
      build_week: 'build_week',
    },
    fetchNotifications: jest.fn().mockResolvedValue({
      items: notifications,
      nextCursor: null,
    }),
    fetchUnreadCount: jest.fn().mockResolvedValue(2),
    markNotificationRead: jest.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: jest.fn().mockResolvedValue(undefined),
    fetchNotificationPreferences: jest.fn().mockResolvedValue(JSON.parse(JSON.stringify(MOCK_PREFS))),
    saveNotificationPreferences: jest.fn().mockImplementation(async (updates) => ({
      ...MOCK_PREFS,
      ...updates,
    })),
  };
});

// B-341-2: an unexpected save failure is reported (no Sentry in Jest).
const mockReport = jest.fn();
jest.mock('../lib/consultation/report', () => ({
  reportUnexpected: (...a: unknown[]) => mockReport(...a),
}));

// ─── Navigation mock ──────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
  }),
}));

// ─── Theme mock ───────────────────────────────────────────────────────────────

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary:        '#2C4A36',
      primaryLight:   '#4D7059',
      primaryPale:    '#D6E4DA',
      primaryDark:    '#1C3023',
      background:     '#F5EFE4',
      surface:        '#F1E8D5',
      textPrimary:    '#1A1A18',
      textSecondary:  '#3D3D3A',
      textMuted:      '#6B675F',
      textOnPrimary:  '#F5EFE4',
      border:         '#B08D57',
      divider:        'rgba(176,141,87,0.2)',
      success:        '#2C4A36',
      warning:        '#C5A253',
      error:          '#4A0404',
      info:           '#457B9D',
      streak:         '#B1A89F',
      tabActive:      '#2C4A36',
      tabInactive:    '#B1A89F',
      tabBackground:  '#F5EFE4',
      tabBorder:      '#B1A89F',
      cardShadow:     'rgba(26,26,24,0.06)',
      dark:           '#1A1A18',
      white:          '#F5EFE4',
      gold:           '#C5A253',
      orange:         '#4A0404',
    },
  }),
}));

// ─── Import the mocked module after jest.mock ─────────────────────────────────

import * as notificationsApi from '../services/notificationsApi';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationCenterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply resolved values after clearAllMocks.
    (notificationsApi.fetchNotifications as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'n_test_001',
          kind: 'coach',
          title: 'Coach note available',
          body: 'Your coach left feedback on this week check-in.',
          read: false,
          createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
        {
          id: 'n_test_002',
          kind: 'milestone',
          title: 'Milestone reached',
          body: 'Seven consecutive check-ins logged.',
          read: false,
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
      ],
      nextCursor: null,
    });
    (notificationsApi.fetchUnreadCount as jest.Mock).mockResolvedValue(2);
    (notificationsApi.markNotificationRead as jest.Mock).mockResolvedValue(undefined);
    (notificationsApi.markAllNotificationsRead as jest.Mock).mockResolvedValue(undefined);
  });

  it('renders notification rows after loading', async () => {
    const { getByText, queryByText } = await render(<NotificationCenterScreen />);

    // The header title is always present.
    expect(getByText('Notifications')).toBeTruthy();

    // Wait for async load.
    await waitFor(() => {
      expect(getByText('Coach note available')).toBeTruthy();
      expect(getByText('Milestone reached')).toBeTruthy();
    });

    // Should not show the empty state.
    expect(queryByText('No notifications.')).toBeNull();
  });

  it('shows unread count banner when unread > 0', async () => {
    const { getByText } = await render(<NotificationCenterScreen />);
    await waitFor(() => {
      expect(getByText(/2 unread notification/)).toBeTruthy();
    });
  });

  it('calls markNotificationRead when an unread row is tapped', async () => {
    const { getByText } = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(getByText('Coach note available')).toBeTruthy());

    await fireEvent.press(getByText('Coach note available'));

    await waitFor(() => {
      expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith('n_test_001');
    });
  });

  it('badge count decreases after mark-as-read', async () => {
    const { getByText, queryByText } = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(getByText('Coach note available')).toBeTruthy());

    // Initially 2 unread.
    expect(getByText(/2 unread notification/)).toBeTruthy();

    // Tap the first unread row.
    await act(async () => {
      await fireEvent.press(getByText('Coach note available'));
    });

    await waitFor(() => {
      // After one mark-read, the banner should show 1 unread (or disappear).
      const banner = queryByText(/1 unread notification/);
      const gone = queryByText(/2 unread notification/);
      expect(gone).toBeNull();
      // Either the banner updates to 1, or disappears.
      // Both are correct behaviours.
      if (banner) {
        expect(banner).toBeTruthy();
      }
    });
  });

  it('calls markAllNotificationsRead when "Mark all read" is tapped', async () => {
    const { getByText } = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(getByText('Mark all read')).toBeTruthy());

    await fireEvent.press(getByText('Mark all read'));

    await waitFor(() => {
      expect(notificationsApi.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    });
  });

  it('shows empty state when there are no notifications', async () => {
    (notificationsApi.fetchNotifications as jest.Mock).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    (notificationsApi.fetchUnreadCount as jest.Mock).mockResolvedValue(0);

    const { getByText } = await render(<NotificationCenterScreen />);

    await waitFor(() => {
      expect(getByText('No notifications.')).toBeTruthy();
    });
  });

  it.each([
    ['coach', 'Notifications'], ['milestone', 'Timeline'], ['check_in', undefined],
    ['message', 'Messages'], ['build_week', 'MoreIndex'], ['system', undefined],
    ['reminder', 'WorkoutMain'], ['tip', undefined],
  ])(
    'preserves the mark-read and destination action for %s',
    async (kind, actionScreen) => {
      const item = { id: kind, kind, title: `${kind} notice`, body: 'Full notification body.',
        read: false, createdAt: new Date().toISOString(), actionScreen,
        actionParams: { threadId: kind } };
      (notificationsApi.fetchNotifications as jest.Mock).mockResolvedValue({ items: [item], nextCursor: null });
      const ui = await render(<NotificationCenterScreen />);
      await waitFor(() => expect(ui.getByText(item.title)).toBeTruthy());
      await fireEvent.press(ui.getByText(item.title));
      await waitFor(() => expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith(kind));
      if (actionScreen) {
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(actionScreen, item.actionParams));
        expect(routeInAppNotification).toHaveBeenCalledWith(actionScreen, item.actionParams);
      } else expect(mockNavigate).not.toHaveBeenCalled();
    },
  );

  it('keeps back, preferences, refresh and pagination reachable', async () => {
    (notificationsApi.fetchNotifications as jest.Mock).mockResolvedValueOnce({ items: [], nextCursor: 'page2' })
      .mockResolvedValue({ items: [], nextCursor: null });
    const ui = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(ui.getByText('No notifications.')).toBeTruthy());
    await fireEvent.press(ui.getByLabelText('Go back'));
    expect(mockGoBack).toHaveBeenCalled();
    await fireEvent.press(ui.getByText('Notification preferences'));
    expect(mockNavigate).toHaveBeenCalledWith('NotificationPreferences');
    const { FlatList } = jest.requireActual('react-native');
    await act(async () => ui.UNSAFE_getByType(FlatList).props.onEndReached());
    expect(notificationsApi.fetchNotifications).toHaveBeenCalledWith('page2', 25);
    await act(async () => ui.UNSAFE_getByType(FlatList).props.refreshControl.props.onRefresh());
    expect(notificationsApi.fetchNotifications).toHaveBeenLastCalledWith(null, 25);
  });

  it('uses unfilled hairline rows with readable titles and time', async () => {
    const ui = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(ui.getByText('Coach note available')).toBeTruthy());
    const row = ui.getByRole('button', { name: /Unread. Coach note available/ });
    const style = StyleSheet.flatten(row.props.style);
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
    expect(StyleSheet.flatten(ui.getByText('Coach note available').props.style).fontSize).toBe(15);
    expect(ui.getByText('Coach note available').props.numberOfLines).toBeUndefined();
  });

  it('stops loading and explains a failed next page without losing rows', async () => {
    (notificationsApi.fetchNotifications as jest.Mock).mockResolvedValueOnce({ items: [
      { id: 'read', kind: 'system', title: 'Update', body: 'Details', read: true, createdAt: new Date().toISOString() },
    ], nextCursor: 'page2' }).mockRejectedValueOnce(new Error('network'));
    const ui = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(ui.getByText('Update')).toBeTruthy());
    expect(ui.queryByRole('button', { name: 'Update. Details' })).toBeNull();
    const { FlatList } = jest.requireActual('react-native');
    await act(async () => ui.UNSAFE_getByType(FlatList).props.onEndReached());
    expect(ui.getByText('Could not load more notifications. Pull down to try again.')).toBeTruthy();
    expect(ui.getByText('Update')).toBeTruthy();
    expect(ui.queryByLabelText('Loading more notifications')).toBeNull();
  });

  it('keeps the role-aware router authoritative and read targets navigable', async () => {
    (routeInAppNotification as jest.Mock).mockReturnValueOnce(true);
    (notificationsApi.fetchNotifications as jest.Mock).mockResolvedValue({ items: [
      { id: 'read', kind: 'message', title: 'Message', body: 'Details', read: true,
        createdAt: new Date().toISOString(), actionScreen: 'Messages' },
    ], nextCursor: null });
    const ui = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(ui.getByText('Message')).toBeTruthy());
    await fireEvent.press(ui.getByText('Message'));
    expect(routeInAppNotification).toHaveBeenCalledWith('Messages', undefined);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(notificationsApi.markNotificationRead).not.toHaveBeenCalled();
  });
});

describe('NotificationPreferencesScreen', () => {
  const FULL_PREFS = {
    muteAll: false,
    quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
    channels: {
      coach:      { email: true, push: true, in_app: true },
      milestone:  { email: true, push: true, in_app: true },
      check_in:   { email: true, push: true, in_app: true },
      message:    { email: true, push: true, in_app: true },
      build_week: { email: true, push: true, in_app: true },
      system:     { email: true, push: true, in_app: true },
      reminder:   { email: true, push: true, in_app: true },
      tip:        { email: true, push: true, in_app: true },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (notificationsApi.fetchNotificationPreferences as jest.Mock).mockResolvedValue(
      JSON.parse(JSON.stringify(FULL_PREFS)),
    );
    // The real save endpoint returns the persisted, complete preferences object;
    // the component does setPrefs(saved) with it. v14 flushes that post-save
    // re-render synchronously, so the mock must echo a COMPLETE prefs object
    // (merged with the update) rather than `{}` — otherwise prefs.quietHours is
    // undefined on re-render. This mirrors the API contract.
    // B-NOTIF-6: the screen sends only what changed; the API returns the
    // complete prefs with that change applied per kind and channel.
    (notificationsApi.saveNotificationPreferences as jest.Mock).mockImplementation(
      async (updated: { muteAll?: boolean; channels?: Record<string, Record<string, boolean>> }) => {
        const full = JSON.parse(JSON.stringify(FULL_PREFS));
        if (typeof updated.muteAll === 'boolean') full.muteAll = updated.muteAll;
        for (const [kind, ch] of Object.entries(updated.channels ?? {})) {
          full.channels[kind] = { ...full.channels[kind], ...ch };
        }
        return full;
      },
    );
  });

  it('renders the kinds that have a backend switch, and only those (B-NOTIF-6)', async () => {
    const { getByText, queryByText } = await render(<NotificationPreferencesScreen />);

    await waitFor(() => {
      expect(getByText('Milestones')).toBeTruthy();
      expect(getByText('Check-in reminders')).toBeTruthy();
      expect(getByText('Direct messages')).toBeTruthy();
      expect(getByText('Build week gates')).toBeTruthy();
    });
    // No backend column: a switch here would change nothing.
    expect(queryByText('Coach messages')).toBeNull();
    expect(queryByText('Platform updates')).toBeNull();
    expect(queryByText('Habit reminders')).toBeNull();
    expect(queryByText('Coaching tips')).toBeNull();
  });

  it('states the fixed quiet hours, with no switch or time pickers (B-NOTIF-6)', async () => {
    const { getByText, queryByText, queryByLabelText } = await render(<NotificationPreferencesScreen />);

    await waitFor(() => {
      expect(getByText('Mute all notifications')).toBeTruthy();
      expect(getByText('Quiet hours, 9:00 PM to 8:00 AM')).toBeTruthy();
    });
    expect(
      getByText(
        'Your time. Notifications that arrive overnight wait until 8:00 AM. A reminder for a session that starts within the hour still comes through.',
      ),
    ).toBeTruthy();
    expect(queryByText('Enable quiet hours')).toBeNull();
    expect(queryByLabelText('Increase start time')).toBeNull();
    expect(queryByLabelText('Decrease end time')).toBeNull();
  });

  it('calls saveNotificationPreferences when mute-all is toggled', async () => {
    const { getAllByRole } = await render(<NotificationPreferencesScreen />);

    await waitFor(() => {
      const switches = getAllByRole('switch');
      expect(switches.length).toBeGreaterThan(0);
    });

    const switches = getAllByRole('switch');
    // Mute-all is the first switch.
    await act(async () => {
      await fireEvent(switches[0], 'valueChange', true);
    });

    await waitFor(() => {
      // B-NOTIF-6: only what changed is sent (no quietHours, no channels).
      expect(notificationsApi.saveNotificationPreferences).toHaveBeenCalledWith({ muteAll: true });
    });
  });

  it('a channel switch sends only that kind and channel (B-NOTIF-6)', async () => {
    const { getByLabelText } = await render(<NotificationPreferencesScreen />);
    await waitFor(() => expect(getByLabelText('Direct messages via Push')).toBeTruthy());
    await act(async () => {
      await fireEvent(getByLabelText('Direct messages via Push'), 'valueChange', false);
    });
    await waitFor(() => {
      expect(notificationsApi.saveNotificationPreferences).toHaveBeenCalledWith({
        channels: { message: { push: false } },
      });
    });
  });

  const httpError = (status: number, code: string, requestId?: string) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      isAxiosError: true,
      response: { status, data: { code }, headers: requestId ? { 'x-request-id': requestId } : {} },
    });

  it('a save with no answer puts the switch back and says the server could not be reached (B-341-2)', async () => {
    const offline = Object.assign(new Error('Network Error'), { isAxiosError: true });
    (notificationsApi.saveNotificationPreferences as jest.Mock).mockRejectedValueOnce(offline);
    const { getByLabelText, getByText } = await render(<NotificationPreferencesScreen />);
    await waitFor(() => expect(getByLabelText('Direct messages via Push')).toBeTruthy());
    await act(async () => {
      await fireEvent(getByLabelText('Direct messages via Push'), 'valueChange', false);
    });
    await waitFor(() =>
      expect(
        getByText(
          'Your direct messages push setting was not saved because the app could not reach the server, so it was left as it was. Check your connection, then try again.',
        ),
      ).toBeTruthy(),
    );
    expect(getByLabelText('Direct messages via Push').props.value).toBe(true);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('a signed-out save says to sign in again, not to check the connection (B-341-2)', async () => {
    (notificationsApi.saveNotificationPreferences as jest.Mock).mockRejectedValueOnce(
      httpError(401, 'SESSION_EXPIRED'),
    );
    const { getByLabelText, getByText } = await render(<NotificationPreferencesScreen />);
    await waitFor(() => expect(getByLabelText('Milestones via Push')).toBeTruthy());
    await act(async () => {
      await fireEvent(getByLabelText('Milestones via Push'), 'valueChange', false);
    });
    await waitFor(() =>
      expect(
        getByText('You were signed out, so your milestones push setting was not saved. Sign in again, then change it.'),
      ).toBeTruthy(),
    );
    expect(getByLabelText('Milestones via Push').props.value).toBe(true);
  });

  it('a server failure gives a reference and the support address, reports it, and shows the server row (B-341-2)', async () => {
    (notificationsApi.saveNotificationPreferences as jest.Mock).mockRejectedValueOnce(
      httpError(500, 'UNRECOGNIZED', 'req-abcdef123456'),
    );
    const { getByLabelText, getByTestId } = await render(<NotificationPreferencesScreen />);
    await waitFor(() => expect(getByLabelText('Direct messages via Push')).toBeTruthy());
    // The write reached the server before the error: the reload shows it.
    const stored = JSON.parse(JSON.stringify(FULL_PREFS));
    stored.channels.message.push = false;
    (notificationsApi.fetchNotificationPreferences as jest.Mock).mockResolvedValueOnce(stored);
    await act(async () => {
      await fireEvent(getByLabelText('Direct messages via Push'), 'valueChange', false);
    });
    await waitFor(() => expect(getByTestId('notification-prefs-save-failed')).toBeTruthy());
    const notice = String(getByTestId('notification-prefs-save-failed').props.children);
    expect(notice).toMatch(/^Your direct messages push setting could not be saved/);
    expect(notice).toMatch(/write to support at \S+@\S+/);
    expect(notice).toMatch(/reference \S+/);
    expect(notice).not.toMatch(/Check your connection/);
    expect(mockReport).toHaveBeenCalledWith('PATCH /notifications/preferences', expect.objectContaining({ status: 500 }));
    await waitFor(() => expect(getByLabelText('Direct messages via Push').props.value).toBe(false));
  });

  it('one save at a time: a second switch waits, and the first reply never turns it back (B-341-1)', async () => {
    let release: (v: unknown) => void = () => undefined;
    (notificationsApi.saveNotificationPreferences as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { getByLabelText } = await render(<NotificationPreferencesScreen />);
    await waitFor(() => expect(getByLabelText('Direct messages via Push')).toBeTruthy());
    await act(async () => {
      fireEvent(getByLabelText('Direct messages via Push'), 'valueChange', false);
    });
    // While the first save is in flight the switches wait.
    expect(getByLabelText('Milestones via Push').props.disabled).toBe(true);
    await act(async () => {
      fireEvent(getByLabelText('Milestones via Push'), 'valueChange', false);
    });
    expect(notificationsApi.saveNotificationPreferences).toHaveBeenCalledTimes(1);
    const afterFirst = JSON.parse(JSON.stringify(FULL_PREFS));
    afterFirst.channels.message.push = false;
    await act(async () => {
      release(afterFirst);
    });
    await waitFor(() => expect(getByLabelText('Milestones via Push').props.disabled).toBe(false));
    expect(getByLabelText('Direct messages via Push').props.value).toBe(false);
    expect(getByLabelText('Milestones via Push').props.value).toBe(true);
    // The next change is saved normally.
    await act(async () => {
      await fireEvent(getByLabelText('Milestones via Push'), 'valueChange', false);
    });
    await waitFor(() =>
      expect(notificationsApi.saveNotificationPreferences).toHaveBeenLastCalledWith({
        channels: { milestone: { push: false } },
      }),
    );
    expect(notificationsApi.saveNotificationPreferences).toHaveBeenCalledTimes(2);
  });

  it('mute all says email stops too, and the channel switches wait while it is on (C-341-3)', async () => {
    const { getByText, getByLabelText, getAllByRole } = await render(<NotificationPreferencesScreen />);
    await waitFor(() =>
      expect(
        getByText('Turns off all push, in-app and email notifications, session reminders included.'),
      ).toBeTruthy(),
    );
    await act(async () => {
      await fireEvent(getAllByRole('switch')[0], 'valueChange', true);
    });
    await waitFor(() => expect(getByLabelText('Direct messages via Email').props.disabled).toBe(true));
  });

  it('shows per-kind descriptions for accessibility', async () => {
    const { getByText } = await render(<NotificationPreferencesScreen />);

    await waitFor(() => {
      expect(getByText('Sent when a new direct message arrives in your coaching inbox.')).toBeTruthy();
    });
  });
});

describe('NotificationBadge', () => {
  it('renders "99+" for counts above 99', async () => {
    const { getByText } = await render(<NotificationBadge count={150} />);
    expect(getByText('99+')).toBeTruthy();
  });

  it('renders the exact count for values 1–99', async () => {
    const { getByText } = await render(<NotificationBadge count={5} />);
    expect(getByText('5')).toBeTruthy();
  });

  it('renders nothing when count is 0', async () => {
    const { toJSON } = await render(<NotificationBadge count={0} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when count is negative', async () => {
    const { toJSON } = await render(<NotificationBadge count={-3} />);
    expect(toJSON()).toBeNull();
  });

  it('renders "99" (not "99+") for exactly 99', async () => {
    const { getByText } = await render(<NotificationBadge count={99} />);
    expect(getByText('99')).toBeTruthy();
  });
});
