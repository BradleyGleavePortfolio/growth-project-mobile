/**
 * Day-1 answers kept on this device, per account (B-441-1).
 *
 * The backend has no field for the Day-1 goals or the chosen check-in time
 * (PUT /profile and PATCH /notifications/preferences reject unknown keys), so
 * the answers are stored here, keyed by the signed-in user's id. The resume
 * checkpoint (resume.ts) is cleared when Day-1 finishes; this record is not,
 * so a finished client's answers are never silently dropped.
 *
 * Same pattern as onboarding.lean_q5_draft:<userId>: prefsStorage, swept on
 * sign-out (services/authActions USER_SCOPED_PREFIXES), so the next person on
 * the phone never inherits them and another account never reads them.
 */
import { prefsStorage } from '../../storage/mmkv';
import { logger } from '../../utils/logger';
import { readUserCache } from '../../lib/userCache';

export const DAY1_ANSWERS_KEY_PREFIX = 'onboarding.day1_answers:';

export interface DayOneCheckInTime {
  hour: number;
  minute: number;
}

export interface DayOneAnswers {
  goals?: string[];
  checkInTime?: DayOneCheckInTime;
  checkInTimezone?: string;
  savedAt: string;
}

export type DayOneAnswersPatch = Partial<Omit<DayOneAnswers, 'savedAt'>>;

function keyFor(userId: string): string {
  return `${DAY1_ANSWERS_KEY_PREFIX}${userId}`;
}

async function resolveUserId(userId?: string | null): Promise<string | null> {
  if (typeof userId === 'string' && userId) return userId;
  try {
    const cached = await readUserCache();
    return typeof cached?.id === 'string' && cached.id ? cached.id : null;
  } catch (err) {
    logger.warn('dayOneAnswers', 'signed-in user not readable', err);
    return null;
  }
}

function parse(raw: string | undefined): DayOneAnswers | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    return value as DayOneAnswers;
  } catch {
    return null;
  }
}

/** The Day-1 answers this account kept on this device, or null. */
export async function readDayOneAnswers(userId?: string | null): Promise<DayOneAnswers | null> {
  const id = await resolveUserId(userId);
  if (!id) return null;
  try {
    return parse(await prefsStorage.getStringAsync(keyFor(id)));
  } catch (err) {
    logger.warn('dayOneAnswers', 'answers not readable', err);
    return null;
  }
}

/**
 * Merges the given answers into this account's record. Only fields that are
 * present overwrite (a skipped step never erases an earlier answer).
 * Returns true when the record holds the answers (or there was nothing to
 * keep), false when no account is signed in or the write failed. Never throws.
 */
export async function keepDayOneAnswers(
  patch: DayOneAnswersPatch,
  userId?: string | null,
): Promise<boolean> {
  const next: DayOneAnswersPatch = {};
  if (Array.isArray(patch.goals)) next.goals = [...patch.goals];
  if (patch.checkInTime) next.checkInTime = { hour: patch.checkInTime.hour, minute: patch.checkInTime.minute };
  if (typeof patch.checkInTimezone === 'string' && patch.checkInTimezone) {
    next.checkInTimezone = patch.checkInTimezone;
  }
  if (Object.keys(next).length === 0) return true;
  const id = await resolveUserId(userId);
  if (!id) return false;
  try {
    const prev = parse(await prefsStorage.getStringAsync(keyFor(id)));
    const record: DayOneAnswers = { ...(prev ?? {}), ...next, savedAt: new Date().toISOString() };
    await prefsStorage.set(keyFor(id), JSON.stringify(record));
    return true;
  } catch (err) {
    logger.warn('dayOneAnswers', 'answers not saved', err);
    return false;
  }
}
