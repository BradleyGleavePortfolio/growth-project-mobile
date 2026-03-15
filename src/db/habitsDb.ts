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

export async function getDailyCheckIn(userId: string, date: string): Promise<DailyCheckIn | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM daily_checkins WHERE userId = ? AND date = ?',
    [userId, date]
  );
  return row ? mapCheckIn(row) : null;
}

export async function saveDailyCheckIn(data: {
  userId: string;
  date: string;
  mood: number;
  energyLevel: number;
  sleepHours: number;
  sleepQuality: number;
  stressLevel: number;
  notes: string;
}): Promise<DailyCheckIn> {
  const db = await getDatabase();
  const existing = await getDailyCheckIn(data.userId, data.date);

  if (existing) {
    await db.runAsync(
      `UPDATE daily_checkins SET mood = ?, energyLevel = ?, sleepHours = ?, sleepQuality = ?, stressLevel = ?, notes = ?
       WHERE userId = ? AND date = ?`,
      [data.mood, data.energyLevel, data.sleepHours, data.sleepQuality, data.stressLevel, data.notes, data.userId, data.date]
    );
    return { ...existing, ...data };
  }

  const id = 'checkin_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO daily_checkins (id, userId, date, mood, energyLevel, sleepHours, sleepQuality, stressLevel, notes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.userId, data.date, data.mood, data.energyLevel, data.sleepHours, data.sleepQuality, data.stressLevel, data.notes, now]
  );
  return { id, ...data, createdAt: now };
}

export async function getCheckInHistory(userId: string, days = 30): Promise<DailyCheckIn[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM daily_checkins WHERE userId = ? ORDER BY date DESC LIMIT ?',
    [userId, days]
  );
  return rows.map(mapCheckIn);
}

// ── Seed ───────────────────────────────────────────────────────────────────

export async function seedHabitsIfNeeded(userId: string): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM habits WHERE userId = ?',
    [userId]
  );
  if ((existing?.count || 0) > 0) return;

  const defaults = [
    { name: 'Drink Water', icon: 'water', color: '#4ECDC4', frequency: 'daily', targetCount: 8, unit: 'glasses' },
    { name: 'Take Vitamins', icon: 'medical', color: '#E76F51', frequency: 'daily', targetCount: 1, unit: 'times' },
    { name: 'Eat Vegetables', icon: 'leaf', color: '#2D6A4F', frequency: 'daily', targetCount: 3, unit: 'servings' },
    { name: '10k Steps', icon: 'walk', color: '#E9C46A', frequency: 'daily', targetCount: 1, unit: 'times' },
    { name: 'Stretch', icon: 'body', color: '#52B788', frequency: 'daily', targetCount: 1, unit: 'times' },
    { name: 'No Sugar', icon: 'close-circle', color: '#E63946', frequency: 'daily', targetCount: 1, unit: 'times' },
    { name: 'Read 20 min', icon: 'book', color: '#264653', frequency: 'daily', targetCount: 1, unit: 'times' },
    { name: 'Meditate', icon: 'happy', color: '#A78BFA', frequency: 'daily', targetCount: 1, unit: 'times' },
  ];

  for (let i = 0; i < defaults.length; i++) {
    const h = defaults[i];
    const id = 'habit_' + generateId();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO habits (id, userId, name, icon, color, frequency, targetCount, unit, sortOrder, archived, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, userId, h.name, h.icon, h.color, h.frequency as string, h.targetCount, h.unit, i + 1, now]
    );
  }
}

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
