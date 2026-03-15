import { getDatabase } from './database';
import { generateId, getTodayString } from '../utils/date';

export interface Challenge {
  id: string;
  title: string;
  description: string;
  category: string;
  targetValue: number;
  unit: string;
  durationDays: number;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
}

export interface ChallengeParticipant {
  id: string;
  challengeId: string;
  userId: string;
  currentValue: number;
  completed: boolean;
  joinedAt: string;
}

export interface WinEntry {
  id: string;
  userId: string;
  userName: string;
  type: 'streak' | 'challenge' | 'weight' | 'workout' | 'habit' | 'lesson';
  title: string;
  description: string;
  createdAt: string;
}

export interface LeaderboardEntry {
  userId: string;
  userName: string;
  points: number;
  rank: number;
}

export async function initCommunityTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      targetValue REAL NOT NULL,
      unit TEXT NOT NULL,
      durationDays INTEGER NOT NULL,
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_active ON challenges(active);

    CREATE TABLE IF NOT EXISTS challenge_participants (
      id TEXT PRIMARY KEY NOT NULL,
      challengeId TEXT NOT NULL,
      userId TEXT NOT NULL,
      currentValue REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      joinedAt TEXT NOT NULL,
      UNIQUE(challengeId, userId)
    );
    CREATE INDEX IF NOT EXISTS idx_challenge_parts_user ON challenge_participants(userId);

    CREATE TABLE IF NOT EXISTS wins (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      userName TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wins_created ON wins(createdAt DESC);

    CREATE TABLE IF NOT EXISTS points (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_points_user ON points(userId);
  `);
}

export async function getChallenges(): Promise<Challenge[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM challenges WHERE active = 1 ORDER BY createdAt DESC'
  );
  return rows.map((r: any) => ({ ...r, active: !!r.active }));
}

export async function getUserChallenges(userId: string): Promise<(ChallengeParticipant & { challenge: Challenge })[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT cp.*, c.title, c.description, c.category, c.targetValue, c.unit, c.durationDays, c.startDate, c.endDate, c.active, c.createdAt as challengeCreatedAt
     FROM challenge_participants cp
     JOIN challenges c ON cp.challengeId = c.id
     WHERE cp.userId = ?
     ORDER BY cp.joinedAt DESC`,
    [userId]
  );
  return rows.map((r: any) => ({
    id: r.id,
    challengeId: r.challengeId,
    userId: r.userId,
    currentValue: r.currentValue,
    completed: !!r.completed,
    joinedAt: r.joinedAt,
    challenge: {
      id: r.challengeId,
      title: r.title,
      description: r.description,
      category: r.category,
      targetValue: r.targetValue,
      unit: r.unit,
      durationDays: r.durationDays,
      startDate: r.startDate,
      endDate: r.endDate,
      active: !!r.active,
      createdAt: r.challengeCreatedAt,
    },
  }));
}

export async function joinChallenge(userId: string, challengeId: string): Promise<void> {
  const db = await getDatabase();
  const id = 'cp_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT OR IGNORE INTO challenge_participants (id, challengeId, userId, currentValue, completed, joinedAt) VALUES (?, ?, ?, 0, 0, ?)',
    [id, challengeId, userId, now]
  );
}

export async function updateChallengeProgress(userId: string, challengeId: string, value: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE challenge_participants SET currentValue = ? WHERE userId = ? AND challengeId = ?',
    [value, userId, challengeId]
  );
  // Check if completed
  const challenge = await db.getFirstAsync<any>('SELECT targetValue FROM challenges WHERE id = ?', [challengeId]);
  if (challenge && value >= challenge.targetValue) {
    await db.runAsync(
      'UPDATE challenge_participants SET completed = 1 WHERE userId = ? AND challengeId = ?',
      [userId, challengeId]
    );
  }
}

export async function getWinsFeed(limit = 30): Promise<WinEntry[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM wins ORDER BY createdAt DESC LIMIT ?',
    [limit]
  );
  return rows;
}

export async function addWin(data: { userId: string; userName: string; type: WinEntry['type']; title: string; description: string }): Promise<void> {
  const db = await getDatabase();
  const id = 'win_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO wins (id, userId, userName, type, title, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, data.userId, data.userName, data.type, data.title, data.description, now]
  );
}

export async function addPoints(userId: string, amount: number, reason: string): Promise<void> {
  const db = await getDatabase();
  const id = 'pts_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO points (id, userId, amount, reason, createdAt) VALUES (?, ?, ?, ?, ?)',
    [id, userId, amount, reason, now]
  );
}

export async function getLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT p.userId, u.firstName || ' ' || u.lastName as userName, SUM(p.amount) as points
     FROM points p
     JOIN users u ON p.userId = u.id
     GROUP BY p.userId
     ORDER BY points DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map((r: any, idx: number) => ({
    userId: r.userId,
    userName: r.userName,
    points: r.points,
    rank: idx + 1,
  }));
}

export async function getUserPoints(userId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) as total FROM points WHERE userId = ?',
    [userId]
  );
  return row?.total || 0;
}

export async function seedCommunityIfNeeded(): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM challenges'
  );
  if ((existing?.count || 0) > 0) return;

  const today = getTodayString();
  const now = new Date().toISOString();

  const endDate7 = new Date();
  endDate7.setDate(endDate7.getDate() + 7);
  const end7 = endDate7.toISOString().split('T')[0];

  const endDate14 = new Date();
  endDate14.setDate(endDate14.getDate() + 14);
  const end14 = endDate14.toISOString().split('T')[0];

  const endDate30 = new Date();
  endDate30.setDate(endDate30.getDate() + 30);
  const end30 = endDate30.toISOString().split('T')[0];

  const challenges = [
    { title: '7-Day Protein Challenge', description: 'Hit your protein target every day for a week', category: 'nutrition', targetValue: 7, unit: 'days', durationDays: 7, endDate: end7 },
    { title: 'Hydration Hero', description: 'Drink 64oz+ of water daily for 14 days', category: 'nutrition', targetValue: 14, unit: 'days', durationDays: 14, endDate: end14 },
    { title: '30-Day Workout Streak', description: 'Complete at least one workout every day for 30 days', category: 'fitness', targetValue: 30, unit: 'workouts', durationDays: 30, endDate: end30 },
    { title: '10K Steps Challenge', description: 'Walk 10,000+ steps daily for 7 days', category: 'fitness', targetValue: 7, unit: 'days', durationDays: 7, endDate: end7 },
    { title: 'Meal Prep Master', description: 'Prep all your meals for the week ahead', category: 'nutrition', targetValue: 5, unit: 'days prepped', durationDays: 7, endDate: end7 },
    { title: 'No Sugar Week', description: 'Avoid added sugars for 7 consecutive days', category: 'nutrition', targetValue: 7, unit: 'days', durationDays: 7, endDate: end7 },
  ];

  for (const c of challenges) {
    const id = 'chal_' + generateId();
    await db.runAsync(
      'INSERT INTO challenges (id, title, description, category, targetValue, unit, durationDays, startDate, endDate, active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
      [id, c.title, c.description, c.category, c.targetValue, c.unit, c.durationDays, today, c.endDate, now]
    );
  }

  // Seed some demo wins
  const users = await db.getAllAsync<{ id: string; firstName: string; lastName: string }>(
    "SELECT id, firstName, lastName FROM users WHERE role = 'client' LIMIT 3"
  );

  const demoWins = [
    { type: 'streak' as const, title: '7-Day Logging Streak!', description: 'Logged meals for 7 days straight' },
    { type: 'workout' as const, title: 'First Workout Complete!', description: 'Completed their first workout session' },
    { type: 'weight' as const, title: 'Goal Weight Reached!', description: 'Lost 5 lbs and hit their target' },
    { type: 'habit' as const, title: 'Habit Master', description: 'Completed all daily habits for a week' },
    { type: 'lesson' as const, title: 'Knowledge Seeker', description: 'Completed 10 education lessons' },
  ];

  for (let i = 0; i < demoWins.length; i++) {
    const user = users[i % users.length];
    if (!user) continue;
    const w = demoWins[i];
    const id = 'win_' + generateId();
    const createdAt = new Date(Date.now() - (i * 8 + 2) * 60 * 60 * 1000).toISOString();
    await db.runAsync(
      'INSERT INTO wins (id, userId, userName, type, title, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, user.id, `${user.firstName} ${user.lastName}`, w.type, w.title, w.description, createdAt]
    );
  }

  // Seed demo points
  for (const user of users) {
    const pts = Math.floor(Math.random() * 500) + 100;
    const id = 'pts_' + generateId();
    await db.runAsync(
      'INSERT INTO points (id, userId, amount, reason, createdAt) VALUES (?, ?, ?, ?, ?)',
      [id, user.id, pts, 'Initial activity points', now]
    );
  }
}
