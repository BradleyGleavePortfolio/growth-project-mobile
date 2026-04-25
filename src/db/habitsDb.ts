import { getDatabase } from './database';
import { generateId, getTodayString } from '../utils/date';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Habit {
  id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  frequency: 'daily' | 'weekdays' | 'weekends' | 'custom';
  targetCount: number;
  unit: string;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
}

export interface HabitLog {
  id: string;
  habitId: string;
  userId: string;
  date: string;
  count: number;
  completed: boolean;
  createdAt: string;
}

export interface DailyCheckIn {
  id: string;
  userId: string;
  date: string;
  mood: number; // 1-5
  energyLevel: number; // 1-5
  sleepHours: number;
  sleepQuality: number; // 1-5
  stressLevel: number; // 1-5
  notes: string;
  createdAt: string;
}

// ── Init ───────────────────────────────────────────────────────────────────

export async function initHabitsTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'checkmark-circle',
      color TEXT NOT NULL DEFAULT '#2D6A4F',
      frequency TEXT NOT NULL DEFAULT 'daily',
      targetCount INTEGER NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'times',
      sortOrder INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(userId);

    CREATE TABLE IF NOT EXISTS habit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      habitId TEXT NOT NULL,
      userId TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON habit_logs(userId, date);
    CREATE INDEX IF NOT EXISTS idx_habit_logs_habit ON habit_logs(habitId, date);

    CREATE TABLE IF NOT EXISTS daily_checkins (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      date TEXT NOT NULL,
      mood INTEGER NOT NULL DEFAULT 3,
      energyLevel INTEGER NOT NULL DEFAULT 3,
      sleepHours REAL NOT NULL DEFAULT 7,
      sleepQuality INTEGER NOT NULL DEFAULT 3,
      stressLevel INTEGER NOT NULL DEFAULT 3,
      notes TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      UNIQUE(userId, date)
    );
    CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON daily_checkins(userId, date);
  `);
}

// ── Habits CRUD ────────────────────────────────────────────────────────────

export async function getHabits(userId: string): Promise<Habit[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM habits WHERE userId = ? AND archived = 0 ORDER BY sortOrder ASC',
    [userId]
  );
  return rows.map(mapHabit);
}

export async function createHabit(data: {
  userId: string;
  name: string;
  icon: string;
  color: string;
  frequency: Habit['frequency'];
  targetCount: number;
  unit: string;
}): Promise<Habit> {
  const db = await getDatabase();
  const id = 'habit_' + generateId();
  const now = new Date().toISOString();
  const maxOrder = await db.getFirstAsync<{ m: number }>(
    'SELECT MAX(sortOrder) as m FROM habits WHERE userId = ?',
    [data.userId]
  );
  const sortOrder = (maxOrder?.m || 0) + 1;
  await db.runAsync(
    `INSERT INTO habits (id, userId, name, icon, color, frequency, targetCount, unit, sortOrder, archived, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, data.userId, data.name, data.icon, data.color, data.frequency, data.targetCount, data.unit, sortOrder, now]
  );
  return { id, ...data, sortOrder, archived: false, createdAt: now };
}

export async function deleteHabit(habitId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE habits SET archived = 1 WHERE id = ?', [habitId]);
}

// ── Habit Logs ─────────────────────────────────────────────────────────────

export async function getHabitLogsForDate(userId: string, date: string): Promise<HabitLog[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM habit_logs WHERE userId = ? AND date = ?',
    [userId, date]
  );
  return rows.map(mapHabitLog);
}

export async function toggleHabit(
  userId: string,
  habitId: string,
  date: string,
  targetCount: number
): Promise<HabitLog> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<any>(
    'SELECT * FROM habit_logs WHERE habitId = ? AND date = ?',
    [habitId, date]
  );

  if (existing) {
    const newCount = existing.completed ? 0 : targetCount;
    const completed = !existing.completed;
    await db.runAsync(
      'UPDATE habit_logs SET count = ?, completed = ? WHERE id = ?',
      [newCount, completed ? 1 : 0, existing.id]
    );
    return { ...mapHabitLog(existing), count: newCount, completed };
  }

  const id = 'hlog_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO habit_logs (id, habitId, userId, date, count, completed, createdAt)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [id, habitId, userId, date, targetCount, now]
  );
  return { id, habitId, userId, date, count: targetCount, completed: true, createdAt: now };
}

export async function getHabitStreak(habitId: string, userId: string): Promise<number> {
  const db = await getDatabase();
  const today = getTodayString();
  let streak = 0;
  let checkDate = new Date(today + 'T00:00:00');

  for (let i = 0; i < 365; i++) {
    const dateStr = checkDate.toISOString().split('T')[0];
    const log = await db.getFirstAsync<any>(
      'SELECT completed FROM habit_logs WHERE habitId = ? AND userId = ? AND date = ? AND completed = 1',
      [habitId, userId, dateStr]
    );
    if (log) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export async function getWeekCompletions(userId: string, habitId: string): Promise<boolean[]> {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

  const db = await getDatabase();
  const result: boolean[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const log = await db.getFirstAsync<any>(
      'SELECT completed FROM habit_logs WHERE habitId = ? AND userId = ? AND date = ? AND completed = 1',
      [habitId, userId, dateStr]
    );
    result.push(!!log);
  }
  return result;
}

// ── Daily Check-ins ────────────────────────────────────────────────────────
//
// Local check-in helpers (getDailyCheckIn / saveDailyCheckIn / getCheckInHistory)
// were removed under Fix #2 — the server is the single source of truth and
// React Query (useTodayCheckIn / useSaveCheckIn) handles caching. The local
// `daily_checkins` table is still created above for schema compatibility with
// older device builds, but nothing reads or writes to it anymore.

// ── Seed ───────────────────────────────────────────────────────────────────
//
// seedHabitsIfNeeded() was removed under Fix #2 — a fresh install starts with
// no habits, the user adds the ones they want, and the backend stores them.
// Theatrical seeding of generic habits the user never opted into was confusing
// and made the data inconsistent with what the coach saw on their dashboard.

// ── Helpers ────────────────────────────────────────────────────────────────

function mapHabit(row: any): Habit {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    icon: row.icon,
    color: row.color,
    frequency: row.frequency,
    targetCount: row.targetCount,
    unit: row.unit,
    sortOrder: row.sortOrder,
    archived: !!row.archived,
    createdAt: row.createdAt,
  };
}

function mapHabitLog(row: any): HabitLog {
  return {
    id: row.id,
    habitId: row.habitId,
    userId: row.userId,
    date: row.date,
    count: row.count,
    completed: !!row.completed,
    createdAt: row.createdAt,
  };
}

function mapCheckIn(row: any): DailyCheckIn {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    mood: row.mood,
    energyLevel: row.energyLevel,
    sleepHours: row.sleepHours,
    sleepQuality: row.sleepQuality,
    stressLevel: row.stressLevel,
    notes: row.notes || '',
    createdAt: row.createdAt,
  };
}
