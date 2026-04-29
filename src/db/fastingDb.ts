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

// `getFastingStreak` and `getFastingStats` were removed in the doctrine
// wave-2 sweep. The former returned a consecutive-completed-fasts count and
// the latter aggregated session totals; neither had any non-test consumer
// after the wave-1 surface clean-up. If a future surface needs these, it
// should pull from the server-side fasting endpoints rather than recomputing
// in the local SQLite cache.
