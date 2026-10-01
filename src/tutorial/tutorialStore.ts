/**
 * tutorialStore — the live client tutorial: step machine state, the
 * onboarding payload the explanation cards read, spotlight target rects, and
 * the integration entry point `startClientTutorial()`.
 *
 * The store is the only place that dispatches into the pure machine. Every
 * transition is persisted per user and produces feedback: a selection haptic
 * when a gate advances, a success haptic plus Roman's done line when a step
 * finishes.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import { featureFlags } from '../config/featureFlags';
import { HapticService } from '../ui/haptics/haptics.service';
import {
  initialTutorialState,
  newlyFinishedSteps,
  tutorialReducer,
  type MachineEnv,
  type TutorialAction,
} from './tutorialMachine';
import { saveTutorial, loadTutorial } from './tutorialStorage';
import { TUTORIAL_STEPS, type CopyContext, type TutorialTargetId } from './tutorialSteps';
import { subscribeTutorialSignals } from './tutorialEvents';
import { parseOnboardingPayload } from './onboardingPayload';
import type {
  OnboardingCompletePayload,
  OnboardingMacros,
  TutorialState,
  TutorialStepId,
} from './types';

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TutorialCelebration {
  stepId: TutorialStepId;
  at: number;
}

interface TutorialStoreState {
  userId: string | null;
  hydrated: boolean;
  firstName: string | null;
  tutorial: TutorialState;
  payload: OnboardingCompletePayload | null;
  /** Live `/me/macros/current` numbers, preferred over the payload snapshot. */
  liveMacros: OnboardingMacros | null;
  currentPath: string[];
  targets: Partial<Record<TutorialTargetId, TargetRect>>;
  celebration: TutorialCelebration | null;
  pendingStart: { restart: boolean } | null;
}

const initial = (): TutorialStoreState => ({
  userId: null,
  hydrated: false,
  firstName: null,
  tutorial: initialTutorialState(),
  payload: null,
  liveMacros: null,
  currentPath: [],
  targets: {},
  celebration: null,
  pendingStart: null,
});

export const useTutorialStore = create<TutorialStoreState>(() => initial());

/** Live macros win (a coach may adjust them later); else the payload snapshot. */
export function resolveMacros(s: Pick<TutorialStoreState, 'liveMacros' | 'payload'>): OnboardingMacros | null {
  const m = s.liveMacros ?? s.payload?.macros ?? null;
  if (!m) return null;
  const ok = [m.calories, m.protein_g, m.carbs_g, m.fat_g].every(
    (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  );
  return ok && m.calories > 0 ? m : null;
}

function envOf(s: TutorialStoreState): MachineEnv {
  return {
    hasProgram: !!s.payload?.program?.name,
    hasMacros: !!resolveMacros(s),
    communityAvailable: featureFlags.communityTab,
    currentPath: s.currentPath,
    now: new Date().toISOString(),
  };
}

export function buildCopyContext(s: TutorialStoreState): CopyContext {
  const os = Platform.OS;
  return {
    firstName: s.firstName,
    coachName: s.payload?.coach?.display_name?.trim() || 'your coach',
    program: s.payload?.program ?? null,
    macros: resolveMacros(s),
    spaces: Array.isArray(s.payload?.spaces) ? (s.payload?.spaces ?? []) : [],
    platform: os === 'ios' ? 'ios' : os === 'android' ? 'android' : 'other',
  };
}

function persist(s: TutorialStoreState): void {
  if (!s.userId) return;
  void saveTutorial(s.userId, { state: s.tutorial, payload: s.payload });
}

export function dispatchTutorial(action: TutorialAction): void {
  const s = useTutorialStore.getState();
  if (!s.hydrated || !s.userId) return;
  const prev = s.tutorial;
  const next = tutorialReducer(prev, action, envOf(s));
  if (next === prev) return;
  const finished = newlyFinishedSteps(prev, next);
  const celebrate = finished
    .map((id) => TUTORIAL_STEPS.find((st) => st.id === id))
    .reverse()
    .find((st) => st && st.doneLine && next.outcomes[st.id] !== 'pending');
  useTutorialStore.setState({
    tutorial: next,
    celebration: celebrate ? { stepId: celebrate.id, at: Date.now() } : s.celebration,
  });
  persist(useTutorialStore.getState());
  if (finished.length > 0 || next.status === 'completed') {
    void HapticService.success();
  } else if (next.gateIndex !== prev.gateIndex || next.stepIndex !== prev.stepIndex) {
    void HapticService.selection();
  }
  if (action.type === 'PAUSE') void HapticService.warning();
}

/**
 * Integration entry point. Call once when onboarding completes (after the
 * plan reveal), passing the `POST /me/onboarding/complete` 200 body:
 *
 *   startClientTutorial(completeResponse);
 *
 * Idempotent: a finished tour does not restart (pass `{ restart: true }` to
 * run it again, as Settings > Tutorial does). Safe to call before the client
 * navigator mounts or before the user id resolves; the start is queued until
 * the per-user state is loaded. Returns false when the tutorial flag is off.
 */
export function startClientTutorial(
  payload?: OnboardingCompletePayload | unknown,
  opts?: { restart?: boolean },
): boolean {
  if (!featureFlags.clientTutorial) return false;
  const restart = !!opts?.restart;
  const parsed = parseOnboardingPayload(payload);
  if (parsed) useTutorialStore.setState({ payload: parsed });
  const s = useTutorialStore.getState();
  if (!s.hydrated || !s.userId) {
    useTutorialStore.setState({ pendingStart: { restart } });
    return true;
  }
  dispatchTutorial({ type: 'START', restart });
  persist(useTutorialStore.getState());
  return true;
}

/** Load the per-user state. Called by TutorialHost when the user resolves. */
export async function hydrateTutorial(
  userId: string,
  firstName: string | null,
): Promise<void> {
  const before = useTutorialStore.getState();
  if (before.hydrated && before.userId === userId) {
    if (firstName !== before.firstName) useTutorialStore.setState({ firstName });
    return;
  }
  const saved = await loadTutorial(userId);
  const cur = useTutorialStore.getState();
  useTutorialStore.setState({
    userId,
    firstName,
    hydrated: true,
    tutorial: saved?.state ?? initialTutorialState(),
    // A payload handed to startClientTutorial() before hydration wins; a
    // payload left over from a different signed-in user never carries over.
    payload: (cur.userId === null ? cur.payload : null) ?? saved?.payload ?? null,
    pendingStart: cur.userId === null ? cur.pendingStart : null,
    liveMacros: cur.userId === userId ? cur.liveMacros : null,
    targets: {},
    celebration: null,
  });
  const pending: { restart: boolean } | null = useTutorialStore.getState().pendingStart;
  if (pending) {
    useTutorialStore.setState({ pendingStart: null });
    dispatchTutorial({ type: 'START', restart: pending.restart });
  }
  persist(useTutorialStore.getState());
}

export function setTutorialRoute(path: string[]): void {
  const s = useTutorialStore.getState();
  if (s.currentPath.join('/') === path.join('/')) return;
  useTutorialStore.setState({ currentPath: path });
  dispatchTutorial({ type: 'ROUTE' });
}

export function setTutorialLiveMacros(m: OnboardingMacros | null): void {
  const s = useTutorialStore.getState();
  if (JSON.stringify(s.liveMacros) === JSON.stringify(m)) return;
  useTutorialStore.setState({ liveMacros: m });
  dispatchTutorial({ type: 'SYNC' });
}

export function setTutorialPayload(payload: OnboardingCompletePayload | null): void {
  useTutorialStore.setState({ payload });
  persist(useTutorialStore.getState());
  dispatchTutorial({ type: 'SYNC' });
}

export function registerTutorialTarget(id: TutorialTargetId, rect: TargetRect | null): void {
  const targets = { ...useTutorialStore.getState().targets };
  if (rect) targets[id] = rect;
  else delete targets[id];
  useTutorialStore.setState({ targets });
}

export function clearTutorialCelebration(): void {
  useTutorialStore.setState({ celebration: null });
}

let unsubscribeSignals: (() => void) | null = null;

/** Wire real-world signals into the machine. Idempotent. */
export function attachTutorialSignals(): () => void {
  if (!unsubscribeSignals) {
    unsubscribeSignals = subscribeTutorialSignals((signal) => {
      dispatchTutorial({ type: 'SIGNAL', signal });
    });
  }
  return () => {
    unsubscribeSignals?.();
    unsubscribeSignals = null;
  };
}

/** Test-only: reset the singleton store between cases. */
export function __resetTutorialStoreForTests(): void {
  unsubscribeSignals?.();
  unsubscribeSignals = null;
  useTutorialStore.setState(initial(), true);
}
