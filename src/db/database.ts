import * as SQLite from 'expo-sqlite';
// Auth + demo-seed imports removed: the old mock-SQLite auth path is gone.
// Backend JWT is the single source of truth for identity now.
// recipesDb / mealPlanDb / fastingDb / shoppingListDb were deleted in the
// nutrition P0 cleanup — all four shipped as orphan code with zero call
// sites from any screen. Recipes / shopping / fasting / meal-plans are
// 100% server-driven via recipesApi / listsApi / fastingApi / mealTemplatesApi
// + mealPlansApi. The CREATE TABLE statements for `recipes`, `meal_plans`,
// and `fasting_sessions` are retained below for older builds that may still
// reference them; nothing in the current build writes to them.
import { initWorkoutTables, seedExercisesIfNeeded } from './workoutDb';
import { initNotificationsTable } from './notificationsDb';
import { initHabitsTables } from './habitsDb';
import { initEducationTables, seedLessonsIfNeeded } from './educationDb';
import { initCommunityTables } from './communityDb';

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
  await initHabitsTables();

  // One-time cleanup: the legacy `coach_messages` SQLite table previously held
  // seeded fake coach↔client conversations on first sign-in. Real messaging now
  // lives behind the backend API (coachMessagesApi / messagesApi). Drop the
  // orphaned table so no stale local rows can leak into the UI.
  try {
    await database.execAsync('DROP TABLE IF EXISTS coach_messages;');
  } catch {
    // Best-effort — ignore if the table never existed.
  }
  await initEducationTables();
  await initCommunityTables();
  // seedFoodsIfNeeded / seedRecipesIfNeeded removed — recipesDb was orphan
  // code re-seeding 200 foods + 75 recipes (with hotlinked Unsplash URLs and
  // a malformed slug) on every cold start while no screen ever read the rows.
  // Foods and recipes are now fetched live via the server API.
  await seedLessonsIfNeeded();
  // seedCommunityIfNeeded() removed — community feed is now backend-driven (see useCommunityFeed).
  await seedExercisesIfNeeded();
}

// seedCoachIfNeeded + seedDemoClients were removed along with the dead mock-auth path.
// The local `users` / `client_profiles` / `food_logs` / `water_logs` / `weight_logs`
// tables are still created above for schema compatibility with older builds, but
// nothing writes to or reads from them anymore. A future cleanup should drop those
// CREATE TABLE statements entirely.
