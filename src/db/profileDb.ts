import { getDatabase } from './database';
import { ClientProfile } from '../types';
import { generateId } from '../utils/date';

export async function getProfileByUserId(userId: string): Promise<ClientProfile | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM client_profiles WHERE userId = ?',
    [userId]
  );
  if (!row) return null;
  return {
    ...row,
    onboardingCompleted: !!row.onboardingCompleted,
  };
}

export async function createProfile(userId: string, coachId: string): Promise<ClientProfile> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = 'profile_' + generateId();

  await db.runAsync(
    `INSERT INTO client_profiles (id, userId, coachId, onboardingCompleted, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?)`,
    [id, userId, coachId, now, now]
  );

  return {
    id,
    userId,
    coachId,
    onboardingCompleted: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateProfile(
  userId: string,
  updates: Partial<ClientProfile>
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  const fields: string[] = [];
  const values: any[] = [];

  const allowedKeys: (keyof ClientProfile)[] = [
    'sex', 'dob', 'currentWeight', 'targetWeight', 'height',
    'activityLevel', 'primaryGoal', 'dietType', 'eatHabits',
    'foodPrefs', 'restrictions', 'mealsPerDay', 'timeline',
    'tdee', 'calorieTarget', 'proteinTarget', 'carbTarget', 'fatTarget',
    'gymMembership', 'fitnessLevel', 'preferredSnacks',
    'onboardingCompleted',
  ];

  for (const key of allowedKeys) {
    if (key in updates) {
      let val = updates[key];
      if (key === 'onboardingCompleted') {
        val = val ? 1 : 0;
      }
      fields.push(`${key} = ?`);
      values.push(val as any);
    }
  }

  if (fields.length === 0) return;

  fields.push('updatedAt = ?');
  values.push(now);
  values.push(userId);

  await db.runAsync(
    `UPDATE client_profiles SET ${fields.join(', ')} WHERE userId = ?`,
    values
  );
}
