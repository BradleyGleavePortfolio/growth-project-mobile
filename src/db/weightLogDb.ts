import { getDatabase } from './database';
import { WeightLog } from '../types';
import { generateId } from '../utils/date';

export async function getWeightLogs(
  userId: string,
  limit: number = 30
): Promise<WeightLog[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<WeightLog>(
    'SELECT * FROM weight_logs WHERE userId = ? ORDER BY date DESC LIMIT ?',
    [userId, limit]
  );
  return rows;
}

export async function addWeightLog(data: {
  userId: string;
  coachId: string;
  date: string;
  weight: number;
  unit: 'lbs' | 'kg';
  notes?: string;
}): Promise<WeightLog> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = 'wlog_' + generateId();

  await db.runAsync(
    `INSERT INTO weight_logs (id, userId, coachId, date, weight, unit, notes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.userId, data.coachId, data.date, data.weight, data.unit, data.notes || null, now]
  );

  return { id, ...data, createdAt: now };
}

export async function getLatestWeight(userId: string): Promise<WeightLog | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<WeightLog>(
    'SELECT * FROM weight_logs WHERE userId = ? ORDER BY date DESC LIMIT 1',
    [userId]
  );
  return row || null;
}

export async function getWeightLogsForPeriod(
  userId: string,
  days: number
): Promise<WeightLog[]> {
  const db = await getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const rows = await db.getAllAsync<WeightLog>(
    'SELECT * FROM weight_logs WHERE userId = ? AND date >= ? ORDER BY date ASC',
    [userId, cutoffStr]
  );
  return rows;
}

export async function getAllWeightLogs(userId: string): Promise<WeightLog[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<WeightLog>(
    'SELECT * FROM weight_logs WHERE userId = ? ORDER BY date ASC',
    [userId]
  );
  return rows;
}
