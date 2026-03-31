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

// ── Image URL helper ───────────────────────────────────────────────────────

function getExerciseImageUrl(name: string, _muscle: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-');
  return `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${slug}/0.jpg`;
}

// ── Seed 150+ exercises ────────────────────────────────────────────────────

export async function seedExercisesIfNeeded(): Promise<void> {
  const db = await getDatabase();
  const count = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM exercises');
  if (count && count.c >= 150) return;

  // Delete old seed data and re-seed
  if (count && count.c > 0 && count.c < 150) {
    await db.runAsync('DELETE FROM exercises');
  }

  const exercises: Omit<Exercise, 'id'>[] = [
    // ── Chest (12) ──
    { name: 'Barbell Bench Press', muscle: 'chest', equipment: 'barbell', instructions: 'Lie on bench, grip bar shoulder-width, lower to chest, press up.' },
    { name: 'Dumbbell Bench Press', muscle: 'chest', equipment: 'dumbbell', instructions: 'Lie on bench, press dumbbells up from chest level.' },
    { name: 'Incline Bench Press', muscle: 'chest', equipment: 'barbell', instructions: 'Set bench to 30-45°, press barbell from upper chest.' },
    { name: 'Incline Dumbbell Press', muscle: 'chest', equipment: 'dumbbell', instructions: 'Set bench to 30-45°, press dumbbells from upper chest.' },
    { name: 'Dumbbell Flyes', muscle: 'chest', equipment: 'dumbbell', instructions: 'Lie on bench, arc dumbbells out and down, squeeze back up.' },
    { name: 'Push-Ups', muscle: 'chest', equipment: 'bodyweight', instructions: 'Hands shoulder-width, lower chest to floor, push up.' },
    { name: 'Cable Crossover', muscle: 'chest', equipment: 'cable', instructions: 'Stand between cables, pull handles together in arc at chest height.' },
    { name: 'Decline Bench Press', muscle: 'chest', equipment: 'barbell', instructions: 'Lie on decline bench, press barbell from lower chest.' },
    { name: 'Chest Dips', muscle: 'chest', equipment: 'bodyweight', instructions: 'Lean forward on dip bars, lower body, press back up.' },
    { name: 'Close-Grip Bench Press', muscle: 'chest', equipment: 'barbell', instructions: 'Narrow grip on barbell, press from chest targeting inner chest and triceps.' },
    { name: 'Machine Chest Press', muscle: 'chest', equipment: 'machine', instructions: 'Sit at machine, press handles forward until arms are extended.' },
    { name: 'Pec Deck', muscle: 'chest', equipment: 'machine', instructions: 'Sit at pec deck machine, bring arms together in front squeezing chest.' },

    // ── Back (12) ──
    { name: 'Barbell Row', muscle: 'back', equipment: 'barbell', instructions: 'Hinge forward, pull barbell to lower chest.' },
    { name: 'Pull-Ups', muscle: 'back', equipment: 'bodyweight', instructions: 'Hang from bar, pull chin above bar.' },
    { name: 'Lat Pulldown', muscle: 'back', equipment: 'cable', instructions: 'Sit at machine, pull bar to upper chest.' },
    { name: 'Seated Cable Row', muscle: 'back', equipment: 'cable', instructions: 'Sit upright, pull handle to torso.' },
    { name: 'Dumbbell Row', muscle: 'back', equipment: 'dumbbell', instructions: 'One hand on bench, row dumbbell to hip.' },
    { name: 'T-Bar Row', muscle: 'back', equipment: 'barbell', instructions: 'Straddle barbell, pull to chest with V-handle.' },
    { name: 'Face Pulls', muscle: 'back', equipment: 'cable', instructions: 'Pull rope to face with elbows high.' },
    { name: 'Chin-Ups', muscle: 'back', equipment: 'bodyweight', instructions: 'Underhand grip, pull chin above bar.' },
    { name: 'Pendlay Row', muscle: 'back', equipment: 'barbell', instructions: 'Bar on floor, pull explosively to chest from dead stop each rep.' },
    { name: 'Meadows Row', muscle: 'back', equipment: 'barbell', instructions: 'Stagger stance, row landmine barbell to hip with one arm.' },
    { name: 'Rack Pulls', muscle: 'back', equipment: 'barbell', instructions: 'Pull barbell from rack pins at knee height, focus on upper back.' },
    { name: 'Straight-Arm Pulldown', muscle: 'back', equipment: 'cable', instructions: 'Arms straight, pull cable bar down to hips, squeeze lats.' },

    // ── Shoulders (10) ──
    { name: 'Overhead Press', muscle: 'shoulders', equipment: 'barbell', instructions: 'Press barbell from shoulders overhead.' },
    { name: 'Dumbbell Shoulder Press', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Press dumbbells from shoulders overhead.' },
    { name: 'Lateral Raises', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Raise dumbbells to sides until shoulder height.' },
    { name: 'Front Raises', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Raise dumbbells in front to shoulder height.' },
    { name: 'Reverse Flyes', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Bent over, raise dumbbells out to sides.' },
    { name: 'Arnold Press', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Rotate palms from facing you to facing forward while pressing up.' },
    { name: 'Upright Row', muscle: 'shoulders', equipment: 'barbell', instructions: 'Pull barbell up along body to chin height.' },
    { name: 'Cable Lateral Raise', muscle: 'shoulders', equipment: 'cable', instructions: 'Single cable, raise arm laterally to shoulder height for constant tension.' },
    { name: 'Dumbbell Shrug', muscle: 'shoulders', equipment: 'dumbbell', instructions: 'Hold dumbbells at sides, shrug shoulders toward ears, squeeze traps.' },
    { name: 'Behind-the-Neck Press', muscle: 'shoulders', equipment: 'barbell', instructions: 'Press barbell from behind head to overhead, keep core tight.' },

    // ── Legs (15) ──
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
    { name: 'Front Squat', muscle: 'legs', equipment: 'barbell', instructions: 'Bar on front of shoulders, squat to parallel with upright torso.' },
    { name: 'Hack Squat', muscle: 'legs', equipment: 'machine', instructions: 'Load machine, lower into squat position and drive through heels.' },
    { name: 'Sumo Deadlift', muscle: 'legs', equipment: 'barbell', instructions: 'Wide stance, toes out, pull bar from floor to lockout.' },
    { name: 'Step-Ups', muscle: 'legs', equipment: 'dumbbell', instructions: 'Hold dumbbells, step onto bench or box, drive through front heel.' },
    { name: 'Box Jumps', muscle: 'legs', equipment: 'bodyweight', instructions: 'Stand before box, jump onto it landing softly, step back down.' },

    // ── Arms – Biceps (8) ──
    { name: 'Barbell Curl', muscle: 'biceps', equipment: 'barbell', instructions: 'Stand, curl barbell to shoulders.' },
    { name: 'Dumbbell Curl', muscle: 'biceps', equipment: 'dumbbell', instructions: 'Alternate curling dumbbells to shoulders.' },
    { name: 'Hammer Curl', muscle: 'biceps', equipment: 'dumbbell', instructions: 'Neutral grip, curl dumbbells to shoulders.' },
    { name: 'Preacher Curl', muscle: 'biceps', equipment: 'barbell', instructions: 'Arms on preacher pad, curl barbell up.' },
    { name: 'Incline Dumbbell Curl', muscle: 'biceps', equipment: 'dumbbell', instructions: 'Lie on incline bench, curl dumbbells up.' },
    { name: 'Concentration Curl', muscle: 'biceps', equipment: 'dumbbell', instructions: 'Seated, elbow on inner thigh, curl dumbbell to shoulder.' },
    { name: 'Cable Curl', muscle: 'biceps', equipment: 'cable', instructions: 'Face pulley, curl bar from hip to shoulder for constant tension.' },
    { name: 'Spider Curl', muscle: 'biceps', equipment: 'barbell', instructions: 'Lie face-down on incline bench, curl barbell targeting peak contraction.' },

    // ── Arms – Triceps (8) ──
    { name: 'Tricep Pushdown', muscle: 'triceps', equipment: 'cable', instructions: 'Push cable bar down, keep elbows at sides.' },
    { name: 'Skull Crushers', muscle: 'triceps', equipment: 'barbell', instructions: 'Lie on bench, lower bar to forehead, extend arms.' },
    { name: 'Overhead Tricep Extension', muscle: 'triceps', equipment: 'dumbbell', instructions: 'Hold dumbbell overhead with both hands, lower behind head, extend.' },
    { name: 'Tricep Dips', muscle: 'triceps', equipment: 'bodyweight', instructions: 'On dip bars or bench, lower body and push back up.' },
    { name: 'Diamond Push-Ups', muscle: 'triceps', equipment: 'bodyweight', instructions: 'Form diamond shape with hands under chest, perform push-up.' },
    { name: 'Rope Pushdown', muscle: 'triceps', equipment: 'cable', instructions: 'Attach rope to cable, push down and flare hands at bottom.' },
    { name: 'Tricep Kickbacks', muscle: 'triceps', equipment: 'dumbbell', instructions: 'Hinge forward, extend arm back until straight, squeezing tricep.' },
    { name: 'Close-Grip Bench Press Triceps', muscle: 'triceps', equipment: 'barbell', instructions: 'Narrow grip on barbell, press from chest emphasizing triceps.' },

    // ── Core (10) ──
    { name: 'Plank', muscle: 'core', equipment: 'bodyweight', instructions: 'Hold push-up position on forearms, keep body straight.' },
    { name: 'Crunches', muscle: 'core', equipment: 'bodyweight', instructions: 'Lie on back, curl shoulders off floor.' },
    { name: 'Russian Twists', muscle: 'core', equipment: 'bodyweight', instructions: 'Sit with feet off floor, rotate torso side to side.' },
    { name: 'Hanging Leg Raise', muscle: 'core', equipment: 'bodyweight', instructions: 'Hang from bar, raise legs to parallel.' },
    { name: 'Ab Wheel Rollout', muscle: 'core', equipment: 'bodyweight', instructions: 'Kneel, roll wheel forward, pull back.' },
    { name: 'Cable Woodchop', muscle: 'core', equipment: 'cable', instructions: 'Rotate torso pulling cable diagonally across body.' },
    { name: 'Mountain Climbers', muscle: 'core', equipment: 'bodyweight', instructions: 'Push-up position, alternate driving knees to chest.' },
    { name: 'Bicycle Crunches', muscle: 'core', equipment: 'bodyweight', instructions: 'Lie on back, alternate elbow to opposite knee in pedaling motion.' },
    { name: 'Dead Bug', muscle: 'core', equipment: 'bodyweight', instructions: 'Lie on back, extend opposite arm and leg while keeping low back flat.' },
    { name: 'Pallof Press', muscle: 'core', equipment: 'cable', instructions: 'Stand sideways to cable, press and hold, resist rotation.' },

    // ── Full Body (8) ──
    { name: 'Deadlift', muscle: 'full body', equipment: 'barbell', instructions: 'Stand over bar, hinge down, grip and pull to standing.' },
    { name: 'Clean and Press', muscle: 'full body', equipment: 'barbell', instructions: 'Pull bar from floor to shoulders, then press overhead.' },
    { name: 'Burpees', muscle: 'full body', equipment: 'bodyweight', instructions: 'Drop to push-up, jump up, repeat.' },
    { name: 'Kettlebell Swing', muscle: 'full body', equipment: 'dumbbell', instructions: 'Swing kettlebell between legs and up to eye level.' },
    { name: 'Thrusters', muscle: 'full body', equipment: 'dumbbell', instructions: 'Front squat into overhead press in one motion.' },
    { name: 'Power Clean', muscle: 'full body', equipment: 'barbell', instructions: 'Explosively pull bar from floor to rack position at shoulders.' },
    { name: 'Man Makers', muscle: 'full body', equipment: 'dumbbell', instructions: 'Push-up, renegade row each side, then clean and press.' },
    { name: 'Turkish Get-Up', muscle: 'full body', equipment: 'dumbbell', instructions: 'From lying with weight overhead, stand up using sequence of movements.' },

    // ── Cardio (8) ──
    { name: 'Treadmill Run', muscle: 'cardio', equipment: 'machine', instructions: 'Run on treadmill at target pace.' },
    { name: 'Rowing Machine', muscle: 'cardio', equipment: 'machine', instructions: 'Row with full body, push legs then pull arms.' },
    { name: 'Jump Rope', muscle: 'cardio', equipment: 'bodyweight', instructions: 'Skip rope with quick wrist rotations.' },
    { name: 'Cycling', muscle: 'cardio', equipment: 'machine', instructions: 'Pedal at target resistance and cadence.' },
    { name: 'Stair Climber', muscle: 'cardio', equipment: 'machine', instructions: 'Step on machine at steady pace.' },
    { name: 'Battle Ropes', muscle: 'cardio', equipment: 'bodyweight', instructions: 'Hold rope ends, create alternating or simultaneous waves for time.' },
    { name: 'Box Jumps Cardio', muscle: 'cardio', equipment: 'bodyweight', instructions: 'Continuous box jumps for time, step down between reps.' },
    { name: 'Elliptical', muscle: 'cardio', equipment: 'machine', instructions: 'Low-impact cardio on elliptical trainer at steady cadence.' },

    // ── Stretching/Mobility (5) ──
    { name: 'Foam Rolling', muscle: 'stretching', equipment: 'bodyweight', instructions: 'Roll slowly over muscle groups to release tension and improve mobility.' },
    { name: 'Hip Flexor Stretch', muscle: 'stretching', equipment: 'bodyweight', instructions: 'Kneel on one knee, shift forward to stretch front hip, hold 30s each side.' },
    { name: 'Shoulder Dislocations', muscle: 'stretching', equipment: 'bodyweight', instructions: 'Use a resistance band or stick, pass overhead and behind back to mobilize shoulders.' },
    { name: 'Pigeon Pose', muscle: 'stretching', equipment: 'bodyweight', instructions: 'From push-up, bring one shin forward parallel to hands, sink hips down.' },
    { name: 'Cat-Cow', muscle: 'stretching', equipment: 'bodyweight', instructions: 'On all fours, alternate arching back up (cat) and dropping it down (cow).' },
  ];

  for (const e of exercises) {
    const id = 'ex_' + generateId();
    const imageUrl = getExerciseImageUrl(e.name, e.muscle);
    await db.runAsync(
      `INSERT INTO exercises (id, name, muscle, equipment, instructions, imageUrl) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, e.name, e.muscle, e.equipment, e.instructions, imageUrl]
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
  const normalizedQuery = query.toLowerCase().trim();

  // Fetch all candidate matches (broader LIKE query)
  const candidates = await db.getAllAsync<Exercise>(
    `SELECT * FROM exercises
     WHERE lower(name) LIKE ? OR lower(muscle) LIKE ? OR lower(equipment) LIKE ?
     LIMIT 100`,
    [`%${normalizedQuery}%`, `%${normalizedQuery}%`, `%${normalizedQuery}%`]
  );

  // Weighted relevance scoring
  const scoreExercise = (exercise: Exercise, rawQuery: string): number => {
    const q = rawQuery.toLowerCase().trim().replace(/s$/, '');
    const name = exercise.name.toLowerCase().trim().replace(/s$/, '');

    let score: number;

    if (name === q) {
      score = 100;
    } else if (name.startsWith(q)) {
      score = 80;
    } else if (name.includes(q)) {
      score = 60;
    } else {
      const tokens = q.split(/\s+/);
      if (tokens.every((t) => name.includes(t))) {
        score = 30;
      } else {
        const muscleEq =
          exercise.muscle.toLowerCase().includes(q) ||
          exercise.equipment.toLowerCase().includes(q);
        score = muscleEq ? 10 : 5;
      }
    }

    return score;
  };

  const scored = candidates.map((ex) => ({
    ex,
    score: scoreExercise(ex, normalizedQuery),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.ex.name.localeCompare(b.ex.name);
  });

  return scored.slice(0, 30).map((s) => s.ex);
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

// ── Exercise Log CRUD ──────────────────────────────────────────────────────

export interface ExerciseLogSet {
  setNumber: number;
  weight: number;
  reps: number;
  volume: number;
}

export interface ExerciseLog {
  id: string;
  userId: string;
  coachId: string;
  exerciseId: string;
  exerciseName: string;
  muscle: string;
  sets: string; // JSON array of ExerciseLogSet
  totalVolume: number;
  loggedAt: string;
  createdAt: string;
}

export async function logExerciseWithVolume(params: {
  userId: string;
  coachId: string;
  exerciseId: string;
  exerciseName: string;
  muscle: string;
  sets: ExerciseLogSet[];
  totalVolume: number;
  loggedAt: string;
}): Promise<string> {
  const db = await getDatabase();
  const id = 'el_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO exercise_logs (id, userId, coachId, exerciseId, exerciseName, muscle, sets, totalVolume, loggedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.userId,
      params.coachId,
      params.exerciseId,
      params.exerciseName,
      params.muscle,
      JSON.stringify(params.sets),
      params.totalVolume,
      params.loggedAt,
      now,
    ]
  );
  return id;
}

export async function getWeeklyVolume(
  userId: string,
  weekStart: string,
  weekEnd: string
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(totalVolume), 0) as total FROM exercise_logs WHERE userId = ? AND loggedAt >= ? AND loggedAt <= ?`,
    [userId, weekStart, weekEnd]
  );
  return row?.total || 0;
}

export async function getDailyVolumeBreakdown(
  userId: string,
  weekStart: string,
  weekEnd: string
): Promise<Array<{ date: string; volume: number }>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ day: string; volume: number }>(
    `SELECT date(loggedAt) as day, SUM(totalVolume) as volume FROM exercise_logs WHERE userId = ? AND loggedAt >= ? AND loggedAt <= ? GROUP BY date(loggedAt) ORDER BY day`,
    [userId, weekStart, weekEnd]
  );
  return rows.map((r) => ({ date: r.day, volume: r.volume || 0 }));
}
