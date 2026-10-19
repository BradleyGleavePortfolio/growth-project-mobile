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
//   5. A card opens its logger with no completion request. A confirmed save
//      requests the note once and displays the server's exact text.
//
// Pattern mirrors RiskBoardScreen.test.tsx — source-level reads for doctrine
// guards, plus a light RTL mount for the interactive path.

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { layout } from '../theme/tokens';

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

// Day1Win mounts the package-selection path, and PackageSelectionSheet was
// migrated to semantic tokens (PR-18 M1), so it now destructures
// `semanticColors` and `tokens` from useTheme. Mock against the real token
// module so the full theme surface is present and stays in sync with the
// source of truth instead of a hand-maintained partial.
jest.mock('../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../theme/tokens').default;
  return {
    useTheme: () => ({
      colors: {
        background: '#F5EFE4',
        surface: '#F1E8D5',
        primary: '#2C4A36',
        primaryTint: 'rgba(44,74,54,0.06)',
        textPrimary: '#1A1A18',
        textSecondary: '#3D3D3A',
        textMuted: '#6B675F',
        textOnPrimary: '#F5EFE4',
        border: 'rgba(176,141,87,0.2)',
        divider: 'rgba(176,141,87,0.15)',
        success: '#2C4A36',
        warning: '#C5A253',
        error: '#4A0404',
        info: '#1A73E8',
        streak: '#C5A253',
      },
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      colorScheme: 'light',
    }),
  };
});

jest.mock('../lib/analytics', () => ({
  track: jest.fn(),
}));

// Mock the firstWinApi service
const mockComplete = jest.fn();
const mockGetEntitlement = jest.fn();
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: {
    getStatus: jest.fn().mockResolvedValue({ data: { completed: false, completedAt: null } }),
    complete: (...args: unknown[]) => mockComplete(...args),
  },
}));

// Silence font-loading warnings in test environment
jest.mock('expo-font', () => ({ isLoaded: () => true }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import Day1WinScreen from '../screens/client/Day1WinScreen';

describe('Day1WinScreen — RTL mount', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockComplete.mockReset();
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true } });
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify({
      id: 'client-day1', role: 'student', name: 'Day One',
    }));
  });

  it('renders the selection view with all three win cards', async () => {
    const onComplete = jest.fn();
    const { getByTestId } = await render(<Day1WinScreen onComplete={onComplete} />);

    expect(getByTestId('day1win-selection-view')).toBeTruthy();
    expect(getByTestId('day1win-card-logged_first_weight')).toBeTruthy();
    await waitFor(() => {
      expect(getByTestId('day1win-card-first_checkin')).toBeTruthy();
      expect(getByTestId('day1win-card-first_meal')).toBeTruthy();
    });
  });

  it('skip button calls onComplete without recording a win', async () => {
    const onComplete = jest.fn();
    const { getByTestId } = await render(<Day1WinScreen onComplete={onComplete} />);

    expect(StyleSheet.flatten(getByTestId('day1win-skip-button').props.style)).toMatchObject({
      minHeight: layout.touchMin,
      minWidth: layout.touchMin,
    });
    await fireEvent.press(getByTestId('day1win-skip-button'));
    // The skip path runs maybeShowPackageSheet(undefined) which is async — it
    // reads the 24h-gate from MMKV and probes the packages endpoint. Both can
    // resolve to "no sheet" paths that synchronously call onComplete inside
    // the awaited body, so wait for the callback rather than asserting
    // synchronously.
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('skip remembers the skip for the signed-in user (AUDIT-01-125)', async () => {
    await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify({ id: 'client-K', role: 'student', name: 'Kai' }));
    const onComplete = jest.fn();
    const { getByTestId } = await render(<Day1WinScreen onComplete={onComplete} />);
    await fireEvent.press(getByTestId('day1win-skip-button'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem('prefs:onboarding.day1win_skipped_at:client-K')).toBeTruthy();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it.each(['first_meal', 'logged_first_weight', 'first_checkin'] as const)(
    '%s opens the logger without requesting a note on tap', async (winType) => {
      const onComplete = jest.fn();
      const r = await render(<Day1WinScreen onComplete={onComplete} />);
      await fireEvent.press(r.getByTestId(`day1win-card-${winType}`));
      expect(onComplete).toHaveBeenCalledWith(winType);
      expect(mockComplete).not.toHaveBeenCalled();
      expect(r.queryByTestId('day1win-complete-view')).toBeNull();
    },
  );

  it.each((['first_meal', 'logged_first_weight', 'first_checkin'] as const).flatMap(
    (winType) => ['coachless', 'coached'].map((client) => ({ winType, client })),
  ))(
    '$client $winType requests once only after save and shows the exact server note', async ({ winType, client }) => {
      await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify({
        id: 'client-day1', role: 'student', name: 'Day One',
        ...(client === 'coached' ? { coach_id: 'coach-day1' } : {}),
      }));
      const aiMessage = `Server note for ${client} ${winType}.`;
      mockComplete.mockResolvedValueOnce({ data: { completedAt: '2026-10-14', aiMessage } });
      const onComplete = jest.fn();
      const r = await render(<Day1WinScreen onComplete={onComplete} savedWin={winType} />);
      expect(await r.findByText(aiMessage)).toBeTruthy();
      await r.rerender(<Day1WinScreen onComplete={onComplete} savedWin={winType} />);
      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(mockComplete).toHaveBeenCalledWith(winType);
    },
  );

  it('set_first_goal is not a card on main and sends no completion request', async () => {
    const r = await render(<Day1WinScreen onComplete={jest.fn()} />);
    expect(r.queryByTestId('day1win-card-set_first_goal')).toBeNull();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('a failed note request never displays a locally invented note', async () => {
    const { Alert } = jest.requireActual('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockComplete.mockRejectedValueOnce(new Error('Network Error'));
    const r = await render(<Day1WinScreen onComplete={jest.fn()} savedWin="first_meal" />);
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(r.queryByTestId('day1win-complete-view')).toBeNull();
    alert.mockRestore();
  });

  it.each(['first_meal', 'logged_first_weight', 'first_checkin'] as const)(
    '%s retries only its saved note and exposes Continue anyway after two failures', async (winType) => {
      const { Alert } = jest.requireActual('react-native');
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      mockComplete.mockRejectedValue(new Error('Network Error'));
      const onComplete = jest.fn();
      const r = await render(<Day1WinScreen onComplete={onComplete} savedWin={winType} />);
      await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
      await r.rerender(<Day1WinScreen onComplete={onComplete} savedWin={winType} />);
      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(r.queryByTestId('day1win-continue-anyway-button')).toBeNull();
      await fireEvent.press(r.getByTestId('day1win-card-first_meal'));
      await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
      expect(mockComplete.mock.calls).toEqual([[winType], [winType]]);
      expect(onComplete).not.toHaveBeenCalled();
      expect(StyleSheet.flatten(r.getByTestId('day1win-continue-anyway-button').props.style).minHeight).toBe(layout.touchMin);
      await fireEvent.press(r.getByTestId('day1win-continue-anyway-button'));
      await waitFor(() => expect(onComplete).toHaveBeenCalledWith(undefined));
      expect(mockComplete).toHaveBeenCalledTimes(2);
      alert.mockRestore();
    },
  );

  it('a successful retry shows the same saved win, without opening any logger', async () => {
    const { Alert } = jest.requireActual('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockComplete.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({
      data: { aiMessage: 'The server note for the saved weight.' },
    });
    const onComplete = jest.fn();
    const r = await render(<Day1WinScreen onComplete={onComplete} savedWin="logged_first_weight" />);
    await waitFor(() => expect(alert).toHaveBeenCalled());
    await fireEvent.press(r.getByTestId('day1win-card-first_checkin'));
    expect(await r.findByText('The server note for the saved weight.')).toBeTruthy();
    expect(r.getByText('Log your starting weight')).toBeTruthy();
    expect(mockComplete.mock.calls).toEqual([['logged_first_weight'], ['logged_first_weight']]);
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('day1win-continue-button'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(undefined));
    alert.mockRestore();
  });

  it('continue button after save enters the app without reopening the logger', async () => {
    mockComplete.mockResolvedValueOnce({
      data: {
        completedAt: '2026-05-07T12:00:00.000Z',
        aiMessage: 'Your first check-in opens the feedback loop. Consistency over 90 days is the variable that matters.',
      },
    });

    const onComplete = jest.fn();
    const { getByTestId } = await render(
      <Day1WinScreen onComplete={onComplete} savedWin="first_checkin" />,
    );

    await waitFor(() => {
      expect(getByTestId('day1win-complete-view')).toBeTruthy();
    });

    expect(StyleSheet.flatten(getByTestId('day1win-continue-button').props.style).height).toBeGreaterThanOrEqual(layout.touchMin);
    await fireEvent.press(getByTestId('day1win-continue-button'));
    // handleContinue → maybeShowPackageSheet is async (MMKV + api.get).
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(undefined);
    });
  });

  // The habits card keeps its approved wording and opens the habit list.
  it('the check-in card says it opens the habits, with no coach wording', async () => {
    const { getByText, queryByText } = await render(<Day1WinScreen onComplete={jest.fn()} />);
    await waitFor(() => expect(getByText("Check off today's habits")).toBeTruthy());
    expect(queryByText('Submit your first check-in')).toBeNull();
    expect(queryByText(/your coach/)).toBeNull();
  });

  it('the completion view calls the tapped card a first step, not a data point', async () => {
    mockComplete.mockResolvedValueOnce({
      data: {
        completedAt: '2026-05-07T12:00:00.000Z',
        aiMessage: 'Logging your first meal starts your nutrition baseline.',
      },
    });
    const { getByTestId, getByText, queryByText } = await render(
      <Day1WinScreen onComplete={jest.fn()} savedWin="first_meal" />,
    );
    await waitFor(() => {
      expect(getByTestId('day1win-complete-view')).toBeTruthy();
    });
    expect(getByText('YOUR FIRST STEP')).toBeTruthy();
    expect(queryByText('YOUR FIRST DATA POINT')).toBeNull();
  });
});
