/**
 * PF-4-M (C-PF-1, #LEARN-LOCK): the course and Learn screens stay open through the Day-10 lock behind the
 * switch that shows them, as their server routes do. With the switch off they keep the lockout.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

const mockFlags = { learnHub: false, learnCourses: false };
// A getter: the flags are read when the provider asks, so each case can set its switches.
jest.mock('../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../DunningLockoutScreen', () => {
  const { Text: T } = jest.requireActual('react-native');
  return { DunningLockoutScreen: () => <T testID="lockout">locked</T> };
});
const mockGetStatus = jest.fn();
jest.mock('../dunningApi', () => ({ dunningApi: { getStatus: (...args: unknown[]) => mockGetStatus(...args) } }));

import { DunningLockoutProvider, backReachesOpenScreen, useDunning } from '../DunningLockoutProvider';
import { dunningLockoutStore } from '../dunningLockoutStore';

const LOCKED = { enabled: true, state: 'locked', kind: 'payment', lock_waived: false, purchase_id: 'p1', locked_at: '2026-10-11T15:07:00.000Z' };
const noop = () => undefined;
type Flag = keyof typeof mockFlags;
function Screen() {
  return <Text testID="screen">{String(useDunning()?.locked)}</Text>;
}

/** The lockout over the route once the lock has landed (the app underneath stays mounted). */
async function lockoutShows(route: string): Promise<boolean> {
  const view = await lockedOn(route);
  await waitFor(() => expect(view.getByTestId('screen', { includeHiddenElements: true }).props.children).toBe('true'));
  const shows = view.queryByTestId('lockout') !== null;
  await view.unmount();
  return shows;
}

async function lockedOn(route: string) {
  mockGetStatus.mockResolvedValue(LOCKED);
  const view = await render(
    <DunningLockoutProvider enabled onMessageCoach={noop} onOpenDataExport={noop} onOpenDeleteAccount={noop} onSignOut={noop}
      onOpenUpdateCard={noop} getCurrentRouteName={() => route} subscribeToRouteChanges={() => noop}>
      <Screen />
    </DunningLockoutProvider>,
  );
  await waitFor(() => expect(mockGetStatus).toHaveBeenCalled());
  return view;
}

const ROWS: ReadonlyArray<[route: string, flag: Flag | null]> = [
  ['Course', 'learnCourses'], ['CourseWeek', 'learnCourses'], ['CourseLesson', 'learnCourses'], ['CourseComplete', 'learnCourses'],
  ['Learn', 'learnHub'], ['LearnLesson', 'learnHub'], ['CoachGuidelines', 'learnHub'],
  ['Home', null], ['RomanChat', null], ['Progress', null],
];

beforeEach(() => {
  dunningLockoutStore.__resetForTests();
  mockGetStatus.mockReset();
  mockFlags.learnHub = false;
  mockFlags.learnCourses = false;
});

describe('PF-4-M: Learn and the course stay open while locked behind their switches', () => {
  it.each(ROWS.flatMap(([route, flag]) => [[route, flag, true], [route, flag, false]] as const))(
    '%s (switch %s on: %s)',
    async (route, flag, on) => {
      mockFlags.learnHub = on;
      mockFlags.learnCourses = on;
      expect(await lockoutShows(route)).toBe(!(on && flag !== null));
    },
  );

  it('each switch opens only its own screens', async () => {
    mockFlags.learnCourses = true;
    expect(await lockoutShows('Learn')).toBe(true);
    mockFlags.learnCourses = false;
    mockFlags.learnHub = true;
    expect(await lockoutShows('Course')).toBe(true);
  });

  it('a locked screen opened over Learn shows Back to it only with the switch on', () => {
    const over = { type: 'stack', index: 1, routes: [{ name: 'Learn' }, { name: 'ProgressDetail' }] };
    expect(backReachesOpenScreen(over)).toBe(false);
    mockFlags.learnHub = true;
    expect(backReachesOpenScreen(over)).toBe(true);
  });
});
