/**
 * macroDisplayStore — the per-user macro display mode (simple or full) and the
 * one-time introduction of carbohydrate and fat. Pure rules live in
 * macroDisplay.ts; this file only holds state and persistence.
 *
 * Fed by every place that already reads the server's answer:
 *   - `startClientTutorial()` / `setTutorialPayload()` (onboarding complete
 *     payload, or the `GET /me/onboarding` fallback);
 *   - `useMacroTargets()` (Log) and `useCurrentMacrosForSelf()` consumers
 *     (Macros screen, TutorialHost) for `GET /me/macros/current`.
 *
 * Persisted per user at `tgp.macroDisplay.v1:<userId>` so the mode survives a
 * cold start and a dismissed introduction stays dismissed. Only the mode, the
 * date and the dismissal are stored: no numbers, no answers.
 *
 * When the server never sends the field, the record stays at its default and
 * every surface renders 'full', exactly as before.
 */
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  effectiveMacroDisplayMode,
  emptyMacroDisplayRecord,
  mergeMacroDisplay,
  parseMacroDisplay,
  parseMacroDisplayRecord,
  shouldShowFullMacrosIntro,
  type MacroDisplayInfo,
  type MacroDisplayMode,
  type MacroDisplayRecord,
} from './macroDisplay';

export const MACRO_DISPLAY_STORAGE_PREFIX = 'tgp.macroDisplay.v1:';

export function macroDisplayStorageKey(userId: string): string {
  return `${MACRO_DISPLAY_STORAGE_PREFIX}${userId}`;
}

interface MacroDisplayStoreState {
  userId: string | null;
  hydrated: boolean;
  record: MacroDisplayRecord;
  /** Reports that arrived before the user resolved, in order; merged at hydration. */
  pending: MacroDisplayInfo[];
}

const initial = (): MacroDisplayStoreState => ({
  userId: null,
  hydrated: false,
  record: emptyMacroDisplayRecord(),
  pending: [],
});

export const useMacroDisplayStore = create<MacroDisplayStoreState>(() => initial());

function persist(): void {
  const s = useMacroDisplayStore.getState();
  if (!s.hydrated || !s.userId) return;
  void AsyncStorage.setItem(macroDisplayStorageKey(s.userId), JSON.stringify(s.record)).catch(
    () => undefined,
  );
}

/**
 * Report a server body (macros/current target, onboarding payload, or any
 * envelope around them). Bodies without `macro_display_mode` change nothing.
 */
export function reportMacroDisplay(raw: unknown): void {
  const info = parseMacroDisplay(raw);
  if (!info) return;
  const s = useMacroDisplayStore.getState();
  const record = mergeMacroDisplay(s.record, info);
  if (!s.hydrated) {
    useMacroDisplayStore.setState({ record, pending: [...s.pending, info] });
    return;
  }
  if (record === s.record) return;
  useMacroDisplayStore.setState({ record });
  persist();
}

/** Load the per-user record. Idempotent per user; a user switch never carries state over. */
export async function hydrateMacroDisplay(userId: string): Promise<void> {
  const before = useMacroDisplayStore.getState();
  if (before.hydrated && before.userId === userId) return;
  // A different user: forget the previous one before anything else reports.
  if (before.userId !== null && before.userId !== userId) useMacroDisplayStore.setState(initial(), true);
  let saved: MacroDisplayRecord | null = null;
  try {
    const raw = await AsyncStorage.getItem(macroDisplayStorageKey(userId));
    saved = raw ? parseMacroDisplayRecord(JSON.parse(raw)) : null;
  } catch {
    saved = null;
  }
  const cur = useMacroDisplayStore.getState();
  if (cur.hydrated && cur.userId === userId) return;
  // Reports made before any user resolved belong to whoever signs in first;
  // a report left over from a different signed-in user is dropped.
  const pending = cur.userId === null || cur.userId === userId ? cur.pending : [];
  const record = pending.reduce(mergeMacroDisplay, saved ?? emptyMacroDisplayRecord());
  useMacroDisplayStore.setState({ userId, hydrated: true, record, pending: [] });
  persist();
}

/** The client tapped the dismiss button on the carbohydrate and fat introduction. */
export function dismissFullMacrosIntro(now: Date = new Date()): void {
  const s = useMacroDisplayStore.getState();
  if (s.record.introDismissedAt) return;
  useMacroDisplayStore.setState({ record: { ...s.record, introDismissedAt: now.toISOString() } });
  persist();
}

export function selectMacroDisplayMode(
  s: Pick<MacroDisplayStoreState, 'record'>,
  now: Date = new Date(),
): MacroDisplayMode {
  return effectiveMacroDisplayMode(s.record, now);
}

/**
 * The mode to render now. Pass the signed-in user's id to hydrate the stored
 * record (Home and Log do); components without one read whatever is loaded.
 */
export function useMacroDisplayMode(userId?: string | null): MacroDisplayMode {
  useEffect(() => {
    if (userId) void hydrateMacroDisplay(userId);
  }, [userId]);
  return useMacroDisplayStore((s) => selectMacroDisplayMode(s));
}

export function useFullMacrosIntroVisible(): boolean {
  return useMacroDisplayStore((s) => s.hydrated && shouldShowFullMacrosIntro(s.record));
}

/** Test-only: reset the singleton between cases. */
export function __resetMacroDisplayStoreForTests(): void {
  useMacroDisplayStore.setState(initial(), true);
}
