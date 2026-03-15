import { getDatabase } from './database';
import { WaterLog } from '../types';
import { generateId } from '../utils/date';

export async function getWaterLogByDate(
  userId: string,
  date: string
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM water_logs WHERE userId = ? AND date = ?`,
    [userId, date]
  );
  return row?.total || 0;
}

export async function addWaterLog(data: {
  userId: string;
  coachId: string;
  date: string;
  amount: number;
  unit?: string;
}): Promise<WaterLog> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = 'wtr_' + generateId();

  await db.runAsync(
    `INSERT INTO water_logs (id, userId, coachId, date, amount, unit, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.userId, data.coachId, data.date, data.amount, data.unit || 'oz', now]
  );

  return {
    id,
    userId: data.userId,
    coachId: data.coachId,
    date: data.date,
    amount: data.amount,
    unit: data.unit || 'oz',
    createdAt: now,
  };
}
