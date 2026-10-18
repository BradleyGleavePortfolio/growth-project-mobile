import { getDatabase } from './database';
import { generateId } from '../utils/date';

export interface Lesson {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  content: string;
  durationMin: number;
  sortOrder: number;
  createdAt: string;
}

export interface LessonProgress {
  id: string;
  userId: string;
  lessonId: string;
  completed: boolean;
  completedAt: string | null;
}

export async function initEducationTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      durationMin INTEGER NOT NULL DEFAULT 5,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category);

    CREATE TABLE IF NOT EXISTS lesson_progress (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      lessonId TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      completedAt TEXT,
      UNIQUE(userId, lessonId)
    );
    CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(userId);
  `);
}

export async function getLessons(): Promise<Lesson[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Lesson>(
    'SELECT * FROM lessons ORDER BY sortOrder ASC'
  );
  return rows;
}

export async function getLessonById(lessonId: string): Promise<Lesson | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Lesson>(
    'SELECT * FROM lessons WHERE id = ?',
    [lessonId]
  );
  return row || null;
}

export async function getUserProgress(userId: string): Promise<LessonProgress[]> {
  const db = await getDatabase();
  type LessonProgressRow = Omit<LessonProgress, 'completed'> & { completed: number };
  const rows = await db.getAllAsync<LessonProgressRow>(
    'SELECT * FROM lesson_progress WHERE userId = ?',
    [userId]
  );
  return rows.map((r) => ({ ...r, completed: !!r.completed }));
}

export async function markLessonComplete(userId: string, lessonId: string): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM lesson_progress WHERE userId = ? AND lessonId = ?',
    [userId, lessonId]
  );
  const now = new Date().toISOString();
  if (existing) {
    await db.runAsync(
      'UPDATE lesson_progress SET completed = 1, completedAt = ? WHERE id = ?',
      [now, existing.id]
    );
  } else {
    const id = 'lp_' + generateId();
    await db.runAsync(
      'INSERT INTO lesson_progress (id, userId, lessonId, completed, completedAt) VALUES (?, ?, ?, 1, ?)',
      [id, userId, lessonId, now]
    );
  }
}
