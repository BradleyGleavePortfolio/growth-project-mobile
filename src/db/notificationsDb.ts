import { getDatabase } from './database';
import { generateId } from '../utils/date';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  type: 'reminder' | 'achievement' | 'coach' | 'system' | 'streak' | 'tip';
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
      title: 'Welcome to Growth Project!',
      body: 'Start logging your meals to track your nutrition and reach your goals.',
      hoursAgo: 0,
    },
    {
      type: 'tip' as const,
      title: 'Hydration Tip',
      body: 'Aim for at least 64oz of water daily. Your body needs it for optimal metabolism!',
      hoursAgo: 2,
    },
    {
      type: 'reminder' as const,
      title: 'Log Your Breakfast',
      body: "Don't forget to log your morning meal. Consistent tracking leads to better results!",
      hoursAgo: 5,
    },
    {
      type: 'achievement' as const,
      title: 'Profile Complete!',
      body: "You've completed your profile setup. Your personalized targets are now active.",
      hoursAgo: 12,
    },
    {
      type: 'coach' as const,
      title: 'Message from Your Coach',
      body: "Welcome aboard! I'm here to help you reach your goals. Feel free to ask me anything.",
      hoursAgo: 24,
    },
    {
      type: 'tip' as const,
      title: 'Protein Power',
      body: 'Getting enough protein helps preserve muscle while losing fat. Aim for 0.8-1g per pound of bodyweight.',
      hoursAgo: 36,
    },
    {
      type: 'streak' as const,
      title: 'Start a Streak!',
      body: 'Log your meals for 3 consecutive days to start a logging streak. Consistency is key!',
      hoursAgo: 48,
    },
    {
      type: 'tip' as const,
      title: 'Sleep & Recovery',
      body: 'Getting 7-9 hours of sleep helps regulate hunger hormones and supports muscle recovery.',
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
