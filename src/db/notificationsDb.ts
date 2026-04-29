import { getDatabase } from './database';
import { generateId } from '../utils/date';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  type: 'reminder' | 'milestone' | 'coach' | 'system' | 'tip';
  title: string;
  body: string;
  read: boolean;
  actionType?: string;
  actionData?: string;
  createdAt: string;
}

// ── Init ───────────────────────────────────────────────────────────────────

export async function initNotificationsTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      actionType TEXT,
      actionData TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, createdAt);
  `);
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function getNotifications(userId: string, limit = 50): Promise<Notification[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
    [userId, limit]
  );
  return rows.map(mapNotification);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM notifications WHERE userId = ? AND read = 0',
    [userId]
  );
  return row?.count || 0;
}

export async function createNotification(data: {
  userId: string;
  type: Notification['type'];
  title: string;
  body: string;
  actionType?: string;
  actionData?: string;
}): Promise<Notification> {
  const db = await getDatabase();
  const id = 'notif_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO notifications (id, userId, type, title, body, read, actionType, actionData, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [id, data.userId, data.type, data.title, data.body, data.actionType || null, data.actionData || null, now]
  );
  return {
    id,
    userId: data.userId,
    type: data.type,
    title: data.title,
    body: data.body,
    read: false,
    actionType: data.actionType,
    actionData: data.actionData,
    createdAt: now,
  };
}

export async function markAsRead(notificationId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE notifications SET read = 1 WHERE id = ?', [notificationId]);
}

export async function markAllAsRead(userId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE notifications SET read = 1 WHERE userId = ? AND read = 0', [userId]);
}

export async function deleteNotification(notificationId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM notifications WHERE id = ?', [notificationId]);
}

export async function seedNotificationsIfNeeded(userId: string): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM notifications WHERE userId = ?',
    [userId]
  );
  if ((existing?.count || 0) > 0) return;

  const now = new Date();
  const notifications = [
    {
      type: 'system' as const,
      title: 'Welcome to Growth Project',
      body: 'Start logging your meals to track your nutrition and reach your fitness goals. Your personalized calorie and macro targets are ready.',
      hoursAgo: 0,
    },
    {
      type: 'tip' as const,
      title: 'Hydration Reminder',
      body: 'Aim for at least 64oz of water daily. Proper hydration supports metabolism and workout recovery.',
      hoursAgo: 2,
    },
    {
      type: 'reminder' as const,
      title: 'Log Your Breakfast',
      body: "Tracking your morning meal helps set the tone for your macros all day. Consistent logging leads to 2x better results",
      hoursAgo: 5,
    },
    {
      type: 'milestone' as const,
      title: 'Profile Complete',
      body: "Your personalized calorie target and macro split are now active based on your goals and activity level.",
      hoursAgo: 12,
    },
    {
      type: 'coach' as const,
      title: 'Welcome from Your Coach',
      body: "I've reviewed your profile and goals. Let's build a plan that works for your schedule and preferences.",
      hoursAgo: 24,
    },
    {
      type: 'tip' as const,
      title: 'Hit Your Protein Target',
      body: 'Protein is key for muscle recovery and satiety. Try adding Greek yogurt, eggs, or a protein shake to hit your daily 0.8-1g per pound goal.',
      hoursAgo: 36,
    },
    {
      type: 'reminder' as const,
      title: 'Build the habit.',
      body: 'Log your meals three days in a row. Consistency over three days becomes a habit.',
      hoursAgo: 48,
    },
    {
      type: 'tip' as const,
      title: 'Sleep Powers Your Gains',
      body: 'Getting 7-9 hours of quality sleep regulates hunger hormones, supports muscle repair, and improves workout performance.',
      hoursAgo: 72,
    },
  ];

  for (const n of notifications) {
    const id = 'notif_' + generateId();
    const createdAt = new Date(now.getTime() - n.hoursAgo * 60 * 60 * 1000).toISOString();
    await db.runAsync(
      `INSERT INTO notifications (id, userId, type, title, body, read, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, n.type, n.title, n.body, n.hoursAgo > 24 ? 1 : 0, createdAt]
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mapNotification(row: any): Notification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    body: row.body,
    read: !!row.read,
    actionType: row.actionType || undefined,
    actionData: row.actionData || undefined,
    createdAt: row.createdAt,
  };
}
