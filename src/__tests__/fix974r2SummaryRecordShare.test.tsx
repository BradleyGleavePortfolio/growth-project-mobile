/**
 * FIX-974R2 (LS-974R2 B1): the record's Share takes no row of its own on the summary page. It is a 44 pt button at the
 * end of its record line, with main's spoken name and main's sheet, so the opening view keeps the meter and the note
 * above Send (the fold itself is measured on the web preview by scripts/review/ls974r2-B1.cjs). A line that is not a
 * record, or a record without a weight, draws no Share. Fictional coach and client.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => ({ data: undefined }) }));
jest.mock('../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'coach-sam', name: 'Sam Rivers' }] }) }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../config/featureFlags', () => ({ featureFlags: { shareSheetV2: true } }));
jest.mock('../components/share/ShareSheet', () => {
  const R = jest.requireActual('react');
  const { Text: T } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ card }: { card: { title?: string } | null }) => (card ? R.createElement(T, { testID: 'share-sheet-open' }, 'open') : null),
    ShareLink: () => null,
  };
});
jest.mock('../components/share/shareCards', () => ({ bestCard: (name: string, weight: number) => ({ title: `${name} ${weight}` }) }));

import WorkoutFinishSummary from '../screens/client/active-workout/WorkoutFinishSummary';
import type { MovedLine } from '../screens/client/active-workout/summaryC5';

const c5 = (lines: MovedLine[]) => ({
  assignmentId: 'asg-today', today: '2026-11-13', minutes: 52, sets: 16, volume: 9730, lines,
  effort: null, note: '', onEffort: () => undefined, onNote: () => undefined,
  status: 'open' as const, sentKey: null, onSend: () => undefined, onTryAgain: () => undefined, onBack: () => undefined,
});
const summary = { exercises: 2, sets: 16, volume: 9730, records: [] };
const squat: MovedLine = { kind: 'best', exercise: 'Back squat', weight: 185, text: 'Back squat: 185 × 5, heaviest in your last 50 saved workouts' };
const bench: MovedLine = { kind: 'more', exercise: 'Bench press', text: 'Bench press: 5 lb more on every set' };
const noWeight: MovedLine = { kind: 'best', exercise: 'Plank', text: 'Plank' };

it.each<[string, MovedLine[], (string | null)[]]>([
  ['a record, then a gain', [squat, bench], ['Share Back squat at 185 lb', null]],
  ['a gain, then a record', [bench, squat], [null, 'Share Back squat at 185 lb']],
  ['a record without a weight', [noWeight], [null]],
])('%s: Share sits in its own record line, never a row under it', async (_case, lines, shares) => {
  const view = await render(<WorkoutFinishSummary summary={summary} styles={{} as never} historyState="loaded" elapsed="52:00" c5={c5(lines)} />);
  shares.forEach((name, i) => {
    const row = view.getByTestId(`what-moved-${i}`);
    // The line itself is the row: its text and its Share are siblings in one horizontal row.
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row' });
    expect(within(row).getByText(lines[i].text)).toBeTruthy();
    const buttons = within(row).queryAllByRole('button');
    if (name == null) { expect(buttons).toHaveLength(0); return; }
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityLabel ?? buttons[0].props['aria-label']).toBe(name);
    const box = StyleSheet.flatten(view.getAllByTestId('summary-share')[0].props.style) as { width?: number; height?: number };
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
  expect(view.queryByText('Share')).toBeNull();
  if (shares.some(Boolean)) {
    await fireEvent.press(view.getAllByTestId('summary-share')[0]);
    expect(view.getByTestId('share-sheet-open')).toBeTruthy();
  }
});
