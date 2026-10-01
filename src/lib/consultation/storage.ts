/**
 * Local resume state for the consultation, per user.
 *
 * The server copy (PUT /me/onboarding/consultation) is saved at the end of
 * every chapter. This local copy is written on every answer so a closed app
 * reopens on the same screen even between chapter saves or while offline.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Answers } from './types';

export interface LocalConsultationState {
  version: 'consult-v1';
  answers: Answers;
  screenId: string;
  updatedAt: string;
  /** True once a chapter save has reached the server. */
  serverSynced?: boolean;
}

export function storageKey(userId: string | null | undefined): string {
  return `consultation_v1:${userId || 'anon'}`;
}

export async function readLocalState(userId: string | null | undefined): Promise<LocalConsultationState | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalConsultationState;
    if (parsed?.version !== 'consult-v1' || typeof parsed.answers !== 'object' || !parsed.answers) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeLocalState(
  userId: string | null | undefined,
  state: Omit<LocalConsultationState, 'version' | 'updatedAt'>,
): Promise<void> {
  const full: LocalConsultationState = { version: 'consult-v1', updatedAt: new Date().toISOString(), ...state };
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(full));
  } catch {
    // Storage failure is non-fatal: the server copy is saved per chapter.
  }
}

export async function clearLocalState(userId: string | null | undefined): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId));
  } catch {
    // Non-fatal.
  }
}
