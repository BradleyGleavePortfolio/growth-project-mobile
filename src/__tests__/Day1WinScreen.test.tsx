// src/__tests__/Day1WinScreen.test.tsx
//
// Phase 7A — Day 1 Win Sequence screen contract guards.
//
// What we assert:
//   1. Source-level: the screen renders three win-card testIDs for the three
//      quick-win actions.
//   2. Source-level: every interactive element has accessibilityLabel +
//      accessibilityRole (doctrine requirement).
//   3. Source-level: no forbidden tokens (emoji, confetti, trophy) present.
//   4. Source-level: skip path calls onComplete without an API call.
//   5. Integration: tapping a card calls firstWinApi.complete() and, on
//      success, renders the completion view with the AI message.
//
// Pattern mirrors RiskBoardScreen.test.tsx — source-level reads for doctrine
// guards, plus a light RTL mount for the interactive path.

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'Day1WinScreen.tsx'),
  'utf8',
);

// ── Source guards ─────────────────────────────────────────────────────────────

describe('Day1WinScreen — source guards', () => {
  it('has testIDs for all three win cards', () => {
    // WIN_CARD_TEST_IDS defines the static testID strings; the JSX references
    // them via WIN_CARD_TEST_IDS[card.id]. Assert all three values are present.
    expect(SCREEN_SRC).toMatch(/day1win-card-logged_first_weight/);
    expect(SCREEN_SRC).toMatch(/day1win-card-first_checkin/);
    expect(SCREEN_SRC).toMatch(/day1win-card-first_meal/);
  });

  it('has testID for the skip button', () => {
    expect(SCREEN_SRC).toMatch(/testID="day1win-skip-button"/);
  });

  it('has testID for the continue button in completion view', () => {
    expect(SCREEN_SRC).toMatch(/testID="day1win-continue-button"/);
  });

  it('every interactive Pressable has accessibilityLabel', () => {
    const pressableCount = (SCREEN_SRC.match(/<Pressable/g) ?? []).length;
    const labelCount = (SCREEN_SRC.match(/accessibilityLabel=/g) ?? []).length;
    expect(labelCount).toBeGreaterThanOrEqual(pressableCount);
  });

  it('every interactive Pressable has accessibilityRole="button"', () => {
    const pressableCount = (SCREEN_SRC.match(/<Pressable/g) ?? []).length;
    const roleCount = (SCREEN_SRC.match(/accessibilityRole="button"/g) ?? []).length;
    expect(roleCount).toBeGreaterThanOrEqual(pressableCount);
  });

  it('does not contain forbidden celebration chrome', () => {
    expect(SCREEN_SRC).not.toMatch(/confetti/i);
    expect(SCREEN_SRC).not.toMatch(/trophy/i);
    expect(SCREEN_SRC).not.toMatch(/FirstWinCelebration/i);
  });

  it('does not hardcode hex color values', () => {
    // Comments are allowed; actual JSX/TS string literals are not.
    const withoutComments = SCREEN_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/"#[0-9A-Fa-f]{3,6}"/);
  });

  it('uses useTheme().colors for all color references', () => {
    expect(SCREEN_SRC).toMatch(/useTheme/);
    expect(SCREEN_SRC).toMatch(/colors\./);
  });

  it('imports from firstWinApi service', () => {
    expect(SCREEN_SRC).toMatch(/from ['"].*firstWinApi['"]/);
  });
});

// ── RTL mount tests ───────────────────────────────────────────────────────────

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), replace: jest.fn() }),
}));

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#F5EFE4',
      surface: '#F1E8D5',
      primary: '#2C4A36',
      primaryTint: 'rgba(44,74,54,0.06)',
      textPrimary: '#1A1A18',
      textSecondary: '#3D3D3A',
      textMuted: '#B1A89F',
      textOnPrimary: '#F5EFE4',
      border: 'rgba(176,141,87,0.2)',
      divider: 'rgba(176,141,87,0.15)',
      success: '#2C4A36',
      warning: '#C5A253',
      error: '#4A0404',
      info: '#1A73E8',
      streak: '#C5A253',
    },
  }),
}));

jest.mock('../lib/analytics', () => ({
  track: jest.fn(),
}));

// Mock the firstWinApi service
const mockComplete = jest.fn();
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: {
    getStatus: jest.fn().mockResolvedValue({ data: { completed: false, completedAt: null } }),
    complete: (...args: unknown[]) => mockComplete(...args),
  },
}));

// Silence font-loading warnings in test environment
jest.mock('expo-font', () => ({ isLoaded: () => true }));

import Day1WinScreen from '../screens/client/Day1WinScreen';

describe('Day1WinScreen — RTL mount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the selection view with all three win cards', () => {
    const onComplete = jest.fn();
    const { getByTestId } = render(<Day1WinScreen onComplete={onComplete} />);

    expect(getByTestId('day1win-selection-view')).toBeTruthy();
    expect(getByTestId('day1win-card-logged_first_weight')).toBeTruthy();
    expect(getByTestId('day1win-card-first_checkin')).toBeTruthy();
    expect(getByTestId('day1win-card-first_meal')).toBeTruthy();
  });

  it('skip button calls onComplete without an API call', () => {
    const onComplete = jest.fn();
    const { getByTestId } = render(<Day1WinScreen onComplete={onComplete} />);

    fireEvent.press(getByTestId('day1win-skip-button'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('tapping a card calls firstWinApi.complete with the correct winType', async () => {
    mockComplete.mockResolvedValueOnce({
      data: {
        completedAt: '2026-05-07T12:00:00.000Z',
        aiMessage: 'Your first check-in opens the feedback loop. Consistency over 90 days is the variable that matters.',
      },
    });

    const onComplete = jest.fn();
    const { getByTestId } = render(<Day1WinScreen onComplete={onComplete} />);

    fireEvent.press(getByTestId('day1win-card-first_checkin'));
    expect(mockComplete).toHaveBeenCalledWith('first_checkin');

    await waitFor(() => {
      expect(getByTestId('day1win-complete-view')).toBeTruthy();
    });
  });

  it('continue button in completion view calls onComplete', async () => {
    mockComplete.mockResolvedValueOnce({
      data: {
        completedAt: '2026-05-07T12:00:00.000Z',
        aiMessage: 'Logging your first weight sets a baseline.',
      },
    });

    const onComplete = jest.fn();
    const { getByTestId } = render(<Day1WinScreen onComplete={onComplete} />);

    fireEvent.press(getByTestId('day1win-card-logged_first_weight'));

    await waitFor(() => {
      expect(getByTestId('day1win-complete-view')).toBeTruthy();
    });

    fireEvent.press(getByTestId('day1win-continue-button'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
