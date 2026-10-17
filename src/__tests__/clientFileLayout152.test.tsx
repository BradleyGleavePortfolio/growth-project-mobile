import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Colors from '../constants/colors';
import { layout } from '../theme/tokens';
import type { ThemeColors } from '../theme/ThemeProvider';
import { makeStyles } from '../screens/coach/client-detail/styles';
import { MacroCard } from '../screens/coach/client-detail/MacroCard';
import { SummaryTab } from '../screens/coach/client-detail/SummaryTab';
import { FoodLogReviewSection } from '../screens/coach/client-detail/FoodLogReviewSection';
import CoachAiSection from '../components/coach/CoachAiSection';
import coachAiApi from '../api/coachAi';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../constants/colors').default }),
}));
jest.mock('../hooks/useMacros', () => ({
  useCurrentMacrosForClient: () => ({
    data: null, isLoading: false, isError: false, refetch: jest.fn(),
  }),
}));
jest.mock('../screens/coach/client-detail/ConsultationSummaryCard', () => ({
  ConsultationSummaryCard: () => null,
}));
jest.mock('../api/coachFoodReviewApi', () => ({
  ...jest.requireActual('../api/coachFoodReviewApi'),
  loadCoachFoodReview: jest.fn(async () => ({ meals: [] })),
}));
jest.mock('../api/coachAi', () => ({
  __esModule: true,
  default: {
    status: jest.fn(async () => ({ data: { ready: true } })),
    listDrafts: jest.fn(async () => ({ data: [] })),
  },
}));

const colors: ThemeColors = {
  ...Colors, dark: Colors.textPrimary, gold: Colors.warning, orange: Colors.error,
};
const styles = makeStyles(colors);
const flat = (style: unknown) => StyleSheet.flatten<ViewStyle & TextStyle>(style as StyleProp<ViewStyle & TextStyle>);
const props = { clientId: 'c1', clientName: 'Maya Chen' };

beforeEach(() => jest.clearAllMocks());

it('R2: every client-file tab keeps its content height without a shrinking or capped viewport', () => {
  expect(styles.tabScroll).toMatchObject({ flexGrow: 0, flexShrink: 0 });
  expect(styles.tabScroll).not.toHaveProperty('height');
  expect(styles.tabScroll).not.toHaveProperty('maxHeight');
  const screen = readFileSync(resolve(__dirname, '../screens/coach/ClientDetailScreen.tsx'), 'utf8');
  expect(screen).toContain('style={styles.tabScroll}');
  expect(screen).not.toMatch(/styles\.tabScroll[^}]*maxHeight/);
});

it('R3: shared action pills wrap, reserve two columns and allow the label to wrap beside its icon', () => {
  expect(styles.actionsRow.flexWrap).toBe('wrap');
  expect(styles.actionPill).toMatchObject({ flexBasis: '40%', minHeight: layout.touchMin });
  expect(styles.actionPillText).toMatchObject({ flexShrink: 1, textAlign: 'center' });
  expect(styles.actionPill).not.toHaveProperty('height');
});

it('Summary actions keep their existing destinations', async () => {
  const actions = [
    ['Open messages', jest.fn()],
    ['Send nudge notification', jest.fn()],
    ['Review client macros', jest.fn()],
    ['Open client workouts', jest.fn()],
    ['Ask AI to draft a check-in nudge', jest.fn()],
  ] as const;
  const v = await render(<SummaryTab {...props}
    profile={null} totals={{ calories: 0, protein: 0, carbs: 0, fat: 0 }}
    nudgeSuccess={false} colors={colors} styles={styles}
    onOpenMessages={actions[0][1]} onOpenNudge={actions[1][1]}
    onOpenMacrosReview={actions[2][1]} onOpenWorkoutBuilder={actions[3][1]}
    onOpenAskAi={actions[4][1]}
  />);
  for (const [label, handler] of actions) {
    expect(flat(v.getByLabelText(label).props.style).minHeight).toBe(layout.touchMin);
    await fireEvent.press(v.getByLabelText(label));
    expect(handler).toHaveBeenCalledTimes(1);
  }
});

const luminance = (hex: string) => {
  const rgb = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};

it.each([
  ['Protein', Colors.protein],
  ['Carbs', Colors.carbs],
  ['Fat', Colors.fat],
])('R4: %s values meet 4.5:1 on their actual cream surface, preserving the bar colour', async (label, color) => {
  const v = await render(<MacroCard label={label} color={color} value={42} target={100} unit="g" />);
  const valueColor = flat(v.getByText('42g').props.style).color as string;
  const ratio = (luminance(styles.macroCard.backgroundColor) + 0.05) / (luminance(valueColor) + 0.05);
  expect(valueColor).toBe(Colors.primary);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  expect(v.container.queryAll((node) => flat(node.props.style)?.backgroundColor === color).length).toBeGreaterThan(0);
});

it('R5: the shared Pending AI drafts button is at least 44 pt and still opens the inbox', async () => {
  const v = await render(<CoachAiSection {...props} />);
  const button = await v.findByTestId('coach-ai-inbox-btn');
  expect(flat(button.props.style).minHeight).toBe(layout.touchMin);
  await fireEvent.press(button);
  await waitFor(() => expect(coachAiApi.listDrafts).toHaveBeenCalledWith({ clientId: 'c1', limit: 20 }));
  expect(await v.findByText('No pending drafts for this client.')).toBeTruthy();
});

it('R6: every food-review period chip shares a 44 pt target and keeps selection working', async () => {
  const v = await render(<FoodLogReviewSection clientId="c1" colors={colors} styles={styles} />);
  for (const d of [7, 14, 30]) {
    const chip = v.getByLabelText(`Review the last ${d} days of food logs`);
    expect(flat(chip.props.style)).toMatchObject({
      minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center',
    });
    await fireEvent.press(chip);
    expect(chip.props.accessibilityState.selected).toBe(true);
    expect(await v.findByText(`No meals logged in the last ${d} days.`)).toBeTruthy();
  }
});
