import { getDatabase } from './database';
import { generateId } from '../utils/date';

export interface CoachMessage {
  id: string;
  coachId: string;
  clientId: string;
  senderId: string;
  senderRole: 'coach' | 'client';
  text: string;
  read: boolean;
  createdAt: string;
}

export interface ConversationPreview {
  clientId: string;
  clientName: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export async function initCoachMessagesTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS coach_messages (
      id TEXT PRIMARY KEY NOT NULL,
      coachId TEXT NOT NULL,
      clientId TEXT NOT NULL,
      senderId TEXT NOT NULL,
      senderRole TEXT NOT NULL DEFAULT 'coach',
      text TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coach_messages_convo ON coach_messages(coachId, clientId, createdAt);
  `);
}

export async function getConversations(coachId: string): Promise<ConversationPreview[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT cm.clientId, u.firstName || ' ' || u.lastName as clientName,
            cm.text as lastMessage, cm.createdAt as lastMessageTime,
            (SELECT COUNT(*) FROM coach_messages cm2 WHERE cm2.coachId = cm.coachId AND cm2.clientId = cm.clientId AND cm2.read = 0 AND cm2.senderRole = 'client') as unreadCount
     FROM coach_messages cm
     JOIN users u ON cm.clientId = u.id
     WHERE cm.coachId = ?
       AND cm.id = (SELECT id FROM coach_messages cm3 WHERE cm3.coachId = cm.coachId AND cm3.clientId = cm.clientId ORDER BY cm3.createdAt DESC LIMIT 1)
     ORDER BY cm.createdAt DESC`,
    [coachId]
  );
  return rows;
}

export async function getMessages(coachId: string, clientId: string, limit = 50): Promise<CoachMessage[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM coach_messages WHERE coachId = ? AND clientId = ? ORDER BY createdAt ASC LIMIT ?`,
    [coachId, clientId, limit]
  );
  return rows.map((r: any) => ({ ...r, read: !!r.read }));
}

export async function sendMessage(data: {
  coachId: string;
  clientId: string;
  senderId: string;
  senderRole: 'coach' | 'client';
  text: string;
}): Promise<CoachMessage> {
  const db = await getDatabase();
  const id = 'msg_' + generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO coach_messages (id, coachId, clientId, senderId, senderRole, text, read, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, data.coachId, data.clientId, data.senderId, data.senderRole, data.text, now]
  );
  return { id, ...data, read: false, createdAt: now };
}

export async function markConversationRead(coachId: string, clientId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE coach_messages SET read = 1 WHERE coachId = ? AND clientId = ? AND read = 0 AND senderRole = 'client'`,
    [coachId, clientId]
  );
}

export async function seedCoachMessagesIfNeeded(coachId: string): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM coach_messages WHERE coachId = ?',
    [coachId]
  );
  if ((existing?.count || 0) > 0) return;

  // Get coach's clients
  const clients = await db.getAllAsync<{ id: string; firstName: string }>(
    "SELECT id, firstName FROM users WHERE coachId = ? AND role = 'client' LIMIT 3",
    [coachId]
  );
  if (clients.length === 0) return;

  const now = new Date();
  const msgs = [
    { clientIdx: 0, senderRole: 'coach' as const, text: "Welcome! I'm excited to be your coach. Let's get started on your goals!", hoursAgo: 48 },
    { clientIdx: 0, senderRole: 'client' as const, text: "Thanks coach! I've been logging my meals. Any tips on hitting my protein target?", hoursAgo: 47 },
    { clientIdx: 0, senderRole: 'coach' as const, text: "Great job on the consistency! Try adding Greek yogurt or a protein shake post-workout. That should help bridge the gap.", hoursAgo: 46 },
    { clientIdx: 0, senderRole: 'client' as const, text: "That makes sense. I'll pick some up today. Should I adjust my carbs on rest days?", hoursAgo: 24 },
    { clientIdx: 0, senderRole: 'coach' as const, text: "For now let's keep macros consistent. Once we see 2 weeks of data we can talk about carb cycling. Keep up the great work!", hoursAgo: 23 },
  ];

  if (clients.length > 1) {
    msgs.push(
      { clientIdx: 1, senderRole: 'coach' as const, text: "Hey! I noticed you haven't logged today. Everything okay?", hoursAgo: 12 },
      { clientIdx: 1, senderRole: 'client' as const, text: "Sorry, busy day! I'll catch up tonight.", hoursAgo: 10 },
    );
  }

  for (const m of msgs) {
    const client = clients[m.clientIdx];
    if (!client) continue;
    const senderId = m.senderRole === 'coach' ? coachId : client.id;
    const id = 'msg_' + generateId();
    const createdAt = new Date(now.getTime() - m.hoursAgo * 60 * 60 * 1000).toISOString();
    await db.runAsync(
      `INSERT INTO coach_messages (id, coachId, clientId, senderId, senderRole, text, read, createdAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, coachId, client.id, senderId, m.senderRole, m.text, createdAt]
    );
  }
}
