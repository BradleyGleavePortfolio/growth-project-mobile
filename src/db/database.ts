import * as SQLite from 'expo-sqlite';
import { mockHash } from '../utils/auth';
import { generateId, getTodayString } from '../utils/date';
import { seedFoodsIfNeeded, seedRecipesIfNeeded } from './recipesDb';
import { initWorkoutTables, seedExercisesIfNeeded } from './workoutDb';
import { initNotificationsTable } from './notificationsDb';
import { initCoachMessagesTable } from './coachMessagesDb';
import { initHabitsTables } from './habitsDb';
import { initEducationTables, seedLessonsIfNeeded } from './educationDb';
import { initCommunityTables, seedCommunityIfNeeded } from './communityDb';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('growthproject.db');
    await db.execAsync('PRAGMA journal_mode = WAL;');
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  const database = await getDatabase();

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('coach', 'client')),
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      coachId TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'pending_verification', 'verified')),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL UNIQUE,
      coachId TEXT NOT NULL,
      sex TEXT,
      dob TEXT,
      currentWeight REAL,
      targetWeight REAL,
      height REAL,
      activityLevel TEXT,
      primaryGoal TEXT,
      dietType TEXT,
      eatHabits TEXT,
      foodPrefs TEXT,
      restrictions TEXT,
      mealsPerDay INTEGER,
      timeline INTEGER,
      tdee REAL,
      calorieTarget REAL,
      proteinTarget REAL,
      carbTarget REAL,
      fatTarget REAL,
      gymMembership TEXT,
      fitnessLevel TEXT,
      preferredSnacks TEXT,
      onboardingCompleted INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS food_logs (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      coachId TEXT NOT NULL,
      date TEXT NOT NULL,
      mealType TEXT NOT NULL CHECK(mealType IN ('breakfast', 'lunch', 'dinner', 'snack')),
      foodName TEXT NOT NULL,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weight_logs (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      coachId TEXT NOT NULL,
      date TEXT NOT NULL,
      weight REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'lbs',
      notes TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meal_plans (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      coachId TEXT NOT NULL,
      weekStart TEXT NOT NULL,
      planData TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      servings INTEGER NOT NULL DEFAULT 1,
      ingredients TEXT,
      instructions TEXT,
      tags TEXT,
      isCustom INTEGER NOT NULL DEFAULT 0,
      userId TEXT,
      coachId TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS water_logs (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      coachId TEXT NOT NULL,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'oz',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fasting_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      coachId TEXT NOT NULL,
      startTime TEXT NOT NULL,
      endTime TEXT,
      targetHours REAL NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(userId, date);
    CREATE INDEX IF NOT EXISTS idx_weight_logs_user_date ON weight_logs(userId, date);
    CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(userId, date);
    CREATE INDEX IF NOT EXISTS idx_users_coach ON users(coachId);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
    CREATE INDEX IF NOT EXISTS idx_meal_plans_user_week ON meal_plans(userId, weekStart);
  `);

  // Add imageUrl column if missing (Phase F upgrade)
  try {
    await database.execAsync(`ALTER TABLE recipes ADD COLUMN imageUrl TEXT;`);
  } catch {
    // Column already exists
  }

  await initWorkoutTables();
  await initNotificationsTable();
  await initCoachMessagesTable();
  await initHabitsTables();
  await initEducationTables();
  await initCommunityTables();
  await seedFoodsIfNeeded();
  await seedLessonsIfNeeded();
  await seedCommunityIfNeeded();
  await seedRecipesIfNeeded();
  await seedExercisesIfNeeded();
}

export async function seedCoachIfNeeded(): Promise<void> {
  const database = await getDatabase();
  const existing = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM users WHERE email = ?',
    ['coach@growthproject.app']
  );

  if (existing) return;

  const now = new Date().toISOString();
  const coachId = 'coach_' + generateId();

  await database.runAsync(
    `INSERT INTO users (id, role, email, passwordHash, firstName, lastName, coachId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [coachId, 'coach', 'coach@growthproject.app', mockHash('GrowthCoach2024!'), 'Growth', 'Coach', 'active', now, now]
  );

  await seedDemoClients(database, coachId);
}

async function seedDemoClients(database: SQLite.SQLiteDatabase, coachId: string): Promise<void> {
  const now = new Date().toISOString();
  const today = getTodayString();

  // Client 1: Alex Johnson (completed onboarding, has food logs)
  const client1Id = 'client1_' + generateId();
  await database.runAsync(
    `INSERT INTO users (id, role, email, passwordHash, firstName, lastName, coachId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client1Id, 'client', 'client1@demo.com', mockHash('Demo1234!'), 'Alex', 'Johnson', coachId, 'active', now, now]
  );

  const profile1Id = 'profile1_' + generateId();
  await database.runAsync(
    `INSERT INTO client_profiles (id, userId, coachId, sex, dob, currentWeight, targetWeight, height, activityLevel, primaryGoal, dietType, eatHabits, foodPrefs, restrictions, mealsPerDay, timeline, tdee, calorieTarget, proteinTarget, carbTarget, fatTarget, onboardingCompleted, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [profile1Id, client1Id, coachId, 'male', '1995-06-15', 185, 170, 177.8, 'moderate', 'lose_moderate', 'balanced', 'Regular meals', JSON.stringify(['chicken', 'fish', 'beef']), JSON.stringify([]), 3, 12, 2400, 1900, 157, 190, 53, 1, now, now]
  );

  // Seed some food logs for client1
  const meals = [
    { mealType: 'breakfast', foodName: 'Oatmeal with Berries', calories: 350, protein: 12, carbs: 55, fat: 8, quantity: 1, unit: 'bowl' },
    { mealType: 'breakfast', foodName: 'Protein Shake', calories: 220, protein: 30, carbs: 10, fat: 5, quantity: 1, unit: 'shake' },
    { mealType: 'lunch', foodName: 'Grilled Chicken Salad', calories: 450, protein: 42, carbs: 18, fat: 22, quantity: 1, unit: 'plate' },
    { mealType: 'dinner', foodName: 'Salmon with Rice', calories: 580, protein: 38, carbs: 52, fat: 18, quantity: 1, unit: 'plate' },
    { mealType: 'snack', foodName: 'Greek Yogurt', calories: 150, protein: 15, carbs: 12, fat: 4, quantity: 1, unit: 'cup' },
  ];

  for (const meal of meals) {
    const logId = 'flog_' + generateId();
    await database.runAsync(
      `INSERT INTO food_logs (id, userId, coachId, date, mealType, foodName, calories, protein, carbs, fat, quantity, unit, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [logId, client1Id, coachId, today, meal.mealType, meal.foodName, meal.calories, meal.protein, meal.carbs, meal.fat, meal.quantity, meal.unit, now]
    );
  }

  // Seed water logs for client1
  const waterId = 'wlog_' + generateId();
  await database.runAsync(
    `INSERT INTO water_logs (id, userId, coachId, date, amount, unit, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [waterId, client1Id, coachId, today, 48, 'oz', now]
  );

  // Client 2: Sam Rivera (completed onboarding, no food logs)
  const client2Id = 'client2_' + generateId();
  await database.runAsync(
    `INSERT INTO users (id, role, email, passwordHash, firstName, lastName, coachId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client2Id, 'client', 'client2@demo.com', mockHash('Demo1234!'), 'Sam', 'Rivera', coachId, 'active', now, now]
  );

  const profile2Id = 'profile2_' + generateId();
  await database.runAsync(
    `INSERT INTO client_profiles (id, userId, coachId, sex, dob, currentWeight, targetWeight, height, activityLevel, primaryGoal, dietType, eatHabits, foodPrefs, restrictions, mealsPerDay, timeline, tdee, calorieTarget, proteinTarget, carbTarget, fatTarget, onboardingCompleted, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [profile2Id, client2Id, coachId, 'female', '1998-03-22', 140, 130, 165.1, 'active', 'lose_moderate', 'balanced', 'Intermittent fasting', JSON.stringify(['chicken', 'turkey', 'fish']), JSON.stringify(['no beef']), 3, 8, 2050, 1550, 119, 155, 43, 1, now, now]
  );
}
