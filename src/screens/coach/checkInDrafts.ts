/**
 * CHECKIN-DRAFT-M (b#1234): which of Roman's drafts reply to a client's check-in, and the day words the sheet and the
 * list card draw. The rule is the server's (backend roman-message-draft.ts checkInEntryOf): a 'draft.coach_message'
 * whose first provenance entry with source 'check_in' has a string ref. Every other coach_message row stays undrawn.
 */
export interface CheckInDraft {
  draftId: string;
  clientId: string;
  checkInId: string;
  /** The check-in's day, YYYY-MM-DD (the provenance entry's date). */
  day: string;
  /** Roman's words as stored (payload.body). */
  body: string;
}

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The check-in draft a queue row is, or null. */
export function checkInDraftOf(row: { id?: unknown; capability?: unknown; subject_user_id?: unknown; payload?: unknown; provenance?: unknown }): CheckInDraft | null {
  if (row.capability !== 'draft.coach_message' || !Array.isArray(row.provenance)) return null;
  const entry = row.provenance.find((e): e is Record<string, unknown> => obj(e) && e.source === 'check_in' && typeof e.ref === 'string');
  const body = obj(row.payload) ? row.payload.body : undefined;
  if (!entry || typeof row.id !== 'string' || typeof row.subject_user_id !== 'string' || typeof body !== 'string') return null;
  return { draftId: row.id, clientId: row.subject_user_id, checkInId: entry.ref as string, day: typeof entry.date === 'string' ? entry.date.slice(0, 10) : '', body };
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "Today", "Yesterday" or "Nov 3" for a YYYY-MM-DD day, on the phone's calendar (as the Timeline's own dates). */
export function dayWord(day: string, now = new Date()): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day === localDay(now)) return 'Today';
  if (day === localDay(yesterday)) return 'Yesterday';
  return dateWord(day);
}

/** "Nov 3" for a YYYY-MM-DD day; '' when it is not one. */
export function dateWord(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The sheet's day line under the client's name (CD-36): "Today · Nov 6", "Yesterday · Nov 5", else "Nov 3". */
export function sheetDayLine(day: string, now = new Date()): string {
  const word = dayWord(day, now);
  const date = dateWord(day);
  return word === date ? date : `${word} · ${date}`;
}
