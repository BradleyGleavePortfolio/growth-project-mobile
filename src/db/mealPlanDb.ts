import { getDatabase } from './database';
import { MealPlan } from '../types';
import { generateId } from '../utils/date';

export interface PlanDayMeal {
  name: string;
  calories: number;
}

export interface PlanDay {
  breakfast: PlanDayMeal | null;
  lunch: PlanDayMeal | null;
  dinner: PlanDayMeal | null;
  snacks: PlanDayMeal | null;
}

export type PlanData = Record<string, PlanDay>;

export async function getMealPlan(
  userId: string,
  weekStart: string
): Promise<MealPlan | null> {
  const db = await getDatabase();
  return db.getFirstAsync<MealPlan>(
    'SELECT * FROM meal_plans WHERE userId = ? AND weekStart = ?',
    [userId, weekStart]
  );
}

export async function upsertMealPlan(
  userId: string,
  coachId: string,
  weekStart: string,
  planData: PlanData
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const existing = await getMealPlan(userId, weekStart);

  if (existing) {
    await db.runAsync(
      'UPDATE meal_plans SET planData = ?, updatedAt = ? WHERE id = ?',
      [JSON.stringify(planData), now, existing.id]
    );
  } else {
    const id = 'mp_' + generateId();
    await db.runAsync(
      `INSERT INTO meal_plans (id, userId, coachId, weekStart, planData, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, coachId, weekStart, JSON.stringify(planData), now, now]
    );
  }
}

export function parsePlanData(planDataStr: string): PlanData {
  try {
    return JSON.parse(planDataStr);
  } catch {
    return {};
  }
}
