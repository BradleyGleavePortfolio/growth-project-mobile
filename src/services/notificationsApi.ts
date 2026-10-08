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
import api from './api';

let _lastKnownUnreadCount = 0;

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

/** The quiet hours the backend enforces, in the recipient's own zone. */
export const QUIET_HOURS = { enabled: true, startTime: '21:00', endTime: '08:00' } as const;

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
    quietHours: { ...QUIET_HOURS },
  };
}

// ─── Backend preferences mapping (B-NOTIF-6) ─────────────────────────────────
//
// GET/PATCH /notifications/preferences speak flat columns
// (`muted`, `<prefix>_push`, `<prefix>_inapp`, `<prefix>_email`) and the
// backend rejects any other key (forbidNonWhitelisted). The screen model
// above is nested, so the live path maps both ways. Kinds without a backend
// switch are not offered (KIND_PREFS_PREFIX), and quiet hours are never sent:
// the backend applies one fixed window to everyone (OR-113-5, QUIET_HOURS).

/** Backend column prefix for each kind that has a real switch. */
export const KIND_PREFS_PREFIX: Partial<Record<NotificationKind, string>> = {
  message: 'message',
  milestone: 'milestone',
  check_in: 'missed_checkin',
  build_week: 'build_week',
};

const CHANNEL_SUFFIX: Record<NotificationChannel, string> = {
  push: 'push',
  in_app: 'inapp',
  email: 'email',
};

/** Flat backend row -> screen model. A missing or non-boolean column reads as on (the schema default). */
export function preferencesFromBackend(row: unknown): NotificationPreferences {
  const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const prefs = defaultPreferences();
  prefs.muteAll = r.muted === true;
  for (const kind of ALL_KINDS) {
    const prefix = KIND_PREFS_PREFIX[kind];
    if (!prefix) continue;
    for (const channel of Object.keys(CHANNEL_SUFFIX) as NotificationChannel[]) {
      const v = r[`${prefix}_${CHANNEL_SUFFIX[channel]}`];
      prefs.channels[kind][channel] = typeof v === 'boolean' ? v : true;
    }
  }
  return prefs;
}

/**
 * Screen update -> flat PATCH body: `muted` and the columns of kinds that
 * have a backend switch. Quiet hours and unmapped kinds are never sent.
 */
export function preferencesToBackend(updates: Partial<NotificationPreferences>): Record<string, boolean> {
  const body: Record<string, boolean> = {};
  if (typeof updates.muteAll === 'boolean') body.muted = updates.muteAll;
  for (const [kind, channels] of Object.entries(updates.channels ?? {}) as Array<
    [NotificationKind, Partial<Record<NotificationChannel, boolean>> | undefined]
  >) {
    const prefix = KIND_PREFS_PREFIX[kind];
    if (!prefix || !channels) continue;
    for (const channel of Object.keys(CHANNEL_SUFFIX) as NotificationChannel[]) {
      const v = channels[channel];
      if (typeof v === 'boolean') body[`${prefix}_${CHANNEL_SUFFIX[channel]}`] = v;
    }
  }
  return body;
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

// ─── Live row normalizer ──────────────────────────────────────────────────────
//
// S-SCHED-2: the live GET /notifications returns backend rows
//   { id, kind, body, payload: { title, actionScreen, actionParams, ... },
//     deep_link, read_at, created_at }
// while this module's callers read AppNotification. Normalise every item so
// the center shows the real title and routes a tap (booking rows carry
// actionScreen CalendarSession / CoachBookingInbox + { sessionId }). Items
// already in AppNotification shape pass through unchanged.

const SCREEN_NAME = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const PARAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : null;
}

function appKindFor(kind: string): NotificationKind {
  const known = ALL_KINDS.find((k) => k === kind);
  if (known) return known;
  if (kind.startsWith('booking_reminder')) return 'reminder';
  if (kind.startsWith('booking_')) return 'coach';
  if (kind.includes('message')) return 'message';
  return 'system';
}

function defaultTitleFor(kind: string): string {
  if (kind === 'workout_assigned') return 'New workout';
  if (kind.startsWith('booking_reminder')) return 'Session reminder';
  if (kind.startsWith('booking_')) return 'Calendar update';
  // MONEY-INBOX-130: money rows carry no payload.title; each gets its push title.
  if (kind === 'drip_released') return 'New content';
  if (kind === 'trial_ending') return 'Your free trial';
  if (kind === 'dunning_blocker') return 'Payment';
  if (kind === 'coach_new_purchase') return 'New purchase';
  return 'Update';
}

function stringParams(raw: unknown): Record<string, string> | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec).slice(0, 8)) {
    if (!PARAM_KEY.test(k)) continue;
    if (typeof v === 'string' && v.length <= 200) out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * AUDIT-09-125: only booking rows carry an actionScreen, so tapping a message,
 * workout reminder, content or community row did nothing. Rows without one
 * open the screen their kind belongs to (the push router keeps the role and
 * flag checks); other kinds stay in the center.
 */
export function inboxScreenForKind(kind: string): string | undefined {
  if (kind.startsWith('community_')) return 'Community';
  if (kind.startsWith('message')) return 'Messages';
  // FU-WORKLOG-126: "Your coach assigned a new workout." opens Workouts,
  // where the From your coach card is (the row used to do nothing).
  if (kind === 'workout_reminder' || kind === 'workout_assigned') return 'WorkoutMain';
  if (kind === 'drip_released') return 'Deliverables';
  return undefined;
}

/** Backend row or AppNotification -> AppNotification; null when unusable. */
export function normalizeNotification(raw: unknown): AppNotification | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== 'string' || r.id.length === 0) return null;
  const rawKind = typeof r.kind === 'string' ? r.kind : 'system';
  const payload = asRecord(r.payload) ?? {};
  // MONEY-INBOX-130: the Day 3, Day 7 and dispute payment blocker names
  // itself in payload.headline and opens the card screen. The full-refund
  // notice (same kind, no headline) stays a plain row.
  const blockerHeadline =
    rawKind === 'dunning_blocker' && typeof payload.headline === 'string' && payload.headline.trim()
      ? payload.headline
      : null;
  const title =
    typeof r.title === 'string' && r.title.trim()
      ? r.title
      : typeof payload.title === 'string' && payload.title.trim()
        ? payload.title
        : blockerHeadline ?? defaultTitleFor(rawKind);
  const body = typeof r.body === 'string' ? r.body : '';
  const read =
    typeof r.read === 'boolean' ? r.read : r.read_at !== null && r.read_at !== undefined;
  const createdRaw = typeof r.createdAt === 'string' ? r.createdAt : r.created_at;
  const createdAt =
    typeof createdRaw === 'string' && !Number.isNaN(Date.parse(createdRaw))
      ? createdRaw
      : new Date(0).toISOString();
  const screenRaw = typeof r.actionScreen === 'string' ? r.actionScreen : payload.actionScreen;
  const actionScreen =
    typeof screenRaw === 'string' && SCREEN_NAME.test(screenRaw)
      ? screenRaw
      : blockerHeadline
        ? 'UpdateCard'
        : inboxScreenForKind(rawKind);
  // MONEY-INBOX-130: "New content unlocked" opens that purchase's
  // Deliverables; without the id the screen says no content is listed.
  const actionParams =
    stringParams(r.actionParams ?? payload.actionParams) ??
    (rawKind === 'drip_released' && actionScreen === 'Deliverables'
      ? stringParams({ purchaseId: payload.client_purchase_id })
      : undefined);
  return {
    id: r.id,
    kind: appKindFor(rawKind),
    title,
    body,
    read,
    createdAt,
    ...(actionScreen ? { actionScreen } : {}),
    ...(actionParams ? { actionParams } : {}),
  };
}

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
    const q = new URLSearchParams();
    if (cursor) q.set('cursor', cursor);
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    const res = await api.get<{ items?: unknown; nextCursor?: unknown }>(
      `/notifications${qs ? `?${qs}` : ''}`,
    );
    const items = Array.isArray(res.data?.items) ? res.data.items : [];
    return {
      items: items
        .map(normalizeNotification)
        .filter((n): n is AppNotification => n !== null),
      nextCursor: typeof res.data?.nextCursor === 'string' ? res.data.nextCursor : null,
    };
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
    try {
      const res = await api.get<{ count: number }>('/notifications/unread-count');
      _lastKnownUnreadCount = Number(res.data?.count ?? 0);
      return _lastKnownUnreadCount;
    } catch {
      // Badge polling must never throw — return the last known count so the
      // badge does not reset silently on a transient network error.
      return _lastKnownUnreadCount;
    }
  }
  await simulateLatency();
  return MOCK_STORE.notifications.filter((n) => !n.read).length;
}

/**
 * Marks a single notification as read. Idempotent.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  if (!NOTIFICATIONS_MOCK_ENABLED) {
    await api.post(`/notifications/${encodeURIComponent(notificationId)}/read`);
    return;
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
    await api.post('/notifications/mark-all-read');
    return;
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
    const res = await api.get<unknown>('/notifications/preferences');
    return preferencesFromBackend(res.data);
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
    const res = await api.patch<unknown>(
      '/notifications/preferences',
      preferencesToBackend(updates),
    );
    return preferencesFromBackend(res.data);
  }
  await simulateLatency();
  MOCK_STORE.preferences = {
    ...MOCK_STORE.preferences,
    ...updates,
    // Per kind, so a one-channel update keeps the other channels.
    channels: Object.fromEntries(
      Object.entries(MOCK_STORE.preferences.channels).map(([kind, current]) => [
        kind,
        { ...current, ...(updates.channels?.[kind as NotificationKind] ?? {}) },
      ]),
    ) as NotificationPreferences['channels'],
    // Quiet hours are fixed (QUIET_HOURS); an update never changes them.
    quietHours: { ...QUIET_HOURS },
  };
  return JSON.parse(JSON.stringify(MOCK_STORE.preferences)) as NotificationPreferences;
}
