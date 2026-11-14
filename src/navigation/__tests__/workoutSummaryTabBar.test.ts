/**
 * FIX-974R1 (LS-974R1 B1): the client tab bar is hidden while the workout summary (C2_summary_*, C2_error_*) is open:
 * the tab's focused screen is the live workout and its route says summary. Every other screen keeps the bar.
 */
import { summaryHidesTabBar } from '../workoutSummaryTabBar';

const tab = (routes: Array<{ name: string; params?: Record<string, unknown> }>, index?: number) => ({
  name: 'Log', state: { routes: routes.map((r, i) => ({ key: `${r.name}-${i}`, ...r })), ...(index == null ? {} : { index }) },
});

it.each([
  ['the live workout with the summary open', tab([{ name: 'WorkoutMain' }, { name: 'ActiveWorkout', params: { summary: true } }], 1), true],
  ['the same, a partial state with no index (the last route is focused)', tab([{ name: 'WorkoutMain' }, { name: 'ActiveWorkout', params: { summary: true } }]), true],
  ['the live workout, summary closed again', tab([{ name: 'WorkoutMain' }, { name: 'ActiveWorkout', params: { summary: false } }], 1), false],
  ['the live workout before Finish workout', tab([{ name: 'WorkoutMain' }, { name: 'ActiveWorkout', params: { routineName: 'Upper body A' } }], 1), false],
  ['Train with the workout under it (the summary is not in view)', tab([{ name: 'WorkoutMain' }, { name: 'ActiveWorkout', params: { summary: true } }], 0), false],
  ['another screen that happens to carry summary', tab([{ name: 'WorkoutHistoryEdit', params: { summary: true } }], 0), false],
  ['a tab whose stack has not rendered yet', { name: 'Log' }, false],
  ['an empty state', { name: 'Log', state: { routes: [] } }, false],
])('%s', (_case, route, hidden) => {
  expect(summaryHidesTabBar(route)).toBe(hidden);
});
