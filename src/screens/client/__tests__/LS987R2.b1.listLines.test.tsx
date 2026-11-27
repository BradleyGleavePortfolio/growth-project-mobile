/**
 * LS-987R2 B1 (m#987, AUDIT 6876897566): a workout of this week keeps main's card on the list. With the phone's today
 * inside the fixture's week, an open workout shows main's "{Type} • about {N} min • {N} exercises" line, its date with
 * the month as formatScheduled writes it and the chevron; a done one also "Completed RPE {n}". Each exactly once.
 * Round 2 drew this week's workouts on a card row that dropped all four (REFINE-987R3 puts main's card back).
 */
import React from 'react';
import { render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let mockToday = '2026-11-18';
let mockAssignments: unknown[] = [];
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));
jest.mock('../../../utils/date', () => ({ ...jest.requireActual('../../../utils/date'), getTodayString: () => mockToday }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../wearables/recoveryTestColors').testColors,
    semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: mockAssignments, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock('../../../hooks/useExerciseNames', () => ({
  useExerciseNames: () => ({ names: { squat: 'Back squat', bench: 'Bench press' }, loading: false, bodyWeight: {} }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: Record<string, unknown>) => require('react').createElement('Ionicons', p) }));

import ClientWorkoutViewerScreen from '../ClientWorkoutViewerScreen';

type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] | null };
function hosts(root: unknown): Host[] {
  const out: Host[] = [];
  const walk = (n: Host | Host[] | string | null) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(root as Host | Host[] | null);
  return out;
}

const row = (order: number, id: string) => ({ id: `r${order}`, workout_plan_id: 'plan', exercise_external_id: id, order,
  sets: 4, reps_or_duration_seconds: 5, weight_lbs: 185, rest_seconds: 120, superset_group_id: null, notes: null });
function workout(name: string, day: string, done: boolean) {
  return {
    id: name, workout_plan_id: name, client_id: 'client', assigned_by_coach_id: 'coach',
    scheduled_for: `${day}T00:00:00.000Z`, completed_at: done ? `${day}T18:00:00.000Z` : null, skipped_at: null,
    post_rpe: done ? 7 : null, post_notes: null,
    workout_plan: { id: name, coach_id: 'coach', name, type: 'strength', exercises: [row(1, 'squat'), row(2, 'bench')],
      duration_estimate_minutes: 55, created_at: '', updated_at: '', archived_at: null },
  };
}
// Today Wednesday 18 November 2026: this week is Mon 16 to Sun 22; both workouts fall in it.
const OPEN = workout('Lower body', '2026-11-19', false);
const DONE = workout('Upper body', '2026-11-16', true);
// formatScheduled's own call: the day with its month ("Thu, Nov 19" in en-US).
const dateLine = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const mount = () => render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
    <ClientWorkoutViewerScreen />
  </SafeAreaProvider>,
);

beforeEach(() => {
  mockToday = '2026-11-18';
  mockAssignments = [OPEN, DONE];
});

describe("LS-987R2 B1: this week's workouts keep main's card lines on the list", () => {
  it.each([
    ['an open', OPEN, dateLine(2026, 11, 19)],
    ['a done', DONE, dateLine(2026, 11, 16)],
  ])('%s workout of this week: the type, length and exercise line, the date with its month, the chevron', async (_s, w, date) => {
    expect(date).toMatch(/Nov/);
    const view = await mount();
    const presses = view.getAllByRole('button', { name: `Open workout ${w.id}` });
    expect(presses).toHaveLength(1);
    const card = within(presses[0]);
    expect(card.getAllByText('Strength • about 55 min • 2 exercises')).toHaveLength(1);
    expect(card.getAllByText(date)).toHaveLength(1);
    expect(hosts(presses[0]).filter((n) => n.type === 'Ionicons' && n.props.name === 'chevron-forward')).toHaveLength(1);
    expect(view.getAllByText(date)).toHaveLength(1);
  });

  it('a done workout of this week also reads "Completed RPE 7", once on the page; an open one does not', async () => {
    const view = await mount();
    const done = view.getByRole('button', { name: `Open workout ${DONE.id}` });
    expect(within(done).getAllByText('Completed RPE 7')).toHaveLength(1);
    expect(view.getAllByText('Completed RPE 7')).toHaveLength(1);
    expect(within(view.getByRole('button', { name: `Open workout ${OPEN.id}` })).queryByText(/Completed RPE/)).toBeNull();
  });

  it("each of the two is under main's section head: To complete, then Completed", async () => {
    const view = await mount();
    expect(view.getByText('To complete')).toBeTruthy();
    expect(view.getByText('Completed')).toBeTruthy();
    expect(view.getAllByText('Strength • about 55 min • 2 exercises')).toHaveLength(2);
  });
});
