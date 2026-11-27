/**
 * EXERCISE-HISTORY-UNIT-M (the operator's R2): the Progress page's Strength tile reads each exercise's stored unit
 * (GET /workouts sends each exercise row's asked_unit). A timed best reads "70 lb × 45 sec" ("{kg} kg × 45 sec" for a
 * kg client); one exercise's timed sets and its rep sets are two lifts that never compare, so a 60-second hold is never
 * a New best over 8 reps. A unit of 'reps', null, absent or anything else reads exactly as main. latestBest directly,
 * and the real ProgressV2 (behind clientProgressV2, set on here) with ProgressV2.test.tsx's stand-ins copied, never
 * imported. Cases are the job's test numbers.
 */
import React from 'react';
import { render, waitFor, within } from '@testing-library/react-native';
import ProgressScreen from '../../ProgressScreen';
import { getTodayString } from '../../../../utils/date';
import { formatWeight } from '../../../../components/progress/progressFormat';
import { latestBest, toUnit, type Session } from '../progressV2';

const today = getTodayString();
const DAY = 86_400_000;
const ago = (n: number, from = today) => new Date(Date.parse(`${from}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const NBSP = ' ';
let mockUser: { id: string; coach_id?: string; profile: Record<string, unknown> } = { id: 'u1', profile: {} };
let mockSessions: unknown[] = [];
const mockHistory = jest.fn(async (): Promise<unknown> => ({ data: { logs: [] } }));
jest.mock('../../../../services/api', () => ({
  weightApi: { getHistory: () => mockHistory(), log: jest.fn(async () => ({})) },
  workoutApi: { getAll: jest.fn(async () => ({ data: mockSessions })) },
}));
jest.mock('../../../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { listMyAssignments: jest.fn(async () => []) } }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }] }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientProgressV2: true, clientTimelineV2: true } }));
jest.mock('../../../../ui/haptics/haptics.service', () => {
  const fns: Record<string | symbol, jest.Mock> = {};
  return { HapticService: new Proxy(fns, { get: (t, k) => (t[k] ??= jest.fn()) }), setHapticsEnabled: jest.fn() };
});
jest.mock('../../wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const tokens = require('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});
jest.mock('../../../../ui/charts/StyleCMarks', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return {
    PeakStar: () => createElement(View, { testID: 'peak-star' }),
    SegmentedRing: ({ label }: { label: string }) => createElement(View, { testID: 'ring', accessibilityLabel: label }),
  };
});
jest.mock('../../../../components/progress/WeightTrendChartDark', () => () =>
  require('react').createElement(require('react-native').View, { testID: 'progress-weight-chart' }));

/** The unit stored on the exercise row: 'absent' leaves the key out, anything else is sent as is. */
type Unit = 'reps' | 'seconds' | 'minutes' | null | 'absent';
const lift = (day: string, name: string, weights: number[], counts: number[], unit: Unit): Session => ({
  date: `${day}T00:00:00.000Z`,
  exercises: [{ exercise_name: name, weight_per_set: weights, reps_per_set: counts, ...(unit === 'absent' ? {} : { asked_unit: unit }) }],
});
// P1: a suitcase hold, 60 lb x 45 s ten days ago, 70 lb x 45 s three days ago (a timed new best).
const hold = (unit: Unit) => [
  lift(ago(10), 'Suitcase hold', [60], [45], unit), lift(ago(3), 'Suitcase hold', [70, 65], [45, 45], unit),
];
// P2: C2_progress's rep best, "185 lb × 5" (ProgressV2.test.tsx's Strength case).
const squat = (unit: Unit) => [
  lift(ago(10), 'Back squat', [175], [5], unit), lift(ago(3), 'Back squat', [185, 180], [5, 5], unit),
];
// P3: one exercise, a rep session 100 x 8, then a timed session 100 x 60 s, both within 30 days.
const repThenTimed = [lift(ago(10), 'Goblet squat', [100], [8], 'reps'), lift(ago(3), 'Goblet squat', [100], [60], 'seconds')];

const mount = async () => {
  const v = await render(<ProgressScreen />);
  await waitFor(() => expect(mockHistory).toHaveBeenCalled());
  return v;
};
const strength = async (v: Awaited<ReturnType<typeof mount>>) => v.findByTestId('progress-strength');

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'u1', coach_id: 'c1', profile: { target_weight_lbs: 170 } };
  mockSessions = [];
});

it('9 P1: a timed best reads 70 lb × 45 sec over "Suitcase hold, {Mon d}", a New best over the earlier hold; latestBest says timed', async () => {
  mockSessions = hold('seconds');
  const v = await mount();
  const tile = await strength(v);
  await waitFor(() => expect(within(tile).getByText(`70 lb × 45${NBSP}sec`)).toBeTruthy());
  expect(within(tile).getByText(/^Suitcase hold, \w{3} \d+$/)).toBeTruthy();
  expect(within(tile).getByText('New best')).toBeTruthy();
  expect(latestBest(hold('seconds'), today)).toMatchObject({ name: 'Suitcase hold', weight: 70, reps: 45, isNew: true, timed: true });
  expect(latestBest(hold('reps'), today)).toMatchObject({ name: 'Suitcase hold', weight: 70, reps: 45, isNew: true, timed: false });
});

describe('10 P2: a unit of reps, null, absent or anything else reads exactly as main', () => {
  it.each([['reps', 'reps'], ['null', null], ['absent', 'absent'], ['minutes', 'minutes']] as Array<[string, Unit]>)(
    'unit %s',
    async (_label, unit) => {
      const plain = latestBest(squat('absent'), today);
      expect(plain).toMatchObject({ name: 'Back squat', weight: 185, reps: 5, isNew: true });
      const { name, weight, reps, date, isNew } = plain!;
      expect(latestBest(squat(unit), today)).toMatchObject({ name, weight, reps, date, isNew });
      mockSessions = squat(unit);
      const v = await mount();
      const tile = await strength(v);
      await waitFor(() => expect(within(tile).getByText('185 lb × 5')).toBeTruthy());
      expect(within(tile).getByText('New best')).toBeTruthy();
      expect(within(tile).queryByText(/sec/)).toBeNull();
    },
  );
});

it('11 P3: a rep session 100 x 8 then a timed 100 x 60 s are two lifts: no New best for the hold; the tile shows the hold', async () => {
  mockSessions = repThenTimed;
  const v = await mount();
  const tile = await strength(v);
  await waitFor(() => expect(within(tile).getByText(`100 lb × 60${NBSP}sec`)).toBeTruthy());
  expect(within(tile).queryByText('New best')).toBeNull();
  expect(within(tile).getByText(/^Goblet squat, \w{3} \d+$/)).toBeTruthy();
  expect(latestBest(repThenTimed, today)).toMatchObject({ name: 'Goblet squat', weight: 100, reps: 60, isNew: false, timed: true });
});

it('12 P1 for a kg client: the hold reads {kg} kg × 45 sec with main\'s conversion', async () => {
  mockUser.profile.weight_unit = 'kg';
  mockSessions = hold('seconds');
  const kg = `${formatWeight(toUnit(70, 'kg'))} kg × 45${NBSP}sec`;
  expect(kg).toBe(`31.8 kg × 45${NBSP}sec`);
  const v = await mount();
  const tile = await strength(v);
  await waitFor(() => expect(within(tile).getByText(kg)).toBeTruthy());
});
