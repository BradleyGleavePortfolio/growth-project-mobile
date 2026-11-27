/**
 * LS-WRM-1 B2 (B-TEST, growth-project-mobile#1000 @ 5e563c75): the refused-workout sheet keeps its actions in view.
 *
 * GOAL tgp-agent-context#579 planning/WORKOUT-OFFLINE-MOCK, frames s2_R4a and s2_R4b (src/html/s2_R4a__ios320_130.html):
 * the sheet is a column with the lede, the server's words and the sets in the part that scrolls (`.sbody`,
 * data-scroll) and Send again, Tell <coach>, Remove from this phone and the footnote under it in a part that never
 * scrolls (`.sacts`, flex none). So on a 320 pt phone, or with larger text, the three actions are on screen the moment
 * the sheet opens. At 5e563c75 the whole sheet is one ScrollView, and at 320 pt the sheet opens with no action in view.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import type { RefusedWorkout } from '../../../offline/sync/sync-engine';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));

import { RefusedWorkoutSheet } from '../RefusedWorkoutCard';

const item: RefusedWorkout = {
  id: 'a',
  body: {
    date: '2026-10-10', workout_name: 'Upper body B', workout_type: 'strength', duration_minutes: 48, notes: '',
    exercises: [
      { exercise_name: 'Bench press', sets_completed: 3, reps_per_set: [8, 8, 8], weight_per_set: [145, 145, 145] },
      { exercise_name: 'Barbell row', sets_completed: 3, reps_per_set: [8, 8, 8], weight_per_set: [135, 135, 135] },
    ],
  },
  refusal: {
    status: 400, code: 'WORKOUT_INVALID', said: 'property surprise should not exist',
    nextStep: 'If an app update is waiting, install it, then send it again.',
  },
};

type Node = { type: unknown; parent: Node | null };
/** True when the element sits inside a scroll view (any host or composite named ...ScrollView). */
function scrolls(el: unknown): boolean {
  for (let n = (el as Node).parent; n; n = n.parent) {
    const t = n.type as { displayName?: string; name?: string } | string;
    const name = typeof t === 'string' ? t : t?.displayName ?? t?.name ?? '';
    if (/ScrollView/.test(name)) return true;
  }
  return false;
}

describe('LS-WRM-1 B2: the sheet pins its actions under the part that scrolls (GOAL s2_R4a, s2_R4b)', () => {
  const noop = () => undefined;
  const open = (again: boolean) => render(
    <RefusedWorkoutSheet item={item} coach="Sam" again={again} busy={false}
      onClose={noop} onSend={noop} onTell={noop} onRemove={noop} />,
  );

  it('the sets scroll (the harness can tell what is inside the scroller)', async () => {
    const view = await open(false);
    expect(scrolls(view.getByText('3 × 8 · 145 lb'))).toBe(true);
  });

  it.each([
    ['Send again', 'refused-sheet-send'],
    ['Tell Sam', 'refused-sheet-tell'],
    ['Remove from this phone', 'refused-sheet-remove'],
  ])('%s is outside the scroller, so it is in view when the sheet opens', async (_label, testID) => {
    const view = await open(false);
    expect(scrolls(view.getByTestId(testID))).toBe(false);
  });

  it('s2_R4b: "Not accepted again." sits with Send again, outside the scroller', async () => {
    const view = await open(true);
    expect(scrolls(view.getByTestId('refused-sheet-again'))).toBe(false);
    expect(scrolls(view.getByTestId('refused-sheet-send'))).toBe(false);
  });
});
