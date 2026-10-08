/**
 * tutorialStore — integration of the pure machine with per-user persistence,
 * the startClientTutorial() entry point, real-world signals and haptics.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockFlags = { clientTutorial: true, communityTab: true };
jest.mock('../../config/featureFlags', () => ({
  featureFlags: {
    get clientTutorial() {
      return mockFlags.clientTutorial;
    },
    get communityTab() {
      return mockFlags.communityTab;
    },
  },
}));

const mockHaptics = {
  success: jest.fn(() => Promise.resolve()),
  selection: jest.fn(() => Promise.resolve()),
  warning: jest.fn(() => Promise.resolve()),
};
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: {
    success: () => mockHaptics.success(),
    selection: () => mockHaptics.selection(),
    warning: () => mockHaptics.warning(),
  },
}));

import {
  __resetTutorialStoreForTests,
  attachTutorialSignals,
  buildCopyContext,
  dispatchTutorial,
  hydrateTutorial,
  resolveMacros,
  setTutorialLiveMacros,
  setTutorialRoute,
  startClientTutorial,
  useTutorialStore,
} from '../tutorialStore';
import { emitTutorialSignal } from '../tutorialEvents';
import { tutorialStorageKey, loadTutorial } from '../tutorialStorage';
import { currentStep } from '../tutorialMachine';
import type { OnboardingCompletePayload } from '../types';

const PAYLOAD: OnboardingCompletePayload = {
  macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50, method: 'mifflin', floor_applied: false },
  program: { id: 'p1', name: 'Foundations', days_per_week: 3, weeks: 4, why: ['You are new to lifting.'] },
  spaces: [
    { id: 's1', name: 'All members' },
    { id: 's2', name: 'Foundations group' },
  ],
  coach: { id: 'c1', display_name: 'Bradley' },
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const step = () => currentStep(useTutorialStore.getState().tutorial)?.id;

beforeEach(async () => {
  __resetTutorialStoreForTests();
  mockFlags.clientTutorial = true;
  mockFlags.communityTab = true;
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('startClientTutorial', () => {
  it('returns false and does nothing when the flag is off (rollback lever)', async () => {
    mockFlags.clientTutorial = false;
    await hydrateTutorial('u1', 'Maya');
    expect(startClientTutorial(PAYLOAD)).toBe(false);
    expect(useTutorialStore.getState().tutorial.status).toBe('not_started');
    expect(useTutorialStore.getState().payload).toBeNull();
  });

  it('queues a start fired before the user resolves, then begins on hydration', async () => {
    expect(startClientTutorial(PAYLOAD)).toBe(true);
    expect(useTutorialStore.getState().tutorial.status).toBe('not_started');
    await hydrateTutorial('u1', 'Maya');
    expect(useTutorialStore.getState().tutorial.status).toBe('active');
    expect(step()).toBe('welcome');
    expect(useTutorialStore.getState().payload?.program?.name).toBe('Foundations');
  });

  it('is idempotent and never restarts a completed tour on its own', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    dispatchTutorial({ type: 'ACK' });
    expect(step()).toBe('plan');
    startClientTutorial(PAYLOAD);
    expect(step()).toBe('plan');
  });

  it('drops malformed payload fields instead of inventing numbers', async () => {
    await hydrateTutorial('u1', null);
    startClientTutorial({ macros: { calories: 'lots' }, program: { name: '' } });
    expect(useTutorialStore.getState().payload).toBeNull();
    expect(resolveMacros(useTutorialStore.getState())).toBeNull();
  });
});

describe('persistence', () => {
  it('persists per user and restores the exact position', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    dispatchTutorial({ type: 'ACK' });
    setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
    await flush();
    const saved = await loadTutorial('u1');
    expect(saved?.state.stepIndex).toBe(1);
    expect(saved?.state.gateIndex).toBe(1);
    expect(saved?.payload?.coach?.display_name).toBe('Bradley');

    __resetTutorialStoreForTests();
    await hydrateTutorial('u1', 'Maya');
    expect(step()).toBe('plan');
    expect(useTutorialStore.getState().tutorial.gateIndex).toBe(1);
  });

  it('never shows one user the other user\'s tour or numbers', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    await flush();
    await hydrateTutorial('u2', 'Sam');
    const s = useTutorialStore.getState();
    expect(s.userId).toBe('u2');
    expect(s.tutorial.status).toBe('not_started');
    expect(s.payload).toBeNull();
    expect(await AsyncStorage.getItem(tutorialStorageKey('u2'))).not.toContain('Foundations');
  });

  it('keeps a skipped tour paused across restarts, and resumes it', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    dispatchTutorial({ type: 'PAUSE' });
    await flush();
    __resetTutorialStoreForTests();
    await hydrateTutorial('u1', 'Maya');
    expect(useTutorialStore.getState().tutorial.status).toBe('paused');
    dispatchTutorial({ type: 'RESUME' });
    expect(useTutorialStore.getState().tutorial.status).toBe('active');
    expect(step()).toBe('welcome');
  });
});

describe('signals and feedback', () => {
  async function toFirstMeal() {
    await hydrateTutorial('u1', 'Maya', true);
    attachTutorialSignals();
    startClientTutorial(PAYLOAD);
    dispatchTutorial({ type: 'ACK' });
    setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
    emitTutorialSignal('plan_card_opened');
    setTutorialRoute(['Home', 'HomeMain']);
    emitTutorialSignal('macro_card_opened');
    setTutorialRoute(['CommunityTab', 'CommunityTab']);
    dispatchTutorial({ type: 'ACK' });
    setTutorialRoute(['Home', 'Messages']);
    dispatchTutorial({ type: 'ACK' });
    setTutorialRoute(['MoreTab', 'Connections']);
    dispatchTutorial({ type: 'DEFER' });
    setTutorialRoute(['MoreTab', 'Health']);
    dispatchTutorial({ type: 'ACK' });
    setTutorialRoute(['Log']);
  }

  it('advances on real signals, completes, and persists completion', async () => {
    await toFirstMeal();
    expect(step()).toBe('first_meal');
    emitTutorialSignal('message_sent'); // wrong signal: ignored
    expect(step()).toBe('first_meal');
    emitTutorialSignal('meal_logged');
    expect(step()).toBe('first_message');
    setTutorialRoute(['Home', 'Messages']);
    emitTutorialSignal('message_sent');
    expect(step()).toBe('complete');
    dispatchTutorial({ type: 'ACK' });
    const s = useTutorialStore.getState().tutorial;
    expect(s.status).toBe('completed');
    expect(s.outcomes.wearables).toBe('deferred');
    expect(s.outcomes.first_meal).toBe('done');
    expect(s.outcomes.first_message).toBe('done');
    await flush();
    expect((await loadTutorial('u1'))?.state.status).toBe('completed');
  });

  it('fires a success haptic and a done line per finished step', async () => {
    await toFirstMeal();
    mockHaptics.success.mockClear();
    emitTutorialSignal('meal_logged');
    expect(mockHaptics.success).toHaveBeenCalledTimes(1);
    expect(useTutorialStore.getState().celebration?.stepId).toBe('first_meal');
  });

  it('fires a selection haptic on a gate advance and a warning on skip', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    dispatchTutorial({ type: 'ACK' });
    mockHaptics.selection.mockClear();
    setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
    expect(mockHaptics.selection).toHaveBeenCalledTimes(1);
    dispatchTutorial({ type: 'PAUSE' });
    expect(mockHaptics.warning).toHaveBeenCalledTimes(1);
  });

  it('marks community unavailable when the tab flag is off', async () => {
    mockFlags.communityTab = false;
    await hydrateTutorial('u1', 'Maya', true);
    startClientTutorial(PAYLOAD);
    dispatchTutorial({ type: 'ACK' });
    setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
    dispatchTutorial({ type: 'SIGNAL', signal: 'plan_card_opened' });
    setTutorialRoute(['Home', 'HomeMain']);
    dispatchTutorial({ type: 'SIGNAL', signal: 'macro_card_opened' });
    expect(useTutorialStore.getState().tutorial.outcomes.community).toBe('unavailable');
    expect(step()).toBe('coach_messages');
  });
});

describe('copy context', () => {
  it('prefers live /me/macros/current numbers over the payload snapshot', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    expect(resolveMacros(useTutorialStore.getState())?.calories).toBe(1789);
    setTutorialLiveMacros({ calories: 1850, protein_g: 155, carbs_g: 190, fat_g: 52 });
    const ctx = buildCopyContext(useTutorialStore.getState());
    expect(ctx.macros?.calories).toBe(1850);
    expect(ctx.coachName).toBe('Bradley');
    expect(ctx.firstName).toBe('Maya');
  });

  it('falls back to "your coach" without a coach name', async () => {
    await hydrateTutorial('u1', null);
    startClientTutorial({ ...PAYLOAD, coach: null });
    expect(buildCopyContext(useTutorialStore.getState()).coachName).toBe('your coach');
  });
});
