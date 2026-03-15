import { getDatabase } from './database';
import { FastingSession } from '../types';
import { generateId } from '../utils/date';

export async function startFast(
  userId: string,
  coachId: string,
  targetHours: number
): Promise<string> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = 'fast_' + generateId();

  await db.runAsync(
    `INSERT INTO fasting_sessions (id, userId, coachId, startTime, targetHours, completed, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [id, userId, coachId, now, targetHours, now]
  );

  return id;
}

export async function endFast(id: string, userId: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  const session = await db.getFirstAsync<FastingSession>(
    'SELECT * FROM fasting_sessions WHERE id = ? AND userId = ?',
    [id, userId]
  );

  if (!session) return;

  const startMs = new Date(session.startTime).getTime();
  const endMs = new Date(now).getTime();
  const elapsedHours = (endMs - startMs) / (1000 * 60 * 60);
  const completed = elapsedHours >= session.targetHours * 0.9 ? 1 : 0;

  await db.runAsync(
    'UPDATE fasting_sessions SET endTime = ?, completed = ? WHERE id = ? AND userId = ?',
    [now, completed, id, userId]
  );
}

export async function getActiveFast(userId: string): Promise<FastingSession | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM fasting_sessions WHERE userId = ? AND endTime IS NULL ORDER BY startTime DESC LIMIT 1',
    [userId]
  );
  if (!row) return null;
  return { ...row, completed: !!row.completed };
}

export async function getFastingHistory(
  userId: string,
  limit: number = 10
): Promise<FastingSession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM fasting_sessions WHERE userId = ? AND endTime IS NOT NULL ORDER BY startTime DESC LIMIT ?',
    [userId, limit]
  );
  return rows.map((r: any) => ({ ...r, completed: !!r.completed }));
}

export async function getFastingStreak(userId: string): Promise<number> {
  const history = await getFastingHistory(userId, 100);
  let streak = 0;
  for (const session of history) {
    if (session.completed) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export async function getFastingStats(userId: string): Promise<{
  longestHours: number;
  averageHours: number;
  totalCompleted: number;
}> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT startTime, endTime FROM fasting_sessions WHERE userId = ? AND endTime IS NOT NULL AND completed = 1',
    [userId]
  );

  if (rows.length === 0) {
    return { longestHours: 0, averageHours: 0, totalCompleted: 0 };
  }

  let longest = 0;
  let total = 0;
  for (const row of rows) {
    const hours = (new Date(row.endTime).getTime() - new Date(row.startTime).getTime()) / (1000 * 60 * 60);
    total += hours;
    if (hours > longest) longest = hours;
  }

  return {
    longestHours: longest,
    averageHours: total / rows.length,
    totalCompleted: rows.length,
  };
}
