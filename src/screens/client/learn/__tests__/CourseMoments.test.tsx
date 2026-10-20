// LEARN-M7 (flag learnCourses): the lesson, week and course moments (c06, c08, c09, c10) and where the course home and a week show them.
// The same exits on real tabs and stacks: CourseMomentsNav.test.tsx.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import CourseHomeScreen from '../CourseHomeScreen';
import CourseWeekScreen from '../CourseWeekScreen';
import CourseCompleteScreen from '../CourseCompleteScreen';
import { LessonCompleteMoment } from '../CourseMomentSheet';
import { coursesFrom, type Course } from '../courseData';

const mockTabs = { navigate: jest.fn() };
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(), getState: jest.fn(), getParent: () => mockTabs };
let [mockParams, mockFocused, mockUser] = [{} as Record<string, string>, true, { id: 'me', coach_id: 'c1' as string | null }];
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav, useRoute: () => ({ params: mockParams }), useIsFocused: () => mockFocused, StackActions: { popToTop: () => ({ type: 'POP_TO_TOP' }) },
}));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }), isEffectivelyOnline: (n: { online: boolean }) => n.online }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() }, lessonsApi: { complete: jest.fn() } }));
jest.mock('../courseData', () => ({ ...jest.requireActual('../courseData'), today: () => '2026-10-14' }));

// Each test gets its own week ids: a week is celebrated once per app session.
let run = 0;
const lesson = (id: string, title: string, done: boolean) => ({ id, title, kind: 'page', done });
const week = (id: string, position: number, title: string, open: boolean, opens_on: string | null, finish_by: string, lessons: object[]) => ({ id, position, title, open, opens_on, finish_by, lessons });
const raw = (done3: boolean[], done4 = false, open4 = done4, opens4: string | null = '2026-10-19') => ({
  id: 'k1', title: 'Knee Rehab, 8 weeks', coach_name: 'Sam Lee', starts_on: '2026-09-28',
  modules: [
    week(`a${run}`, 1, 'Start here', true, '2026-09-28', '2026-10-04', [lesson('l11', 'How the weeks work', true)]),
    week(`b${run}`, 2, 'Calm it down', true, '2026-10-05', '2026-10-11', [lesson('l21', 'Easy range', true)]),
    week(`c${run}`, 3, 'Build the base', true, '2026-10-12', '2026-10-18', done3.map((d, i) => lesson(`l3${i}`, `Base ${i + 1}`, d))),
    week(`d${run}`, 4, 'Strength', open4, opens4, '2026-10-25', [lesson('l41', 'Step-ups', done4), lesson('l42', 'Lunges', done4)]),
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
/** The server saved every lesson of week `n` (what the lesson screen's markDone does to the cache). */
const finish = (qc: QueryClient, n: number) => qc.setQueryData<Course>(['learn-course', 'me', 'k1'], (c) => c && ({ ...c, weeks: c.weeks.map((w) => (w.n === n ? { ...w, lessons: w.lessons.map((l) => ({ ...l, done: true })) } : w)) }));

beforeEach(() => { jest.clearAllMocks(); run += 1; mockFocused = true; mockParams = { id: 'k1' }; mockUser = { id: 'me', coach_id: 'c1' }; });

describe('c06 lesson complete', () => {
  const [l] = coursesFrom([raw([true, false])])[0].weeks[2].lessons;
  const [, next] = coursesFrom([raw([true, false])])[0].weeks[2].lessons;
  const view = (props: object) => render(<LessonCompleteMoment lesson={l} done={1} total={2} {...props} />, { wrapper: wrap(client()) });

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
  const openSheet = async (data: object) => {
    serve(data);
    await render(<CourseHomeScreen />, { wrapper: wrap(client()) });
    await fireEvent.press(await screen.findByTestId('course-week-4'));
    return within(screen.getByTestId('locked-week'));
  };

  it('says when the week opens and why, its lesson titles only, and closes with OK', async () => {
    const sheet = await openSheet(raw([true, false]));
    expect(HapticService.selection).toHaveBeenCalled();
    ['Week 4 · Strength', 'Opens Mon Oct 19', 'Sam set this course to open one week at a time, from your start on Sep 28.', 'Step-ups', 'Lunges', 'Message Sam']
      .forEach((t) => expect(sheet.getByText(t)).toBeTruthy());
    expect(sheet.getAllByTestId('locked-week-lesson')).toHaveLength(2);
    expect(mockNav.navigate).not.toHaveBeenCalled(); // a locked week never opens its page
    await fireEvent.press(screen.getByTestId('locked-week-close'));
    expect(screen.queryByTestId('locked-week')).toBeNull();
  });

  it("Message {coach} closes the sheet and opens the coach's chat, as Learn does", async () => {
    await openSheet(raw([true, false]));
    await fireEvent.press(screen.getByTestId('locked-week-message'));
    expect(mockTabs.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', initial: false });
    expect(screen.queryByTestId('locked-week')).toBeNull(); // not left open under the chat
  });

  it('has no Message for a client with no coach, and no date or reason when the week has no open date', async () => {
    mockUser = { id: 'me', coach_id: null };
    const sheet = await openSheet(raw([true, false], false, false, null));
    expect(sheet.getByText('Week 4 · Strength')).toBeTruthy();
    ['locked-week-message', 'locked-week-why'].forEach((id) => expect(sheet.queryByTestId(id)).toBeNull());
    expect(sheet.queryByText(/^Opens /)).toBeNull();
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
    finish(qc, 3);
    await view.rerender(<CourseWeekScreen />);
    expect(screen.queryByTestId('week-moment')).toBeNull();
    mockFocused = true;
    await view.rerender(<CourseWeekScreen />);
    await waitFor(() => expect(screen.getByTestId('week-moment')).toBeTruthy());
    const peak = within(screen.getByTestId('week-moment')); // the week page also says when Week 4 opens
    ['Week 3 done', '2 of 2 lessons · Build the base', 'Week 4 opens Mon Oct 19.', '3 of 4 weeks'].forEach((t) => expect(peak.getByText(t)).toBeTruthy());
    expect(HapticService.success).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('week-moment-close'));
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('week-moment')).toBeNull();
  });

  it('is shown by the home when no week page is open, and not for a week that was already done', async () => {
    serve(raw([true, false]));
    const qc = client();
    const view = await render(<CourseHomeScreen />, { wrapper: wrap(qc) });
    await screen.findByText('Week 3 of 4');
    expect(screen.queryByTestId('week-moment')).toBeNull(); // weeks 1 and 2 were done before the course opened
    finish(qc, 3);
    await view.rerender(<CourseHomeScreen />);
    await waitFor(() => expect(screen.getByText('Week 3 done')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('week-moment-close'));
    expect(mockNav.goBack).not.toHaveBeenCalled();
    await view.rerender(<CourseHomeScreen />);
    expect(screen.queryByTestId('week-moment')).toBeNull(); // once
  });

  it.each(['home', 'week'])('the last lesson of the course opens the record (c10) from the %s with the success haptic, not a week page', async (from) => {
    serve(raw([true, true], false, true));
    if (from === 'week') mockParams = { id: 'k1', week: `d${run}` };
    const qc = client();
    const Page = from === 'week' ? CourseWeekScreen : CourseHomeScreen;
    const view = await render(<Page />, { wrapper: wrap(qc) });
    await screen.findByText(from === 'week' ? 'Strength' : 'Week 3 of 4'); // week 3 is still the week of 14 Oct
    finish(qc, 4);
    await view.rerender(<Page />);
    await waitFor(() => expect(mockNav.navigate).toHaveBeenCalledWith('CourseComplete', { id: 'k1' }));
    expect(HapticService.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('week-moment')).toBeNull();
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

  it('draws the record, and Back to Train and the Train back control both pop to the Train root', async () => {
    serve(all());
    await render(<CourseCompleteScreen />, { wrapper: wrap(client()) });
    await screen.findByText('Your record');
    ['Train', 'Course complete', 'Knee Rehab, 8 weeks', 'Taught by Sam', 'Started', 'September 28, 2026', 'Lessons', '6 of 6', 'Weeks', '4 of 4',
      'Every lesson stays open to watch or read again.'].forEach((t) => expect(screen.getByText(t)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('course-complete-back'));
    await fireEvent.press(screen.getByTestId('learn-back'));
    expect(mockNav.dispatch.mock.calls).toEqual([[{ type: 'POP_TO_TOP' }], [{ type: 'POP_TO_TOP' }]]);
    expect([mockNav.navigate, mockNav.goBack].map((f) => f.mock.calls.length)).toEqual([0, 0]);
  });

  it('shows where a loaded course stands while a lesson is left: no gold, no false error', async () => {
    serve(raw([true, false], true));
    await render(<CourseCompleteScreen />, { wrapper: wrap(client()) });
    await screen.findByText('Your record');
    ['Knee Rehab, 8 weeks', 'Taught by Sam', '5 of 6', '3 of 4'].forEach((t) => expect(screen.getByText(t)).toBeTruthy());
    ['Course complete', 'Every lesson stays open to watch or read again.', "Sam's course did not load."].forEach((t) => expect(screen.queryByText(t)).toBeNull());
  });

  it('counts a week with no lessons as done, so a finished course never reads one week short', async () => {
    const data = all();
    serve({ ...data, modules: [...data.modules, week(`e${run}`, 5, 'Rest', true, '2026-10-26', '2026-11-01', [])] });
    await render(<CourseCompleteScreen />, { wrapper: wrap(client()) });
    await screen.findByText('Course complete');
    expect(screen.getByText('5 of 5')).toBeTruthy();
  });
});
