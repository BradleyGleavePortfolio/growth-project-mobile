/**
 * Local resume draft for the coach consultation, one per user
 * (`coach_consult_v1:<user id>`). Written on every answer and step change,
 * read on open, purged after completion. It keeps the coach's place when the
 * backend routes are not deployed yet or the phone is offline.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isStepId, sanitizeAnswers } from './flow';
import type { CoachConsultAnswers, CoachStepId } from './types';

export const DRAFT_KEY_BASE = 'coach_consult_v1';

export interface CoachDraft {
  v: 1;
  answers: CoachConsultAnswers;
  step: CoachStepId;
  updatedAt: string;
}

export function draftKey(userId: string): string {
  return `${DRAFT_KEY_BASE}:${userId}`;
}

export async function readDraft(userId: string): Promise<CoachDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<CoachDraft>;
    if (d?.v !== 1 || !isStepId(d.step) || typeof d.updatedAt !== 'string') return null;
    return { v: 1, answers: sanitizeAnswers(d.answers), step: d.step, updatedAt: d.updatedAt };
  } catch {
    // Unreadable draft: start fresh; the server draft (if any) still resumes.
    return null;
  }
}

export async function writeDraft(
  userId: string,
  answers: CoachConsultAnswers,
  step: CoachStepId,
  now: Date = new Date(),
): Promise<void> {
  const draft: CoachDraft = { v: 1, answers, step, updatedAt: now.toISOString() };
  try {
    await AsyncStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    // Storage full or unavailable: the answers stay in memory and are sent at completion.
  }
}

export async function purgeDraft(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(draftKey(userId));
  } catch {
    // A leftover draft is ignored once the server says the consultation is complete.
  }
}
