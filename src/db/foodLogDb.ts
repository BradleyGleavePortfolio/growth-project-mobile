import { getDatabase } from './database';
import { FoodLog, MealType } from '../types';
import { generateId } from '../utils/date';

export async function getFoodLogsByDate(
  userId: string,
  date: string
): Promise<FoodLog[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<FoodLog>(
    'SELECT * FROM food_logs WHERE userId = ? AND date = ? ORDER BY createdAt ASC',
    [userId, date]
  );
  return rows;
}

export async function getFoodLogsByDateForCoach(
  userId: string,
  coachId: string,
  date: string
): Promise<FoodLog[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<FoodLog>(
    'SELECT * FROM food_logs WHERE userId = ? AND coachId = ? AND date = ? ORDER BY createdAt ASC',
    [userId, coachId, date]
  );
  return rows;
}

export async function addFoodLog(data: {
  userId: string;
  coachId: string;
  date: string;
  mealType: MealType;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  quantity: number;
  unit: string;
}): Promise<FoodLog> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = 'flog_' + generateId();

  await db.runAsync(
    `INSERT INTO food_logs (id, userId, coachId, date, mealType, foodName, calories, protein, carbs, fat, quantity, unit, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.userId, data.coachId, data.date, data.mealType, data.foodName, data.calories, data.protein, data.carbs, data.fat, data.quantity, data.unit, now]
  );

  return { id, ...data, createdAt: now };
}

export async function deleteFoodLog(id: string, userId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM food_logs WHERE id = ? AND userId = ?',
    [id, userId]
  );
}

export async function getDailyTotals(
  userId: string,
  date: string
): Promise<{ calories: number; protein: number; carbs: number; fat: number }> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
  }>(
    `SELECT
       COALESCE(SUM(calories), 0) as totalCalories,
       COALESCE(SUM(protein), 0) as totalProtein,
       COALESCE(SUM(carbs), 0) as totalCarbs,
       COALESCE(SUM(fat), 0) as totalFat
     FROM food_logs
     WHERE userId = ? AND date = ?`,
    [userId, date]
  );
  return {
    calories: row?.totalCalories || 0,
    protein: row?.totalProtein || 0,
    carbs: row?.totalCarbs || 0,
    fat: row?.totalFat || 0,
  };
}

export async function getRecentFoodLogsForCoach(
  coachId: string,
  limit: number = 20
): Promise<(FoodLog & { firstName?: string; lastName?: string })[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<FoodLog & { firstName?: string; lastName?: string }>(
    `SELECT f.*, u.firstName, u.lastName
     FROM food_logs f
     JOIN users u ON f.userId = u.id
     WHERE f.coachId = ?
     ORDER BY f.createdAt DESC
     LIMIT ?`,
    [coachId, limit]
  );
  return rows;
}
