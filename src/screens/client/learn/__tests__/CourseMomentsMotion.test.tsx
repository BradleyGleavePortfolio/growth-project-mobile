// LEARN-M7 (flag learnCourses): Reduce Motion on the course moments (c06, c08, c09), read from the OS (no motion mock in this file).
// The moments wait for the answer before they move, so a client with Reduce Motion on never sees the c06 fade or the sheets' fade/slide.
import React from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api, { lessonsApi } from '../../../../services/api';
import CourseLessonScreen from '../CourseLessonScreen';
import { LessonCompleteMoment, LockedWeekSheet, WeekCompleteSheet } from '../CourseMomentSheet';
import { coursesFrom } from '../courseData';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(), getState: jest.fn(), getParent: () => undefined };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav, useRoute: () => ({ params: { id: 'k1', lesson: 'l32' } }), useIsFocused: () => true,
  StackActions: { replace: (name: string, params: object) => ({ type: 'REPLACE', payload: { name, params } }) },
}));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ addListener: () => ({ remove: () => undefined }) }), VideoView: () => null }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me', coach_id: 'c1' }) }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }), isEffectivelyOnline: (n: { online: boolean }) => n.online }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() }, lessonsApi: { complete: jest.fn() } }));
jest.mock('../courseData', () => ({ ...jest.requireActual('../courseData'), today: () => '2026-10-14' }));
jest.mock('../../../../hooks/useRefreshOnOpen', () => ({ useRefreshOnOpen: () => undefined }));

const lesson = (id: string, title: string, done: boolean, extra: object = {}) => ({ id, title, kind: 'page', done, ...extra });
const week = (id: string, position: number, title: string, open: boolean, opens_on: string, finish_by: string, lessons: object[]) => ({ id, position, title, open, opens_on, finish_by, lessons });
const COURSE = {
  id: 'k1', title: 'Knee Rehab, 8 weeks', coach_name: 'Sam Lee', starts_on: '2026-09-28',
  modules: [
    week('m1', 1, 'Start here', true, '2026-09-28', '2026-10-04', [lesson('l11', 'How the weeks work', true)]),
    week('m2', 2, 'Calm it down', true, '2026-10-05', '2026-10-11', [lesson('l21', 'Easy range', true)]),
    week('m3', 3, 'Build the base', true, '2026-10-12', '2026-10-18', [
      lesson('l31', 'Quad sets, done right', true),
      lesson('l32', 'How much discomfort is fine', false, { body_markdown: 'Some discomfort is normal.' }),
      lesson('l33', 'Stairs without fear', false),
    ]),
    week('m4', 4, 'Strength', false, '2026-10-19', '2026-10-25', [lesson('l41', 'Step-ups', false)]),
  ],
};
const [course] = coursesFrom([COURSE]);
const wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{children}</QueryClientProvider>
  </SafeAreaProvider>
);

/** The OS answer, held until the test gives it; and the handler the moments subscribed for a change in Settings. */
let answer: (on: boolean) => void;
let changed: ((on: boolean) => void) | undefined;
let timing: jest.SpyInstance;
const ask = () => jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve; }));
/** Every c06 fade started so far (the 300 ms opacity timing to 1). */
const fades = () => timing.mock.calls.filter(([, c]) => (c as { duration?: number; toValue?: number }).duration === 300 && (c as { toValue?: number }).toValue === 1);
/** The footer's opacity; with no opacity set it is fully shown. */
const opacity = () => StyleSheet.flatten(screen.getByTestId('lesson-moment').props.style).opacity ?? 1;
/** The Modal a sheet sits in (the host element above its content). */
const modalOf = (testID: string) => {
  let n = screen.getByTestId(testID).parent;
  while (n && n.type !== 'Modal') n = n.parent;
  return n;
};

beforeEach(() => {
  jest.clearAllMocks();
  changed = undefined;
  timing = jest.spyOn(Animated, 'timing');
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((event: string, handler: (on: boolean) => void) => {
    if (event === 'reduceMotionChanged') changed = handler;
    return { remove: jest.fn() };
  }) as never);
  mockNav.getState.mockReturnValue({ index: 2, routes: [{ name: 'Course' }, { name: 'CourseWeek' }, { name: 'CourseLesson' }] });
  jest.mocked(api.get).mockImplementation(((url: string) => Promise.resolve({ data: url === '/v1/client/courses' ? [COURSE] : COURSE })) as never);
  jest.mocked(lessonsApi.complete).mockImplementation(() => Promise.resolve({ data: {} }) as never);
});
afterEach(() => jest.restoreAllMocks());

describe('c06 on the lesson screen', () => {
  it('with Reduce Motion on, Mark as complete shows the footer still: no fade starts, at full opacity', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(<CourseLessonScreen />, { wrapper: wrap });
    await fireEvent.press(await screen.findByText('Mark as complete'));
    expect(await screen.findByTestId('lesson-moment')).toBeTruthy();
    await waitFor(() => expect(opacity()).toBe(1));
    expect(fades()).toHaveLength(0);
  });

  it('with Reduce Motion off, the same press fades the footer in over 300 ms', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    await render(<CourseLessonScreen />, { wrapper: wrap });
    await fireEvent.press(await screen.findByText('Mark as complete'));
    expect(await screen.findByTestId('lesson-moment')).toBeTruthy();
    await waitFor(() => expect(fades()).toHaveLength(1));
  });
});

describe('c06 waits for the answer', () => {
  const [, l, next] = course.weeks[2].lessons;
  const show = () => render(<LessonCompleteMoment lesson={l} done={2} total={3} next={next} />, { wrapper: wrap });

  it('starts nothing before the OS answers; an answer of on shows it still', async () => {
    ask();
    await show();
    expect(screen.getByText('Lesson 3.2 complete.')).toBeTruthy();
    expect(fades()).toHaveLength(0);
    await act(async () => answer(true));
    expect(opacity()).toBe(1);
    expect(fades()).toHaveLength(0);
  });

  it('an answer of off fades it in; Reduce Motion turned on mid-fade stops it at full opacity', async () => {
    ask();
    await show();
    await act(async () => answer(false));
    expect(fades()).toHaveLength(1);
    expect(opacity()).toBeLessThan(1);
    await act(async () => changed?.(true));
    expect(opacity()).toBe(1);
    expect(fades()).toHaveLength(1);
  });
});

describe('c08 and c09 open after the answer', () => {
  it('the week page is not up before the answer, then opens without the fade when Reduce Motion is on', async () => {
    ask();
    await render(<WeekCompleteSheet course={course} week={course.weeks[2]} onClose={jest.fn()} />, { wrapper: wrap });
    expect(screen.queryByTestId('week-moment')).toBeNull();
    await act(async () => answer(true));
    expect(modalOf('week-moment')?.props.animationType).toBe('none');
  });

  it('the week page fades in when Reduce Motion is off', async () => {
    ask();
    await render(<WeekCompleteSheet course={course} week={course.weeks[2]} onClose={jest.fn()} />, { wrapper: wrap });
    await act(async () => answer(false));
    expect(modalOf('week-moment')?.props.animationType).toBe('fade');
  });

  it('the locked week opens without the slide when Reduce Motion is on, and slides up when it is off', async () => {
    ask();
    const view = await render(<LockedWeekSheet course={course} week={course.weeks[3]} onClose={jest.fn()} />, { wrapper: wrap });
    expect(screen.queryByTestId('locked-week')).toBeNull();
    await act(async () => answer(true));
    expect(modalOf('locked-week')?.props.animationType).toBe('none');
    await view.unmount();
    ask();
    await render(<LockedWeekSheet course={course} week={course.weeks[3]} onClose={jest.fn()} />, { wrapper: wrap });
    await act(async () => answer(false));
    expect(modalOf('locked-week')?.props.animationType).toBe('slide');
  });
});
