import { getDatabase } from './database';
import { generateId } from '../utils/date';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Exercise {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  instructions: string;
  imageUrl?: string;
}

export interface WorkoutRoutine {
  id: string;
  userId: string;
  coachId: string;
  name: string;
  exercises: string; // JSON array of RoutineExercise
  createdAt: string;
  updatedAt: string;
}

export interface RoutineExercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  restSec: number;
}

export interface WorkoutSession {
  id: string;
  userId: string;
  coachId: string;
  routineId?: string;
  routineName: string;
  startTime: string;
  endTime?: string;
  completed: boolean;
  exercises: string; // JSON array of SessionExercise
  notes?: string;
  createdAt: string;
}

export interface SessionExercise {
  exerciseId: string;
  exerciseName: string;
  sets: SessionSet[];
}

export interface SessionSet {
  reps: number;
  weight: number;
  completed: boolean;
}

export interface CoachGuideline {
  id: string;
  coachId: string;
  clientId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ── Init tables ────────────────────────────────────────────────────────────

export async function initWorkoutTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      muscle TEXT NOT NULL,
      equipment TEXT NOT NULL DEFAULT 'bodyweight',
      instructions TEXT,
      imageUrl TEXT
    );

    CREATE TABLE IF NOT EXISTS workout_routines (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      coachId TEXT NOT NULL,
      name TEXT NOT NULL,
      exercises TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workout_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      coachId TEXT NOT NULL,
      routineId TEXT,
      routineName TEXT NOT NULL,
      startTime TEXT NOT NULL,
      endTime TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      exercises TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coach_guidelines (
      id TEXT PRIMARY KEY NOT NULL,
      coachId TEXT NOT NULL,
      clientId TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workout_sessions_user ON workout_sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_workout_routines_user ON workout_routines(userId);
    CREATE INDEX IF NOT EXISTS idx_coach_guidelines_client ON coach_guidelines(clientId);
  `);
}

// ── Seed 60 exercises ──────────────────────────────────────────────────────

export async function seedExercisesIfNeeded(): Promise<void> {
  const db = await getDatabase();
  const count = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM exercises');
  if (count && count.c >= 60) return;

  // Delete old seed data and re-seed
  if (count && count.c > 0 && count.c < 60) {
    await db.runAsync('DELETE FROM exercises');
  }

  const exercises: Omit<Exercise, 'id'>[] = [
    // ── Chest (8) ──
    { name: 'Barbell Bench Press', muscle: 'chest', equipment: 'barbell', instructions: 'Lie on bench, grip bar shoulder-width, lower to chest, press up.' },
    { name: 'Dumbbell Bench Press', muscle: 'chest', equipment: 'dumbbell', instructions: 'Lie on bench, press dumbbells up from chest level.' },
    { name: 'Incline Bench Press', muscle: 'chest', equipment: 'barbell', instructions: 'Set bench to 30-45°, press barbell from upper chest.' },
    { name: 'Dumbbell Flyes', muscle: 'chest', equipment: 'dumbbell', instructions: 'Lie on bench, arc dumbbells out and down, squeeze back up.' },
    { name: 'Push-Ups', muscle: 'chest', equipment: 'bodyweight', instructions: 'Hands shoulder-width, lower chest to floor, push up.' },
    { name: 'Cable Crossover', muscle: 'chest', equipment: 'cable', instructions: 'Stand between cables, pull handles together in arc at chest height.' },
    { name: 'Decline Bench Press', muscle: 'chest', equipment: 'barbell', instructions: 'Lie on decline bench, press barbell from lower chest.' },
    { name: 'Chest Dips', muscle: 'chest', equipment: 'bodyweight', instructions: 'Lean forward on dip bars, lower body, press back up.' },
    // ── Back (8) ──
    { name: 'Barbell Row', muscle: 'back', equipment: 'barbell', instructions: 'Hinge forward, pull barbell to lower chest.' },
    { name: 'Pull-Ups', muscle: 'back', equipment: 'bodyweight', instructions: 'Hang from bar, pull chin above bar.' },
    { name: 'Lat Pulldown', muscle: 'back', equipment: 'cable', instructions: 'Sit at machine, pull bar to upper chest.' },
    { name: 'Seated Cable Row', muscle: 'back', equipment: 'cable', instructions: 'Sit upright, pull handle to torso.' },
    { name: 'Dumbbell Row', muscle: 'back', equipment: 'dumbbell', instructions: 'One hand on bench, row dumbbell to hip.' },
    { name: 'T-Bar Row', muscle: 'back', equipment: 'barbell', instructions: 'Straddle barbell, pull to chest with V-handle.' },
    { name: 'Face Pulls', muscle: 'back', equipment: 'cable', instructions: 'Pull rope to face with elbows high.' },
    { name: 'Chin-Ups', muscle: 'back', equipment: 'bodyweight', instructions: 'Underhand grip, pull chin above bar.' },
    // ── Shoulders (7) ──
    { name: 'Overhead Press', muscle: 'shoulders', equipment: 'barbell', instructions: 'Press barbell from shoulders overhead.' },
    { name: 'Dumbbell Shoulder Press', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Press dumbbells from shoulders overhead.' },
    { name: 'Lateral Raises', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Raise dumbbells to sides until shoulder height.' },
    { name: 'Front Raises', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Raise dumbbells in front to shoulder height.' },
    { name: 'Reverse Flyes', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Bent over, raise dumbbells out to sides.' },
    { name: 'Arnold Press', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Rotate palms from facing you to facing forward while pressing up.' },
    { name: 'Upright Row', muscle: 'shoulders', equipment: 'barbell', instructions: 'Pull barbell up along body to chin height.' },
    // ── Legs (10) ──
    { name: 'Barbell Squat', muscle: 'legs', equipment: 'barbell', instructions: 'Bar on upper back, squat to parallel or below.' },
    { name: 'Leg Press', muscle: 'legs', equipment: 'machine', instructions: 'Sit in leg press, push platform away.' },
    { name: 'Romanian Deadlift', muscle: 'legs', equipment: 'barbell', instructions: 'Hinge at hips, lower bar along legs with slight knee bend.' },
    { name: 'Bulgarian Split Squat', muscle: 'legs', equipment: 'dumbbell', instructions: 'Rear foot on bench, lunge down on front leg.' },
    { name: 'Leg Extension', muscle: 'legs', equipment: 'machine', instructions: 'Sit at machine, extend legs until straight.' },
    { name: 'Leg Curl', muscle: 'legs', equipment: 'machine', instructions: 'Lie face down, curl pad toward glutes.' },
    { name: 'Walking Lunges', muscle: 'legs', equipment: 'dumbbell', instructions: 'Step forward into lunge, alternate legs walking.' },
    { name: 'Calf Raises', muscle: 'legs', equipment: 'machine', instructions: 'Stand on platform edge, raise heels up.' },
    { name: 'Goblet Squat', muscle: 'legs', equipment: 'dumbbell', instructions: 'Hold dumbbell at chest, squat to depth.' },
    { name: 'Hip Thrust', muscle: 'legs', equipment: 'barbell', instructions: 'Back against bench, drive hips up with bar on lap.' },
    // ── Arms – Biceps (5) ──
    { name: 'Barbell Curl', muscle: 'biceps', equipment: 'barbell', instructions: 'Stand, curl barbell to shoulders.' },
    { name: 'Dumbbell Curl', muscle: 'biceps', equipment: 'dumbbell', instructions: 'Alternate curling dumbbells to shoulders.' },
    { name: 'Hammer Curl', muscle: 'biceps', equipment: 'dumbbell', instructions: 'Neutral grip, curl dumbbells to shoulders.' },
    { name: 'Preacher Curl', muscle: 'biceps', equipment: 'barbell', instructions: 'Arms on preacher pad, curl barbell up.' },
    { name: 'Incline Dumbbell Curl', muscle: 'biceps', equipment: 'dumbbell', instructions: 'Lie on incline bench, curl dumbbells up.' },
    // ── Arms – Triceps (5) ──
    { name: 'Tricep Pushdown', muscle: 'triceps', equipment: 'cable', instructions: 'Push cable bar down, keep elbows at sides.' },
    { name: 'Skull Crushers', muscle: 'triceps', equipment: 'barbell', instructions: 'Lie on bench, lower bar to forehead, extend arms.' },
    { name: 'Overhead Tricep Extension', muscle: 'triceps', equipment: 'dumbbell', instructions: 'Hold dumbbell overhead with both hands, lower behind head, extend.' },
    { name: 'Close-Grip Bench Press', muscle: 'triceps', equipment: 'barbell', instructions: 'Narrow grip on barbell, press from chest.' },
    { name: 'Tricep Dips', muscle: 'triceps', equipment: 'bodyweight', instructions: 'On dip bars or bench, lower body and push back up.' },
    // ── Core (7) ──
    { name: 'Plank', muscle: 'core', equipment: 'bodyweight', instructions: 'Hold push-up position on forearms, keep body straight.' },
    { name: 'Crunches', muscle: 'core', equipment: 'bodyweight', instructions: 'Lie on back, curl shoulders off floor.' },
    { name: 'Russian Twists', muscle: 'core', equipment: 'bodyweight', instructions: 'Sit with feet off floor, rotate torso side to side.' },
    { name: 'Hanging Leg Raise', muscle: 'core', equipment: 'bodyweight', instructions: 'Hang from bar, raise legs to parallel.' },
    { name: 'Ab Wheel Rollout', muscle: 'core', equipment: 'bodyweight', instructions: 'Kneel, roll wheel forward, pull back.' },
    { name: 'Cable Woodchop', muscle: 'core', equipment: 'cable', instructions: 'Rotate torso pulling cable diagonally across body.' },
    { name: 'Mountain Climbers', muscle: 'core', equipment: 'bodyweight', instructions: 'Push-up position, alternate driving knees to chest.' },
    // ── Compound / Full Body (5) ──
    { name: 'Deadlift', muscle: 'full body', equipment: 'barbell', instructions: 'Stand over bar, hinge down, grip and pull to standing.' },
    { name: 'Clean and Press', muscle: 'full body', equipment: 'barbell', instructions: 'Pull bar from floor to shoulders, then press overhead.' },
    { name: 'Burpees', muscle: 'full body', equipment: 'bodyweight', instructions: 'Drop to push-up, jump up, repeat.' },
    { name: 'Kettlebell Swing', muscle: 'full body', equipment: 'dumbbell', instructions: 'Swing kettlebell between legs and up to eye level.' },
    { name: 'Thrusters', muscle: 'full body', equipment: 'dumbbell', instructions: 'Front squat into overhead press in one motion.' },
    // ── Cardio (5) ──
    { name: 'Treadmill Run', muscle: 'cardio', equipment: 'machine', instructions: 'Run on treadmill at target pace.' },
    { name: 'Rowing Machine', muscle: 'cardio', equipment: 'machine', instructions: 'Row with full body, push legs then pull arms.' },
    { name: 'Jump Rope', muscle: 'cardio', equipment: 'bodyweight', instructions: 'Skip rope with quick wrist rotations.' },
    { name: 'Cycling', muscle: 'cardio', equipment: 'machine', instructions: 'Pedal at target resistance and cadence.' },
    { name: 'Stair Climber', muscle: 'cardio', equipment: 'machine', instructions: 'Step on machine at steady pace.' },
  ];

  const now = new Date().toISOString();
  for (const e of exercises) {
    const id = 'ex_' + generateId();
    await db.runAsync(
      `INSERT INTO exercises (id, name, muscle, equipment, instructions) VALUES (?, ?, ?, ?, ?)`,
      [id, e.name, e.muscle, e.equipment, e.instructions]
    );
  }
}

// ── Exercise queries ───────────────────────────────────────────────────────

export async function getAllExercises(): Promise<Exercise[]> {
  const db = await getDatabase();
  return db.getAllAsync<Exercise>('SELECT * FROM exercises ORDER BY muscle, name');
}

export async function searchExercises(query: string): Promise<Exercise[]> {
  const db = await getDatabase();
  return db.getAllAsync<Exercise>(
    'SELECT * FROM exercises WHERE name LIKE ? OR muscle LIKE ? OR equipment LIKE ? ORDER BY name LIMIT 30',
    [`%${query}%`, `%${query}%`, `%${query}%`]
  );
}

export async function getExercisesByMuscle(muscle: string): Promise<Exercise[]> {
  const db = await getDatabase();
  return db.getAllAsync<Exercise>(
    'SELECT * FROM exercises WHERE muscle = ? ORDER BY name',
    [muscle]
  );
}

// ── Routine CRUD ───────────────────────────────────────────────────────────

export async function getRoutines(userId: string): Promise<WorkoutRoutine[]> {
  const db = await getDatabase();
  return db.getAllAsync<WorkoutRoutine>(
    'SELECT * FROM workout_routines WHERE userId = ? ORDER BY updatedAt DESC',
    [userId]
  );
}

export async function createRoutine(
  userId: string,
  coachId: string,
  name: string,
  exercises: RoutineExercise[]
): Promise<string> {
  const db = await getDatabase();
  const id = 'routine_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO workout_routines (id, userId, coachId, name, exercises, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, coachId, name, JSON.stringify(exercises), now, now]
  );
  return id;
}

export async function updateRoutine(
  id: string,
  name: string,
  exercises: RoutineExercise[]
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE workout_routines SET name = ?, exercises = ?, updatedAt = ? WHERE id = ?',
    [name, JSON.stringify(exercises), now, id]
  );
}

export async function deleteRoutine(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM workout_routines WHERE id = ?', [id]);
}

// ── Session CRUD ───────────────────────────────────────────────────────────

export async function getWorkoutSessions(userId: string, limit = 20): Promise<WorkoutSession[]> {
  const db = await getDatabase();
  return db.getAllAsync<WorkoutSession>(
    'SELECT * FROM workout_sessions WHERE userId = ? ORDER BY startTime DESC LIMIT ?',
    [userId, limit]
  );
}

export async function createWorkoutSession(params: {
  userId: string;
  coachId: string;
  routineId?: string;
  routineName: string;
  exercises: SessionExercise[];
}): Promise<string> {
  const db = await getDatabase();
  const id = 'ws_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO workout_sessions (id, userId, coachId, routineId, routineName, startTime, completed, exercises, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, params.userId, params.coachId, params.routineId || null, params.routineName, now, JSON.stringify(params.exercises), now]
  );
  return id;
}

export async function completeWorkoutSession(id: string, exercises: SessionExercise[], notes?: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE workout_sessions SET endTime = ?, completed = 1, exercises = ?, notes = ? WHERE id = ?',
    [now, JSON.stringify(exercises), notes || null, id]
  );
}

// ── Coach Guidelines ───────────────────────────────────────────────────────

export async function getCoachGuidelines(clientId: string): Promise<CoachGuideline | null> {
  const db = await getDatabase();
  return db.getFirstAsync<CoachGuideline>(
    'SELECT * FROM coach_guidelines WHERE clientId = ? ORDER BY updatedAt DESC LIMIT 1',
    [clientId]
  );
}

export async function saveCoachGuideline(coachId: string, clientId: string, content: string): Promise<void> {
  const db = await getDatabase();
  const existing = await getCoachGuidelines(clientId);
  const now = new Date().toISOString();
  if (existing) {
    await db.runAsync(
      'UPDATE coach_guidelines SET content = ?, updatedAt = ? WHERE id = ?',
      [content, now, existing.id]
    );
  } else {
    const id = 'cg_' + generateId();
    await db.runAsync(
      'INSERT INTO coach_guidelines (id, coachId, clientId, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [id, coachId, clientId, content, now, now]
    );
  }
}
