// Phase 9 — Notification Center API wrapper.
//
// Status: MOCKED — backend Phase 9 PR is not yet open. All data is sourced
// from a deterministic in-memory seed. Once the backend ships, replace the
// mock implementations with real axios calls to the endpoints listed in the
// README. The public interface is intentionally identical to the planned live
// shape so callers need no changes at that point.
//
// Endpoints (planned, not yet live):
//   GET    /notifications?cursor=&limit=     — paginated list
//   PATCH  /notifications/:id/read           — mark single read
//   PATCH  /notifications/read-all           — mark all read
//   GET    /notifications/preferences        — fetch channel prefs + quiet hours
//   PUT    /notifications/preferences        — save channel prefs + quiet hours
//   GET    /notifications/unread-count       — lightweight badge count
//
// Deep-link routing: actionType maps to a screen name in the navigator.
// See README.md for the full routing table.

import { NOTIFICATIONS_MOCK_ENABLED } from '../config/featureFlags';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationKind =
  | 'coach'
  | 'milestone'
  | 'check_in'
  | 'message'
  | 'build_week'
  | 'system'
  | 'reminder'
  | 'tip';

export type NotificationChannel = 'email' | 'push' | 'in_app';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /**
   * Navigator screen name the notification routes to when tapped.
   * Undefined means the notification has no destination (informational only).
   */
  actionScreen?: string;
  /** Serialisable params passed to the target screen. */
  actionParams?: Record<string, string>;
}

export interface NotificationPage {
  items: AppNotification[];
  /** Opaque cursor for the next page. Null when the list is exhausted. */
  nextCursor: string | null;
}

export interface NotificationPreferences {
  /** Per-kind, per-channel toggles. True = enabled. */
  channels: Record<NotificationKind, Record<NotificationChannel, boolean>>;
  /** When true, all push and in-app notifications are suppressed. */
  muteAll: boolean;
  quietHours: {
    enabled: boolean;
    /** 24-hour format, e.g. "22:00". */
    startTime: string;
    /** 24-hour format, e.g. "07:00". */
    endTime: string;
  };
}

// ─── Default preferences ─────────────────────────────────────────────────────

const ALL_KINDS: NotificationKind[] = [
  'coach',
  'milestone',
  'check_in',
  'message',
  'build_week',
  'system',
  'reminder',
  'tip',
];

function defaultPreferences(): NotificationPreferences {
  const channels = {} as Record<NotificationKind, Record<NotificationChannel, boolean>>;
  for (const kind of ALL_KINDS) {
    channels[kind] = { email: true, push: true, in_app: true };
  }
  return {
    channels,
    muteAll: false,
    quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
  };
}

// ─── Mock data store ──────────────────────────────────────────────────────────
// Mutable in-process store — simulates server state for development.
// Replaced entirely when NOTIFICATIONS_MOCK_ENABLED flips to false.

const MOCK_STORE: {
  notifications: AppNotification[];
  preferences: NotificationPreferences;
} = {
  notifications: [
    {
      id: 'n_001',
      kind: 'coach',
      title: 'New note from your coach',
      body: 'Your coach left feedback on this week\'s check-in. Tap to review.',
      read: false,
      createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      actionScreen: 'Notifications',
      actionParams: {},
    },
    {
      id: 'n_002',
      kind: 'milestone',
      title: '7-day check-in milestone',
      body: 'You have logged seven consecutive check-ins. Consistent data is the foundation.',
      read: false,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      actionScreen: 'Timeline',
      actionParams: {},
    },
    {
      id: 'n_003',
      kind: 'message',
      title: 'Message from your coach',
      body: 'A new message is waiting in your inbox.',
      read: false,
      createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      actionScreen: 'Messages',
      actionParams: {},
    },
    {
      id: 'n_004',
      kind: 'build_week',
      title: 'Day 3 is now unlocked',
      body: 'Your coach has reviewed Day 2. Income setup begins today.',
      read: false,
      createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      actionScreen: 'MoreIndex',
      actionParams: {},
    },
    {
      id: 'n_005',
      kind: 'check_in',
      title: 'Check-in reminder',
      body: 'You have not submitted today\'s check-in. Logging takes under two minutes.',
      read: true,
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'n_006',
      kind: 'tip',
      title: 'Protein window',
      body: 'Consuming 20–40 g of protein within two hours of training supports muscle protein synthesis.',
      read: true,
      createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'n_007',
      kind: 'system',
      title: 'Welcome to The Growth Project',
      body: 'Your account is active. Start your day 1 log to begin tracking.',
      read: true,
      createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'n_008',
      kind: 'reminder',
      title: 'Weight log overdue',
      body: 'You have not logged your weight in 5 days. Weekly data points give your coach the signal they need.',
      read: true,
      createdAt: new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString(),
    },
  ],
  preferences: defaultPreferences(),
};

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function simulateLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Fetches a page of notifications, newest first.
 * cursor=null fetches the first page.
 */
export async function fetchNotifications(
  cursor: string | null = null,
  limit = 25,
): Promise<NotificationPage> {
  if (!NOTIFICATIONS_MOCK_ENABLED) {
    // Live path — import api from './api' and call real endpoint.
    throw new Error('Live notifications API not yet wired. Set NOTIFICATIONS_MOCK_ENABLED=true.');
  }

  await simulateLatency();

  const sorted = [...MOCK_STORE.notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  let startIndex = 0;
  if (cursor) {
    const idx = sorted.findIndex((n) => n.id === cursor);
    startIndex = idx >= 0 ? idx + 1 : 0;
  }

  const page = sorted.slice(startIndex, startIndex + limit);
  const lastInPage = page[page.length - 1];
  const hasMore = startIndex + limit < sorted.length;

  return {
    items: page,
    nextCursor: hasMore && lastInPage ? lastInPage.id : null,
  };
}

/**
 * Returns the count of unread notifications. Lightweight — suitable for
 * badge polling on a 30-second interval.
 */
export async function fetchUnreadCount(): Promise<number> {
  if (!NOTIFICATIONS_MOCK_ENABLED) {
    throw new Error('Live notifications API not yet wired.');
  }
  await simulateLatency();
  return MOCK_STORE.notifications.filter((n) => !n.read).length;
}

/**
 * Marks a single notification as read. Idempotent.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  if (!NOTIFICATIONS_MOCK_ENABLED) {
    throw new Error('Live notifications API not yet wired.');
  }
  await simulateLatency();
  const notif = MOCK_STORE.notifications.find((n) => n.id === notificationId);
  if (notif) {
    notif.read = true;
  }
}

/**
 * Marks all notifications as read.
 */
export async function markAllNotificationsRead(): Promise<void> {
  if (!NOTIFICATIONS_MOCK_ENABLED) {
    throw new Error('Live notifications API not yet wired.');
  }
  await simulateLatency();
  MOCK_STORE.notifications.forEach((n) => {
    n.read = true;
  });
}

/**
 * Fetches the user's notification preferences.
 */
export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  if (!NOTIFICATIONS_MOCK_ENABLED) {
    throw new Error('Live notifications API not yet wired.');
  }
  await simulateLatency();
  // Deep-clone so callers cannot mutate the store directly.
  return JSON.parse(JSON.stringify(MOCK_STORE.preferences)) as NotificationPreferences;
}

/**
 * Persists updated notification preferences. Partial update is supported —
 * only provided keys are merged.
 */
export async function saveNotificationPreferences(
  updates: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  if (!NOTIFICATIONS_MOCK_ENABLED) {
    throw new Error('Live notifications API not yet wired.');
  }
  await simulateLatency();
  MOCK_STORE.preferences = {
    ...MOCK_STORE.preferences,
    ...updates,
    channels: {
      ...MOCK_STORE.preferences.channels,
      ...(updates.channels ?? {}),
    },
    quietHours: {
      ...MOCK_STORE.preferences.quietHours,
      ...(updates.quietHours ?? {}),
    },
  };
  return JSON.parse(JSON.stringify(MOCK_STORE.preferences)) as NotificationPreferences;
}
