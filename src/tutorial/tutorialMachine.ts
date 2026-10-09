/**
 * tutorialMachine — the pure, action-gated step machine for the client tour.
 *
 * No React, no storage, no clock: every input arrives as an action and the
 * reducer returns the next state. That keeps gating, skip/resume and
 * completion fully unit-testable (see __tests__/tutorialMachine.test.ts).
 *
 * Rules:
 *   - A gate advances ONLY on its own kind of action: an `ack` gate on ACK, a
 *     `route` gate on ROUTE with a matching focused route, a `signal` gate on
 *     the matching SIGNAL (or DEFER where `allowDefer`). Anything else is a
 *     no-op, so stray taps and unrelated signals never move the tour.
 *   - Entering a step whose data is missing marks it `pending` (no plan or no
 *     macros yet) or `unavailable` (no coach linked for a step about the
 *     coach) and moves on; it never blocks the
 *     client (owner decision T-3).
 *   - A route gate that is already satisfied by where the client is standing
 *     advances immediately (no pointless "tap Home" while on Home).
 *   - PAUSE is the "Skip the tour" action: progress is kept, and RESUME picks
 *     up at the same gate. START with `restart` begins again from step one.
 */
import {
  stepRequirements,
  TUTORIAL_STEPS,
  type StepRequirement,
  type TutorialGate,
  type TutorialStepDef,
} from './tutorialSteps';
import type {
  TutorialContext,
  TutorialSignal,
  TutorialState,
  TutorialStepId,
  TutorialStepOutcome,
} from './types';

export interface MachineEnv extends TutorialContext {
  /** Focused route names, root to leaf (see navigationFocus.ts). */
  currentPath: string[];
  now: string;
}

export type TutorialAction =
  | { type: 'START'; restart?: boolean }
  | { type: 'ACK' }
  | { type: 'ROUTE' }
  | { type: 'SIGNAL'; signal: TutorialSignal }
  | { type: 'DEFER' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  /** Re-evaluate the current gate against a fresh env (route or data changed). */
  | { type: 'SYNC' };

export function initialTutorialState(): TutorialState {
  return {
    version: 2,
    status: 'not_started',
    stepIndex: 0,
    gateIndex: 0,
    outcomes: {},
    startedAt: null,
    completedAt: null,
    updatedAt: null,
  };
}

export function currentStep(state: TutorialState): TutorialStepDef | null {
  return TUTORIAL_STEPS[state.stepIndex] ?? null;
}

export function currentGate(state: TutorialState): TutorialGate | null {
  const step = currentStep(state);
  return step ? step.gates[state.gateIndex] ?? null : null;
}

function missingOutcome(
  need: StepRequirement,
  env: TutorialContext,
): TutorialStepOutcome | null {
  switch (need) {
    case 'program':
      return env.hasProgram ? null : 'pending';
    case 'macros':
      return env.hasMacros ? null : 'pending';
    case 'coach':
      return env.coachLinked ? null : 'unavailable';
    default:
      return null;
  }
}

/** The first unmet requirement decides how a skipped step is recorded. */
function requirementOutcome(
  step: TutorialStepDef,
  env: TutorialContext,
): TutorialStepOutcome | null {
  for (const need of stepRequirements(step)) {
    const missing = missingOutcome(need, env);
    if (missing) return missing;
  }
  return null;
}

function routeSatisfied(gate: TutorialGate | null, path: string[]): boolean {
  return gate?.kind === 'route' && gate.routes.some((r) => path.includes(r));
}

/**
 * Settle the state at the current position: skip steps whose data is missing
 * and auto-advance route gates already satisfied, until the machine rests on
 * a gate that needs the client.
 */
function settle(state: TutorialState, env: MachineEnv): TutorialState {
  let s = state;
  // Bounded loop: at most every gate of every step once.
  for (let guard = 0; guard < 64 && s.status === 'active'; guard++) {
    const step = currentStep(s);
    if (!step) return s;
    if (s.gateIndex === 0) {
      const missing = requirementOutcome(step, env);
      if (missing) {
        s = moveToStep(
          { ...s, outcomes: { ...s.outcomes, [step.id]: missing } },
          s.stepIndex + 1,
          env,
        );
        continue;
      }
    }
    if (routeSatisfied(currentGate(s), env.currentPath)) {
      s = advanceGate(s, env);
      continue;
    }
    return s;
  }
  return s;
}

function moveToStep(state: TutorialState, stepIndex: number, env: MachineEnv): TutorialState {
  if (stepIndex >= TUTORIAL_STEPS.length) {
    return { ...state, status: 'completed', completedAt: env.now, updatedAt: env.now };
  }
  return { ...state, stepIndex, gateIndex: 0, updatedAt: env.now };
}

function advanceGate(state: TutorialState, env: MachineEnv): TutorialState {
  const step = currentStep(state);
  if (!step) return state;
  if (state.gateIndex + 1 < step.gates.length) {
    return { ...state, gateIndex: state.gateIndex + 1, updatedAt: env.now };
  }
  const outcomes = { ...state.outcomes };
  if (!outcomes[step.id]) outcomes[step.id] = 'done';
  return moveToStep({ ...state, outcomes }, state.stepIndex + 1, env);
}

export function tutorialReducer(
  state: TutorialState,
  action: TutorialAction,
  env: MachineEnv,
): TutorialState {
  switch (action.type) {
    case 'START': {
      if (state.status === 'completed' && !action.restart) return state;
      if (state.status === 'active' && !action.restart) return settle(state, env);
      if (state.status === 'paused' && !action.restart) {
        return settle({ ...state, status: 'active', updatedAt: env.now }, env);
      }
      return settle(
        {
          ...initialTutorialState(),
          status: 'active',
          startedAt: env.now,
          updatedAt: env.now,
        },
        env,
      );
    }
    case 'RESUME': {
      if (state.status !== 'paused') return state;
      return settle({ ...state, status: 'active', updatedAt: env.now }, env);
    }
    case 'PAUSE': {
      if (state.status !== 'active') return state;
      return { ...state, status: 'paused', updatedAt: env.now };
    }
    case 'SYNC': {
      if (state.status !== 'active') return state;
      return settle(state, env);
    }
    case 'ACK': {
      if (state.status !== 'active' || currentGate(state)?.kind !== 'ack') return state;
      return settle(advanceGate(state, env), env);
    }
    case 'ROUTE': {
      if (state.status !== 'active') return state;
      return settle(state, env);
    }
    case 'SIGNAL': {
      const gate = currentGate(state);
      if (state.status !== 'active' || gate?.kind !== 'signal' || gate.signal !== action.signal) {
        return state;
      }
      return settle(advanceGate(state, env), env);
    }
    case 'DEFER': {
      const gate = currentGate(state);
      const step = currentStep(state);
      if (state.status !== 'active' || !step || gate?.kind !== 'signal' || !gate.allowDefer) {
        return state;
      }
      const deferred: TutorialState = {
        ...state,
        outcomes: { ...state.outcomes, [step.id]: 'deferred' },
      };
      return settle(advanceGate(deferred, env), env);
    }
    default:
      return state;
  }
}

/** Steps that finished between two states (for the per-step haptic + line). */
export function newlyFinishedSteps(prev: TutorialState, next: TutorialState): TutorialStepId[] {
  return (Object.keys(next.outcomes) as TutorialStepId[]).filter(
    (id) => !prev.outcomes[id] && next.outcomes[id] && next.outcomes[id] !== 'unavailable',
  );
}

/** 1-based position in the progress indicator, and the total counted steps. */
export function progressOf(state: TutorialState): { position: number; total: number } {
  const total = TUTORIAL_STEPS.length - 1;
  if (state.status === 'completed') return { position: total, total };
  return { position: Math.min(state.stepIndex + 1, total), total };
}

/** Parse a persisted blob defensively; anything unexpected starts fresh. */
export function parseTutorialState(raw: unknown): TutorialState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Omit<TutorialState, 'version'>> & { version?: unknown };
  // An older step list (v1: nine steps, eleven with Calendar): keep what the
  // client chose. Finished stays finished; a skipped tour stays skipped (never
  // restarts by itself, B-310-4) and resumes at the welcome; a running one
  // restarts there.
  if (r.version === 1 && (r.status === 'completed' || r.status === 'paused' || r.status === 'active')) {
    return {
      ...initialTutorialState(),
      status: r.status,
      stepIndex: r.status === 'completed' ? TUTORIAL_STEPS.length - 1 : 0,
      startedAt: typeof r.startedAt === 'string' ? r.startedAt : null,
      completedAt: r.status === 'completed' && typeof r.completedAt === 'string' ? r.completedAt : null,
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
    };
  }
  if (r.version !== 2) return null;
  if (!['not_started', 'active', 'paused', 'completed'].includes(String(r.status))) return null;
  const stepIndex = Number(r.stepIndex);
  const gateIndex = Number(r.gateIndex);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= TUTORIAL_STEPS.length) {
    return null;
  }
  const gates = TUTORIAL_STEPS[stepIndex].gates.length;
  return {
    version: 2,
    status: r.status as TutorialState['status'],
    stepIndex,
    gateIndex: Number.isInteger(gateIndex) && gateIndex >= 0 && gateIndex < gates ? gateIndex : 0,
    outcomes: r.outcomes && typeof r.outcomes === 'object' ? { ...r.outcomes } : {},
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : null,
    completedAt: typeof r.completedAt === 'string' ? r.completedAt : null,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
  };
}
