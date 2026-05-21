/**
 * Day-1 onboarding resume + offline-draft persistence.
 *
 * Two concerns share one storage key so a force-close mid-flow and an
 * offline "Save and try later" both round-trip through the same shape:
 *
 *  - `step` is the route name the user should land on when the navigator
 *    remounts (a force-close from CheckInTime should not put them back at
 *    Welcome).
 *  - `draft` carries the per-screen values that were typed-but-not-yet-saved.
 *  - `pendingSync` is the queue of step payloads that failed their network
 *    call. The background sync helper drains this when connectivity returns.
 *
 * AsyncStorage is the right backend here: small (under a few KB), and the
 * Day-1 stack is unauthenticated-adjacent — secure storage would be overkill.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveGoals,
  saveNotifPermission,
  saveCheckInTime,
  completeDayOne,
  type GoalKey,
  type CheckInTime,
} from './api';

const STORAGE_KEY = 'day_one_onboarding_state_v1';

export type DayOneStepName =
  | 'Welcome'
  | 'CoachPairing'
  | 'Goals'
  | 'Notifications'
  | 'CheckInTime'
  | 'Ready';

export interface DayOneDraft {
  inviteCode?: string;
  goals?: GoalKey[];
  notifState?: 'granted' | 'denied' | 'skipped';
  checkInTime?: CheckInTime;
  checkInTimezone?: string;
}

export type PendingSyncItem =
  | { kind: 'goals'; goals: GoalKey[] }
  | { kind: 'notif'; state: 'granted' | 'denied' | 'skipped' }
  | { kind: 'checkin'; time: CheckInTime; timezone: string }
  | { kind: 'complete' };

export interface DayOneResumeState {
  step: DayOneStepName;
  draft: DayOneDraft;
  pendingSync: PendingSyncItem[];
  updatedAt: number;
}

export async function readResumeState(): Promise<DayOneResumeState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DayOneResumeState;
    if (!parsed || typeof parsed !== 'object' || !parsed.step) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeResumeState(
  patch: Partial<DayOneResumeState>,
): Promise<void> {
  try {
    const prev = (await readResumeState()) ?? {
      step: 'Welcome' as DayOneStepName,
      draft: {},
      pendingSync: [],
      updatedAt: Date.now(),
    };
    const next: DayOneResumeState = {
      step: patch.step ?? prev.step,
      draft: { ...prev.draft, ...(patch.draft ?? {}) },
      pendingSync: patch.pendingSync ?? prev.pendingSync,
      updatedAt: Date.now(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Fail-open: a write miss must never block the flow. The user keeps
    // going; on the next advance we try again.
  }
}

export async function clearResumeState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — stale state isn't harmful; readResumeState handles missing keys.
  }
}

export async function enqueuePending(item: PendingSyncItem): Promise<void> {
  const prev = await readResumeState();
  const queue = prev?.pendingSync ?? [];
  await writeResumeState({ pendingSync: [...queue, item] });
}

/**
 * Drain the pending queue against the network. Each item is retried once;
 * items that still fail stay in the queue for the next sync attempt. Returns
 * the number of successfully-flushed items so callers can decide whether to
 * keep the local copy or clear it.
 */
export async function flushPendingSync(): Promise<number> {
  const state = await readResumeState();
  if (!state || state.pendingSync.length === 0) return 0;
  const remaining: PendingSyncItem[] = [];
  let flushed = 0;
  for (const item of state.pendingSync) {
    try {
      if (item.kind === 'goals') await saveGoals(item.goals);
      else if (item.kind === 'notif') await saveNotifPermission(item.state);
      else if (item.kind === 'checkin')
        await saveCheckInTime(item.time, item.timezone);
      else if (item.kind === 'complete') await completeDayOne();
      flushed += 1;
    } catch {
      remaining.push(item);
    }
  }
  if (remaining.length === 0) {
    if (state.step === 'Ready') await clearResumeState();
    else await writeResumeState({ pendingSync: [] });
  } else {
    await writeResumeState({ pendingSync: remaining });
  }
  return flushed;
}
