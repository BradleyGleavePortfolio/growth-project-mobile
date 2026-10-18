import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Colors from '../constants/colors';
import { layout, radius } from '../theme/tokens';
import type { ThemeColors } from '../theme/ThemeProvider';
import type { WeightLog } from '../types';
import { makeStyles } from '../screens/coach/client-detail/styles';
import { MacroCard } from '../screens/coach/client-detail/MacroCard';
import { SummaryTab } from '../screens/coach/client-detail/SummaryTab';
import { FoodLogReviewSection } from '../screens/coach/client-detail/FoodLogReviewSection';
import { ProgressTab } from '../screens/coach/client-detail/ProgressTab';
import { loadCoachFoodReview } from '../api/coachFoodReviewApi';
import CoachAiSection from '../components/coach/CoachAiSection';
import coachAiApi from '../api/coachAi';

const mockNavigate = jest.fn();
const mockRefetch = jest.fn();
let mockTargetError = false;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../constants/colors').default }),
}));
jest.mock('../hooks/useMacros', () => ({
  useCurrentMacrosForClient: () => ({
    data: null, isLoading: false, isError: mockTargetError, refetch: mockRefetch,
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
    generateWorkout: jest.fn(),
  },
  isTimeoutError: (err: { code?: string }) => err?.code === 'ECONNABORTED',
  isAiDisabledError: () => false,
}));

const colors: ThemeColors = {
  ...Colors, dark: Colors.textPrimary, gold: Colors.warning, orange: Colors.error,
};
const styles = makeStyles(colors);
const flat = (style: unknown) => StyleSheet.flatten<ViewStyle & TextStyle>(style as StyleProp<ViewStyle & TextStyle>);
const props = { clientId: 'c1', clientName: 'Maya Chen' };

beforeEach(() => {
  jest.clearAllMocks();
  mockTargetError = false;
});

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

it.each(['Message', 'Archive / Unarchive'])('CF2: header %s shares the 44 by 44 target', () => {
  expect(styles.msgIconBtn).toMatchObject({ width: layout.touchMin, height: layout.touchMin });
  const source = readFileSync(resolve(__dirname, '../screens/coach/ClientDetailScreen.tsx'), 'utf8');
  expect(source.match(/style=\{(?:\[)?styles\.msgIconBtn/g)).toHaveLength(2);
  expect(styles.headerLabels).toMatchObject({ flex: 1, minWidth: 0 });
  expect(styles.header.flexDirection).toBe('column');
  expect(styles.headerActions).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between' });
  expect(styles.headerButtons.gap).toBe(4);
  expect(styles.headerCenter.flexDirection).toBe('row');
  expect(styles.headerCenter).not.toHaveProperty('flex');
  expect(source).toContain('style={styles.headerLabels}');
  expect(source).toContain('accessibilityLabel="Open messages"');
});

it.each(['summary', 'food'])('CF2: %s retry has the shared 44 pt target and retries its read', async (surface) => {
  mockTargetError = true;
  const read = jest.mocked(loadCoachFoodReview);
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  if (surface === 'food') read.mockRejectedValueOnce(new Error('offline'));
  const v = await render(surface === 'food'
    ? <FoodLogReviewSection {...props} colors={colors} styles={styles} />
    : <SummaryTab {...props} profile={null} totals={{ calories: 0, protein: 0, carbs: 0, fat: 0 }}
        nudgeSuccess={false} colors={colors} styles={styles} onOpenMessages={jest.fn()}
        onOpenNudge={jest.fn()} onOpenMacrosReview={jest.fn()} onOpenWorkoutBuilder={jest.fn()} />);
  const retry = await v.findByRole('button', { name: surface === 'food' ? 'Retry' : 'Retry target' });
  expect(flat(retry.props.style)).toMatchObject({ minHeight: layout.touchMin, minWidth: layout.touchMin });
  await fireEvent.press(retry);
  if (surface === 'food') {
    expect(await v.findByText('No meals logged in the last 7 days.')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  } else {
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  }
  errorLog.mockRestore();
});

it.each([-10, 0, 10])('CF2: signed Change %s meets 4.5:1 on its actual cream surface', async (change) => {
  const log = (id: string, date: string, weight: number): WeightLog => ({
    id, userId: 'c1', coachId: '', date, weight, unit: 'lbs', notes: '', createdAt: date,
  });
  const v = await render(<ProgressTab colors={colors} styles={styles}
    weightLogs={[log('first', '2026-10-01', 180), log('latest', '2026-10-15', 180 + change)]} />);
  const text = `${change > 0 ? '+' : ''}${change.toFixed(1)}`;
  const foreground = flat(v.getByText(text).props.style).color as string;
  expect(foreground).toBe(colors.textPrimary);
  expect((luminance(styles.progressStat.backgroundColor) + 0.05) / (luminance(foreground) + 0.05)).toBeGreaterThanOrEqual(4.5);
});

it('CF2: shared Coach AI form controls use semantic radii and 44 pt targets, retaining input actions', async () => {
  const v = await render(<CoachAiSection {...props} />);
  for (const kind of ['workout', 'insight']) {
    expect(flat(v.getByTestId(`coach-ai-cta-${kind}`).props.style)).toMatchObject({
      borderRadius: radius.button, minHeight: layout.touchMin,
    });
  }
  await fireEvent.press(v.getByTestId('coach-ai-cta-workout'));
  for (const [label, result] of [['Increase', 'Weeks (5)'], ['Decrease', 'Weeks (4)']]) {
    const stepper = v.getByRole('button', { name: label });
    expect(flat(stepper.props.style)).toMatchObject({ width: layout.touchMin, height: layout.touchMin, borderRadius: radius.button });
    await fireEvent.press(stepper);
    expect(v.getByText(result)).toBeTruthy();
  }
  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    const option = v.getByTestId(`coach-ai-workout-dpw-${day}`);
    expect(flat(option.props.style)).toMatchObject({ minHeight: layout.touchMin, minWidth: layout.touchMin, borderRadius: radius.input });
    await fireEvent.press(option);
    expect(option.props.accessibilityState.selected).toBe(true);
  }
  expect(flat(v.getByPlaceholderText('Injuries, equipment available, preferences…').props.style).borderRadius).toBe(radius.input);
  const submit = v.getAllByRole('button', { name: 'Generate workout program' }).slice(-1)[0];
  expect(flat(submit.props.style)).toMatchObject({ borderRadius: radius.button, minHeight: layout.touchMin });
  await fireEvent.press(v.getByRole('button', { name: 'Close' }));
  await fireEvent.press(v.getByTestId('coach-ai-cta-insight'));
  for (const days of [7, 14, 30]) {
    const chip = v.getByTestId(`coach-ai-insight-window-${days}`);
    expect(flat(chip.props.style)).toMatchObject({ minHeight: layout.touchMin, borderRadius: radius.input });
    await fireEvent.press(chip);
    expect(chip.props.accessibilityState.selected).toBe(true);
  }
});

it.each([
  ['workout', 'days', [1, 2, 3, 4, 5, 6, 7], 'dpw'],
  ['insight', 'window', [7, 14, 30], 'window'],
] as const)('CF2 B1: %s numeric options share one non-wrapping, equal-width row', async (kind, row, values, option) => {
  const v = await render(<CoachAiSection {...props} />);
  await fireEvent.press(v.getByTestId(`coach-ai-cta-${kind}`));
  const rowStyle = flat(v.getByTestId(`coach-ai-${kind}-${row}-row`).props.style);
  expect(rowStyle).toMatchObject({ flexDirection: 'row', flexWrap: 'nowrap', gap: 2 });
  for (const value of values) {
    const chip = v.getByTestId(`coach-ai-${kind}-${option}-${value}`);
    expect(flat(chip.props.style)).toMatchObject({
      flex: 1, minWidth: layout.touchMin, minHeight: layout.touchMin,
    });
    await fireEvent.press(chip);
    expect(chip.props.accessibilityState.selected).toBe(true);
  }
  for (const width of [360, 390]) {
    let scroll = v.getByTestId(`coach-ai-${kind}-${row}-row`).parent;
    while (scroll && !scroll.props.contentContainerStyle) scroll = scroll.parent;
    const padding = flat(scroll?.props.contentContainerStyle).padding as number;
    expect(padding).toBe(20);
    expect((width - 2 * padding - (values.length - 1) * (rowStyle.gap as number)) / values.length)
      .toBeGreaterThanOrEqual(layout.touchMin);
  }
});

it('CF2: timeout link opens the inbox and the rounded ready-draft action opens the real draft route', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(coachAiApi.generateWorkout).mockRejectedValueOnce({ code: 'ECONNABORTED' });
    const v = await render(<CoachAiSection {...props} />);
    await fireEvent.press(v.getByTestId('coach-ai-cta-workout'));
    await fireEvent.press(v.getByText('Generate'));
    const banner = await v.findByTestId('coach-ai-timeout-banner');
    expect(flat(banner.props.style).borderRadius).toBe(radius.card);
    const link = v.getByRole('button', { name: 'View pending drafts' });
    expect(flat(link.props.style)).toMatchObject({ minHeight: layout.touchMin, minWidth: layout.touchMin });
    await fireEvent.press(link);
    expect(await v.findByText('No pending drafts for this client.')).toBeTruthy();
    await fireEvent.press(v.getByRole('button', { name: 'Close' }));
    jest.mocked(coachAiApi.listDrafts).mockResolvedValueOnce({ data: [{ id: 'draft1', type: 'WORKOUT_PROGRAM' }] } as never);
    await act(async () => { jest.advanceTimersByTime(10_000); });
    const ready = await v.findByTestId('coach-ai-draft-ready-banner');
    expect(flat(ready.props.style)).toMatchObject({ borderRadius: radius.button, minHeight: layout.touchMin });
    await fireEvent.press(ready);
    expect(mockNavigate).toHaveBeenCalledWith('AIWorkoutDraft', { draftId: 'draft1', ...props });
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('CF2: every Coach AI radius comes from the semantic token set', () => {
  const source = readFileSync(resolve(__dirname, '../components/coach/CoachAiSection.tsx'), 'utf8');
  expect(source).not.toMatch(/borderRadius:\s*\d/);
});
