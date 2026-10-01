/**
 * tutorialStorage — per-user persistence of tour progress and the onboarding
 * payload the explanation cards read (owner decision T-2: AsyncStorage per
 * user for v1, no server persistence; a reinstall re-runs a short tour).
 *
 * Key: `tgp.clientTutorial.v1:<userId>`. One key per user so a shared device
 * never shows one client's numbers to another.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseTutorialState } from './tutorialMachine';
import type { OnboardingCompletePayload, TutorialState } from './types';

export const TUTORIAL_STORAGE_PREFIX = 'tgp.clientTutorial.v1:';

export interface PersistedTutorial {
  state: TutorialState;
  payload: OnboardingCompletePayload | null;
}

export function tutorialStorageKey(userId: string): string {
  return `${TUTORIAL_STORAGE_PREFIX}${userId}`;
}

export async function loadTutorial(userId: string): Promise<PersistedTutorial | null> {
  try {
    const raw = await AsyncStorage.getItem(tutorialStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: unknown; payload?: unknown };
    const state = parseTutorialState(parsed.state);
    if (!state) return null;
    const payload =
      parsed.payload && typeof parsed.payload === 'object'
        ? (parsed.payload as OnboardingCompletePayload)
        : null;
    return { state, payload };
  } catch {
    return null;
  }
}

export async function saveTutorial(userId: string, value: PersistedTutorial): Promise<void> {
  try {
    await AsyncStorage.setItem(tutorialStorageKey(userId), JSON.stringify(value));
  } catch {
    // Persistence is best effort; the in-memory tour continues.
  }
}
