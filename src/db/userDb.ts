import { getDatabase } from './database';
import { User } from '../types';
import { generateId } from '../utils/date';

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<User>(
    'SELECT * FROM users WHERE email = ? AND status = ?',
    [email.toLowerCase().trim(), 'active']
  );
  return row || null;
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<User>(
    'SELECT * FROM users WHERE id = ?',
    [id]
  );
  return row || null;
}

export async function createUser(data: {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: 'coach' | 'client';
  coachId?: string;
}): Promise<User> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = data.role + '_' + generateId();

  await db.runAsync(
    `INSERT INTO users (id, role, email, passwordHash, firstName, lastName, coachId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.role, data.email.toLowerCase().trim(), data.passwordHash, data.firstName, data.lastName, data.coachId || null, 'active', now, now]
  );

  return {
    id,
    role: data.role,
    email: data.email.toLowerCase().trim(),
    passwordHash: data.passwordHash,
    firstName: data.firstName,
    lastName: data.lastName,
    coachId: data.coachId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export async function getClientsByCoachId(coachId: string): Promise<User[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<User>(
    'SELECT * FROM users WHERE coachId = ? AND role = ? ORDER BY firstName ASC',
    [coachId, 'client']
  );
  return rows;
}

export async function getCoachUser(): Promise<User | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<User>(
    "SELECT * FROM users WHERE role = 'coach' LIMIT 1"
  );
  return row || null;
}

export async function updateUserPassword(userId: string, newPasswordHash: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?',
    [newPasswordHash, new Date().toISOString(), userId]
  );
}
