// LEARN-M5 (flag learnCourses): the Train course banner, the course home, a week and a page lesson render the
// course the server sends (routes typed from plan 7.A, mocked here until LEARN-BE2), and claim done only after it.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api, { lessonsApi } from '../../../../services/api';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { featureFlags } from '../../../../config/featureFlags';
import CourseBanner from '../CourseBanner';
import CourseHomeScreen from '../CourseHomeScreen';
import CourseWeekScreen from '../CourseWeekScreen';
import CourseLessonScreen from '../CourseLessonScreen';
import { courseNow, coursesFrom } from '../courseData';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), getState: jest.fn() };
let mockParams: Record<string, string> = {};
let mockOnline = true;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({ params: mockParams }) }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me', coach_id: 'c1' }) }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: mockOnline }), isEffectivelyOnline: (n: { online: boolean }) => n.online }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() }, lessonsApi: { complete: jest.fn() } }));
// Today is the Wednesday of week 3.
jest.mock('../courseData', () => ({ ...jest.requireActual('../courseData'), today: () => '2026-10-14' }));

const lesson = (id: string, title: string, done: boolean, extra: object = {}) => ({ id, title, kind: 'page', done, ...extra });
const week = (id: string, position: number, title: string, open: boolean, opens_on: string, finish_by: string, lessons: object[], note?: string) => ({ id, position, title, open, opens_on, finish_by, lessons, note });
const COURSE = {
  id: 'k1', title: 'Knee Rehab, 8 weeks', coach_name: 'Sam Lee', starts_on: '2026-09-28',
  modules: [
    week('m2', 2, 'Calm it down', true, '2026-10-05', '2026-10-11', [lesson('l21', 'Easy range', true)]),
    week('m1', 1, 'Start here', true, '2026-09-28', '2026-10-04', [lesson('l11', 'How the weeks work', true)]),
    week('m3', 3, 'Build the base', true, '2026-10-12', '2026-10-18', [
      lesson('l31', 'Quad sets, done right', true, { kind: 'video', duration_sec: 300 }),
      lesson('l32', 'How much discomfort is fine', false, { body_markdown: 'Some discomfort is normal.\n1. Up to 3 is fine.', description: 'Watch the morning, not the moment.' }),
      lesson('l33', 'Stairs without fear', false, { kind: 'both', duration_sec: 360 }),
    ], 'Short sessions, done often.'),
    week('m4', 4, 'Strength', false, '2026-10-19', '2026-10-25', [lesson('l41', 'Step-ups', false)]),
  ],
};
const ok = <T,>(data: T) => Promise.resolve({ data });
const seen = (texts: string[]) => texts.forEach((t) => expect(screen.getByText(t)).toBeTruthy());
const get = jest.mocked(api.get);
const complete = jest.mocked(lessonsApi.complete);

async function show(Comp: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      <QueryClientProvider client={client}><Comp /></QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'k1' }; mockOnline = true;
  mockNav.getState.mockReturnValue({ index: 1, routes: [{ name: 'WorkoutMain' }, { name: 'Course' }] });
  get.mockImplementation(((url: string) => ok(url === '/v1/client/courses' ? [COURSE] : COURSE)) as never);
  complete.mockImplementation(() => ok({}) as never);
});

describe('Train course banner', () => {
  it('is off in every build, and with the flag off Train asks for nothing', async () => {
    expect(featureFlags.learnCourses).toBe(false);
    await show(CourseBanner);
    expect(screen.queryByTestId('course-banner')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  describe('flag on', () => {
    beforeEach(() => { jest.replaceProperty(featureFlags, 'learnCourses', true); });
    it('says the approved lines and Open the course opens the course home', async () => {
      await show(CourseBanner);
      expect(await screen.findByText('Knee Rehab, 8 weeks')).toBeTruthy();
      seen(["Sam's videos and short reads, one week at a time, alongside your workouts. Week 3 is open: 1 of 3 lessons done.", '3 of 6 lessons', 'Week 3 open until Sun Oct 18']);
      expect(get).toHaveBeenCalledWith('/v1/client/courses', { quietPaywall: true });
      await fireEvent.press(screen.getByText('Open the course'));
      expect(mockNav.navigate).toHaveBeenCalledWith('Course', { id: 'k1' });
    });

    it('shows nothing when the client owns no course (c11)', async () => {
      get.mockImplementation((() => ok({ courses: [] })) as never);
      await show(CourseBanner);
      await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('course-banner')).toBeNull();
    });
  });
});

describe('Course home', () => {
  it('shows this week, the week bars, Up next and the weeks (c03)', async () => {
    await show(CourseHomeScreen);
    expect(await screen.findByText('Week 3 of 4')).toBeTruthy();
    seen(['Train', 'From Sam · started Sep 28', '3 of 6 lessons', 'Week 3 open until Sun Oct 18', 'How much discomfort is fine', 'Week 3 · lesson 2 of 3 · Page · 1 min']);
    expect(screen.getByLabelText('Week 1 · Start here, Done')).toBeTruthy();
    expect(screen.queryByTestId('course-offline')).toBeNull();

    await fireEvent.press(screen.getByText('Read lesson 3.2'));
    expect(mockNav.navigate).toHaveBeenLastCalledWith('CourseLesson', { id: 'k1', lesson: 'l32' });
    await fireEvent.press(screen.getByLabelText('Week 3 · Build the base, 1 of 3 done · finish by Sun Oct 18'));
    expect(mockNav.navigate).toHaveBeenLastCalledWith('CourseWeek', { id: 'k1', week: 'm3' });
    expect(HapticService.selection).toHaveBeenCalledTimes(1);
    // A week not open yet says when it opens and is not a button (its sheet is plan PR 7).
    const locked = screen.getByLabelText('Week 4 · Strength, Opens Mon Oct 19');
    expect(locked.props.accessibilityRole).toBeUndefined();
    await fireEvent.press(locked);
    expect(mockNav.navigate).toHaveBeenCalledTimes(2);
  });

  it('loads under a spoken label, and a failed read says so with Try again (c12)', async () => {
    get.mockImplementation((() => new Promise(() => undefined)) as never);
    const first = await show(CourseHomeScreen);
    expect(screen.getByLabelText("Loading your coach's course")).toBeTruthy();
    first.unmount();
    get.mockImplementation((() => Promise.reject(new Error('500'))) as never);
    await show(CourseHomeScreen);
    expect(await screen.findByText("Your coach's course did not load.")).toBeTruthy();
    get.mockImplementation(((url: string) => ok(url === '/v1/client/courses' ? [COURSE] : COURSE)) as never);
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Week 3 of 4')).toBeTruthy();
  });

  it('offline keeps what was read and says what needs a connection (c13)', async () => {
    mockOnline = false;
    await show(CourseHomeScreen);
    await screen.findByText('Week 3 of 4');
    seen(['You’re offline. Pages in open weeks still read here. Videos and saving progress need a connection.', 'Read lesson 3.2']);
  });
});

describe('Course week', () => {
  it('shows the dates, the coach note, the lessons with Up next and when the next week opens (c04)', async () => {
    mockParams = { id: 'k1', week: 'm3' };
    await show(CourseWeekScreen);
    expect(await screen.findByText('Build the base')).toBeTruthy();
    seen(['Knee Rehab, 8 weeks', 'Open Oct 12 to Oct 18 · 1 of 3 done', 'From Sam', 'Short sessions, done often.', '3.1 · Video · 5 min', '3.2 · Page · 1 min',
      '3.3 · Video and page · 6 min', 'Week 4 opens Mon Oct 19.']);
    expect(screen.getAllByText('Up next')).toHaveLength(1);
    await fireEvent.press(screen.getByText('Stairs without fear'));
    expect(mockNav.navigate).toHaveBeenCalledWith('CourseLesson', { id: 'k1', lesson: 'l33' });
  });
});

describe('Course lesson', () => {
  beforeEach(() => { mockParams = { id: 'k1', lesson: 'l32' }; });

  it('shows the page and the note, and done only after the server saves it (c05)', async () => {
    await show(CourseLessonScreen);
    expect(await screen.findByText('Lesson 3.2 · Page · 1 min')).toBeTruthy();
    seen(['Week 3', 'Some discomfort is normal.', 'Up to 3 is fine.', 'Watch the morning, not the moment.']);
    expect(screen.queryByText('Lesson 3.2 complete.')).toBeNull();
    await fireEvent.press(screen.getByText('Mark as complete'));
    expect(complete).toHaveBeenCalledWith('l32');
    expect(await screen.findByText('Lesson 3.2 complete.')).toBeTruthy();
    expect(screen.queryByText('Mark as complete')).toBeNull();
    expect(HapticService.success).toHaveBeenCalledTimes(1);
  });

  it('a failed save keeps the button with the sentence above it', async () => {
    complete.mockImplementation(() => Promise.reject(new Error('offline')) as never);
    await show(CourseLessonScreen);
    await fireEvent.press(await screen.findByText('Mark as complete'));
    expect(await screen.findByText('Lesson completion did not save. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByText('Mark as complete')).toBeTruthy();
    expect(HapticService.error).toHaveBeenCalledTimes(1);
  });

  it('offline the page reads and Mark as complete waits, with the reason', async () => {
    mockOnline = false;
    await show(CourseLessonScreen);
    await screen.findByText('Some discomfort is normal.');
    expect(screen.getByTestId('course-lesson-reason').props.children).toMatch(/^You’re offline\./);
    await fireEvent.press(screen.getByText('Mark as complete'));
    expect(complete).not.toHaveBeenCalled();
  });

  it('courseData orders weeks by position and, before any week opens, has no week and no Up next', () => {
    const [c] = coursesFrom({ courses: [{ ...COURSE, modules: COURSE.modules.map((m) => ({ ...m, open: false })) }, null] });
    expect(c.weeks.map((w) => w.title)).toEqual(['Start here', 'Calm it down', 'Build the base', 'Strength']);
    expect(courseNow(c, '2026-10-14')).toMatchObject({ week: null, next: null, done: 3, total: 6 });
    expect(coursesFrom('nonsense')).toEqual([]);
  });
});
