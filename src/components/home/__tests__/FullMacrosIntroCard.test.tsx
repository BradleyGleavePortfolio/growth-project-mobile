/**
 * The one-time Roman card that introduces carbohydrate and fat on the day a
 * never-tracker's simple week ends (onboarding contract v1 addition 8).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';

let mockUser: { id: string; role?: string; coach_id?: string } | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));

import FullMacrosIntroCard, { fullMacrosIntroLine } from '../FullMacrosIntroCard';
import {
  __resetMacroDisplayStoreForTests,
  hydrateMacroDisplay,
  macroDisplayStorageKey,
  reportMacroDisplay,
} from '../../../macros/macroDisplayStore';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetMacroDisplayStoreForTests();
  mockUser = null;
});

describe('FullMacrosIntroCard', () => {
  it('renders nothing for a client who was never in the simple view', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'full', simple_until: null });
    await render(<FullMacrosIntroCard carbsG={185} fatG={50} />);
    expect(screen.queryByTestId('full-macros-intro-card')).toBeNull();
  });

  it('renders nothing when the backend sends no mode at all', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ calories_kcal: 1789 });
    await render(<FullMacrosIntroCard carbsG={185} fatG={50} />);
    expect(screen.queryByTestId('full-macros-intro-card')).toBeNull();
  });

  it('stays hidden during the simple week', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'simple', simple_until: '2999-01-01' });
    await render(<FullMacrosIntroCard carbsG={185} fatG={50} />);
    expect(screen.queryByTestId('full-macros-intro-card')).toBeNull();
  });

  it('appears once simple_until has passed, with Roman and the real numbers, and dismisses for good', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'simple', simple_until: '2000-01-01' });
    const { rerender } = await render(<FullMacrosIntroCard carbsG={185} fatG={50} />);
    expect(screen.getByTestId('full-macros-intro-card')).toBeTruthy();
    expect(screen.getByTestId('full-macros-intro-roman')).toBeTruthy();
    expect(screen.getByText(fullMacrosIntroLine(185, 50))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('full-macros-intro-dismiss'));
    await rerender(<FullMacrosIntroCard carbsG={185} fatG={50} />);
    expect(screen.queryByTestId('full-macros-intro-card')).toBeNull();
    const saved = JSON.parse((await AsyncStorage.getItem(macroDisplayStorageKey('u1'))) ?? '{}');
    expect(typeof saved.introDismissedAt).toBe('string');

    // Cold start: still dismissed.
    __resetMacroDisplayStoreForTests();
    await hydrateMacroDisplay('u1');
    await rerender(<FullMacrosIntroCard carbsG={185} fatG={50} />);
    expect(screen.queryByTestId('full-macros-intro-card')).toBeNull();
  });

  it('never shows for a client with no coach (Roman is locked, 139-15); a coached client sees it', async () => {
    mockUser = { id: 'u1', role: 'student' };
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'simple', simple_until: '2000-01-01' });
    const { rerender } = await render(<FullMacrosIntroCard carbsG={185} fatG={50} />);
    expect(screen.queryByTestId('full-macros-intro-card')).toBeNull();
    expect(screen.queryByTestId('full-macros-intro-roman')).toBeNull();
    mockUser = { id: 'u1', role: 'student', coach_id: 'coach-1' };
    await rerender(<FullMacrosIntroCard carbsG={185} fatG={50} />);
    expect(screen.getByTestId('full-macros-intro-roman')).toBeTruthy();
  });
});

describe('fullMacrosIntroLine', () => {
  it('names the real targets and keeps Roman\'s voice', () => {
    const line = fullMacrosIntroLine(185, 50);
    expect(line).toBe(
      'Your first week is behind you. From today, Home also shows carbohydrate and fat: 185 grams of carbohydrate and 50 grams of fat a day. Calories and protein still come first. Fill in the other two as you go.',
    );
    expect(line).not.toMatch(/!|\u2014|\p{Extended_Pictographic}/u);
    expect(line).not.toMatch(/\b\w+'(t|ll|re|ve|d|m)\b/);
  });

  it('omits numbers it does not have instead of inventing them', () => {
    expect(fullMacrosIntroLine(undefined, 50)).toBe(
      'Your first week is behind you. From today, Home also shows carbohydrate and fat. Calories and protein still come first. Fill in the other two as you go.',
    );
  });
});
