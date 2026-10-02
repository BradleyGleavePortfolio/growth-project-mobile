/**
 * macroDisplayStore — server reports, per-user persistence, the one-time
 * dismissal, and the onboarding payload path through startClientTutorial().
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../config/featureFlags', () => ({
  featureFlags: { clientTutorial: true, communityTab: true },
}));
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: {
    success: () => Promise.resolve(),
    selection: () => Promise.resolve(),
    warning: () => Promise.resolve(),
  },
}));

import {
  __resetMacroDisplayStoreForTests,
  dismissFullMacrosIntro,
  hydrateMacroDisplay,
  macroDisplayStorageKey,
  reportMacroDisplay,
  selectMacroDisplayMode,
  useMacroDisplayStore,
} from '../macroDisplayStore';
import { shouldShowFullMacrosIntro } from '../macroDisplay';
import {
  __resetTutorialStoreForTests,
  buildCopyContext,
  startClientTutorial,
  useTutorialStore,
} from '../../tutorial/tutorialStore';

const FUTURE = '2999-01-01';
const PAST = '2000-01-01';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetMacroDisplayStoreForTests();
  __resetTutorialStoreForTests();
});

const mode = () => selectMacroDisplayMode(useMacroDisplayStore.getState());
const stored = async (uid: string) => JSON.parse((await AsyncStorage.getItem(macroDisplayStorageKey(uid))) ?? 'null');

describe('macroDisplayStore', () => {
  it('is full when the backend never sends the field', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ calories_kcal: 1789, protein_g: 150, carbs_g: 185, fats_g: 50 });
    expect(mode()).toBe('full');
    expect(useMacroDisplayStore.getState().record.seenSimple).toBe(false);
  });

  it('switches to simple from /me/macros/current and persists per user', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ calories_kcal: 1789, macro_display_mode: 'simple', simple_until: FUTURE });
    expect(mode()).toBe('simple');
    await Promise.resolve();
    expect(await stored('u1')).toMatchObject({ mode: 'simple', simpleUntil: FUTURE, seenSimple: true });
  });

  it('keeps a report made before the user resolved and applies it at hydration', async () => {
    reportMacroDisplay({ macro_display_mode: 'simple', simple_until: FUTURE });
    expect(mode()).toBe('simple');
    await hydrateMacroDisplay('u1');
    expect(mode()).toBe('simple');
    expect(await stored('u1')).toMatchObject({ seenSimple: true });
  });

  it('restores the stored mode on a cold start', async () => {
    await AsyncStorage.setItem(
      macroDisplayStorageKey('u1'),
      JSON.stringify({ version: 1, mode: 'simple', simpleUntil: FUTURE, seenSimple: true, introDismissedAt: null }),
    );
    await hydrateMacroDisplay('u1');
    expect(mode()).toBe('simple');
  });

  it('never carries one user into another on a shared device', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'simple', simple_until: FUTURE });
    await hydrateMacroDisplay('u2');
    expect(useMacroDisplayStore.getState().userId).toBe('u2');
    expect(mode()).toBe('full');
  });

  it('introduces carbs and fat once after the simple week, and remembers the dismissal', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'simple', simple_until: PAST });
    expect(mode()).toBe('full');
    expect(shouldShowFullMacrosIntro(useMacroDisplayStore.getState().record)).toBe(true);
    dismissFullMacrosIntro(new Date('2026-10-08T09:00:00Z'));
    expect(shouldShowFullMacrosIntro(useMacroDisplayStore.getState().record)).toBe(false);
    await Promise.resolve();
    expect(await stored('u1')).toMatchObject({ introDismissedAt: '2026-10-08T09:00:00.000Z' });

    __resetMacroDisplayStoreForTests();
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'full', simple_until: null });
    expect(shouldShowFullMacrosIntro(useMacroDisplayStore.getState().record)).toBe(false);
  });
});

describe('onboarding complete payload', () => {
  it('startClientTutorial() reports macro_display_mode, and Roman copy follows it', async () => {
    startClientTutorial({
      macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50 },
      program: { id: 'p1', name: 'Foundations' },
      coach: { id: 'c1', display_name: 'Bradley' },
      macro_display_mode: 'simple',
      simple_until: FUTURE,
    });
    expect(mode()).toBe('simple');
    const ctx = buildCopyContext(useTutorialStore.getState());
    expect(ctx.macroMode).toBe('simple');
  });

  it('a payload without the field leaves the copy in full', () => {
    startClientTutorial({
      macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50 },
      program: { id: 'p1', name: 'Foundations' },
    });
    expect(buildCopyContext(useTutorialStore.getState()).macroMode).toBe('full');
  });
});
