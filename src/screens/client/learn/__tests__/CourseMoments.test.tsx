// LEARN-M7 (flag learnCourses): the lesson, week and course moments (c06, c08, c09, c10) and where the course home and a week show them.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import CourseHomeScreen from '../CourseHomeScreen';
import CourseWeekScreen from '../CourseWeekScreen';
import CourseCompleteScreen from '../CourseCompleteScreen';
import { LessonCompleteMoment } from '../CourseMomentSheet';
import { coursesFrom, type Course } from '../courseData';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), getState: jest.fn() };
let [mockParams, mockFocused] = [{} as Record<string, string>, true];
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({ params: mockParams }), useIsFocused: () => mockFocused }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me', coach_id: 'c1' }) }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }), isEffectivelyOnline: (n: { online: boolean }) => n.online }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() }, lessonsApi: { complete: jest.fn() } }));
jest.mock('../courseData', () => ({ ...jest.requireActual('../courseData'), today: () => '2026-10-14' }));

// Each test gets its own week ids: a week is celebrated once per app session.
let run = 0;
const lesson = (id: string, title: string, done: boolean) => ({ id, title, kind: 'page', done });
const week = (id: string, position: number, title: string, open: boolean, opens_on: string, finish_by: string, lessons: object[]) => ({ id, position, title, open, opens_on, finish_by, lessons });
const raw = (done3: boolean[], done4 = false) => ({
  id: 'k1', title: 'Knee Rehab, 8 weeks', coach_name: 'Sam Lee', starts_on: '2026-09-28',
  modules: [
    week(`a${run}`, 1, 'Start here', true, '2026-09-28', '2026-10-04', [lesson('l11', 'How the weeks work', true)]),
    week(`b${run}`, 2, 'Calm it down', true, '2026-10-05', '2026-10-11', [lesson('l21', 'Easy range', true)]),
    week(`c${run}`, 3, 'Build the base', true, '2026-10-12', '2026-10-18', done3.map((d, i) => lesson(`l3${i}`, `Base ${i + 1}`, d))),
    week(`d${run}`, 4, 'Strength', done4, '2026-10-19', '2026-10-25', [lesson('l41', 'Step-ups', done4), lesson('l42', 'Lunges', done4)]),
  ],
});
const get = jest.mocked(api.get);
const serve = (data: object) => get.mockImplementation(((url: string) => Promise.resolve({ data: url === '/v1/client/courses' ? [data] : data })) as never);
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const wrap = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  </SafeAreaProvider>
);
/** The server saved the last lesson of week 3 (what the lesson screen's markDone does to the cache). */
const finishWeek3 = (qc: QueryClient) => qc.setQueryData<Course>(['learn-course', 'me', 'k1'], (c) => c && ({ ...c, weeks: c.weeks.map((w) => (w.n === 3 ? { ...w, lessons: w.lessons.map((l) => ({ ...l, done: true })) } : w)) }));

beforeEach(() => { jest.clearAllMocks(); run += 1; mockFocused = true; mockParams = { id: 'k1' }; });

describe('c06 lesson complete', () => {
  const [l] = coursesFrom([raw([true, false])])[0].weeks[2].lessons;
  const [, next] = coursesFrom([raw([true, false])])[0].weeks[2].lessons;
  const view = (props: object) => render(<SafeAreaProvider><LessonCompleteMoment lesson={l} done={1} total={2} {...props} /></SafeAreaProvider>);

  it('says the approved lines and Next opens the next lesson', async () => {
    const onNext = jest.fn();
    await view({ next, onNext });
    ['Lesson 3.1 complete.', '1 of 2 done', 'Next: Base 2'].forEach((t) => expect(screen.getByText(t)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('lesson-moment-next'));
    expect(onNext).toHaveBeenCalledWith(next);
  });

  it('has no Next when the open week has no lesson left', async () => {
    await view({ next: null, onNext: jest.fn() });
    expect(screen.getByText('Lesson 3.1 complete.')).toBeTruthy();
    expect(screen.queryByTestId('lesson-moment-next')).toBeNull();
  });
});

describe('c09 locked week sheet', () => {
  it('opens from a week not open yet with its date and lesson titles only, and closes with OK', async () => {
    serve(raw([true, false]));
    await render(<CourseHomeScreen />, { wrapper: wrap(client()) });
    await fireEvent.press(await screen.findByLabelText('Week 4 · Strength, Opens Mon Oct 19'));
    expect(HapticService.selection).toHaveBeenCalled();
    ['Week 4 · Strength', 'Opens Mon Oct 19', 'Step-ups', 'Lunges'].forEach((t) => expect(screen.getAllByText(t).length).toBeGreaterThan(0));
    expect(screen.getAllByTestId('locked-week-lesson')).toHaveLength(2);
    expect(mockNav.navigate).not.toHaveBeenCalled(); // a locked week never opens its page
    await fireEvent.press(screen.getByTestId('locked-week-close'));
    expect(screen.queryByTestId('locked-week')).toBeNull();
  });
});

describe('c08 week complete', () => {
  it('shows when the last lesson of a week is saved, once the client is back, with the next week and the bars', async () => {
    serve(raw([true, false]));
    mockParams = { id: 'k1', week: `c${run}` };
    const qc = client();
    const view = await render(<CourseWeekScreen />, { wrapper: wrap(qc) });
    await screen.findByText('Build the base');
    mockFocused = false; // a lesson is in front
    finishWeek3(qc);
    await view.rerender(<CourseWeekScreen />);
    expect(screen.queryByTestId('week-moment')).toBeNull();
    mockFocused = true;
    await view.rerender(<CourseWeekScreen />);
    await waitFor(() => expect(screen.getByTestId('week-moment')).toBeTruthy());
    ['Week 3 done', '2 of 2 lessons · Build the base', 'Week 4 opens Mon Oct 19.', '3 of 4 weeks'].forEach((t) => expect(screen.getByText(t)).toBeTruthy());
    expect(HapticService.success).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('week-moment-close'));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('week-moment')).toBeNull();
  });

  it('is shown by the home when no week page is open, and not for a week that was already done', async () => {
    serve(raw([true, true]));
    const qc = client();
    const view = await render(<CourseHomeScreen />, { wrapper: wrap(qc) });
    await screen.findByText('Week 3 of 4');
    expect(screen.queryByTestId('week-moment')).toBeNull(); // done before the course opened
    qc.setQueryData<Course>(['learn-course', 'me', 'k1'], (c) => c && ({ ...c, weeks: c.weeks.map((w) => (w.n === 4 ? { ...w, open: true, lessons: w.lessons.map((l) => ({ ...l, done: true })) } : w)) }));
    await view.rerender(<CourseHomeScreen />);
    await waitFor(() => expect(screen.getByText('Week 4 done')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('week-moment-close'));
    expect(mockNav.goBack).not.toHaveBeenCalled();
    await view.rerender(<CourseHomeScreen />);
    expect(screen.queryByTestId('week-moment')).toBeNull(); // once
  });
});

describe('c10 course complete', () => {
  const all = () => raw([true, true], true);

  it('swaps Up next for the record on the home once every lesson is done', async () => {
    serve(all());
    await render(<CourseHomeScreen />, { wrapper: wrap(client()) });
    await screen.findByTestId('course-record-card');
    expect(screen.queryByTestId('course-up-next')).toBeNull();
    await fireEvent.press(screen.getByTestId('course-record-open'));
    expect(mockNav.navigate).toHaveBeenLastCalledWith('CourseComplete', { id: 'k1' });
  });

  it('keeps Up next while a lesson is left', async () => {
    serve(raw([true, false], true));
    await render(<CourseHomeScreen />, { wrapper: wrap(client()) });
    await screen.findByTestId('course-up-next');
    expect(screen.queryByTestId('course-record-card')).toBeNull();
  });

  it('draws the record and Back to Train returns to Train', async () => {
    serve(all());
    await render(<CourseCompleteScreen />, { wrapper: wrap(client()) });
    await screen.findByText('Your record');
    ['Course complete', 'Knee Rehab, 8 weeks', 'Taught by Sam', 'Started', 'Sep 28, 2026', 'Lessons', '6 of 6', 'Weeks', '4 of 4', 'Every lesson stays open to watch or read again.']
      .forEach((t) => expect(screen.getByText(t)).toBeTruthy());
    await fireEvent.press(await screen.findByTestId('course-complete-back'));
    expect(mockNav.navigate).toHaveBeenCalledWith('WorkoutMain');
  });

  it('is not a record while a lesson is left', async () => {
    serve(raw([true, false], true));
    await render(<CourseCompleteScreen />, { wrapper: wrap(client()) });
    expect(await screen.findByText("Sam's course did not load.")).toBeTruthy();
    expect(screen.queryByText('Your record')).toBeNull();
  });
});
