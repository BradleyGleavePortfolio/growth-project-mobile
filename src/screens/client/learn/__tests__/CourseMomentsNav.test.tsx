/**
 * LEARN-M7 on real tabs and stacks shaped like ClientNavigator's (the Home tab's stack holds Messages; the Train tab's stack holds WorkoutMain and
 * the course pages): Back to Train and the record's Train back control leave only the Train root, finishing the course from the home or a week
 * ends on the record (c10), and Message {coach} on a locked week (c09) arrives in the coach's chat as Learn's Message row does.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import CourseHomeScreen from '../CourseHomeScreen';
import CourseWeekScreen from '../CourseWeekScreen';
import CourseCompleteScreen from '../CourseCompleteScreen';
import type { Course } from '../courseData';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me', coach_id: 'c1' }) }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }), isEffectivelyOnline: (n: { online: boolean }) => n.online }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../courseData', () => ({ ...jest.requireActual('../courseData'), today: () => '2026-10-14' }));

let run = 0; // fresh week ids per test: a week is celebrated once per app session
const lesson = (id: string, done: boolean) => ({ id, title: `Lesson ${id}`, kind: 'page', done });
const week = (n: number, open: boolean, done: boolean) => ({ id: `w${n}-${run}`, position: n, title: `Part ${n}`, open, opens_on: open ? null : '2026-10-19', finish_by: null,
  lessons: [lesson(`${n}a`, done), lesson(`${n}b`, done)] });
/** Weeks 1 to 3 done; week 4 locked, open and to do, or done. */
const course = (four: 'locked' | 'open' | 'done') => ({ id: 'k1', title: 'Knee Rehab', coach_name: 'Sam Lee', starts_on: '2026-09-28',
  modules: [week(1, true, true), week(2, true, true), week(3, true, true), week(4, four !== 'locked', four === 'done')] });

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const Train = createNativeStackNavigator();
const ref = createNavigationContainerRef<ParamListBase>();
const Nothing = () => null;
const HomeTab = () => (
  <HomeStack.Navigator screenOptions={{ headerShown: false }}>
    <HomeStack.Screen name="HomeMain" component={Nothing} />
    <HomeStack.Screen name="Messages" component={Nothing} />
  </HomeStack.Navigator>
);
const TrainTab = () => (
  <Train.Navigator screenOptions={{ headerShown: false }}>
    <Train.Screen name="WorkoutMain" component={Nothing} />
    <Train.Screen name="Course" component={CourseHomeScreen} />
    <Train.Screen name="CourseWeek" component={CourseWeekScreen} />
    <Train.Screen name="CourseLesson" component={Nothing} />
    <Train.Screen name="CourseComplete" component={CourseCompleteScreen} />
  </Train.Navigator>
);
let qc: QueryClient;
type Route = { name: string; params?: object };
/** The client is in Train on `routes` (over WorkoutMain), with `data` as the course the server sends. */
const mount = async (data: object, routes: Route[]) => {
  jest.mocked(api.get).mockImplementation(((url: string) => Promise.resolve({ data: url === '/v1/client/courses' ? [data] : data })) as never);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const train: Route[] = [{ name: 'WorkoutMain' }, ...routes];
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      <QueryClientProvider client={qc}>
        <NavigationContainer ref={ref} initialState={{ index: 1, routes: [{ name: 'Home' }, { name: 'WorkoutTab', state: { index: train.length - 1, routes: train } }] }}>
          <Tab.Navigator screenOptions={{ headerShown: false }}>
            <Tab.Screen name="Home" component={HomeTab} />
            <Tab.Screen name="WorkoutTab" component={TrainTab} />
          </Tab.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(qc.getQueryData(['learn-course', 'me', 'k1'])).toBeTruthy());
};
const root = () => ref.getRootState();
const stackOf = (tab: string) => root().routes.find((r) => r.name === tab)?.state?.routes.map((r) => r.name);
const here = () => [root().routes[root().index].name, ref.getCurrentRoute()?.name];
const K1 = { id: 'k1' };
const home: Route = { name: 'Course', params: K1 };
const week4 = (): Route => ({ name: 'CourseWeek', params: { id: 'k1', week: `w4-${run}` } });

beforeEach(() => { jest.clearAllMocks(); run += 1; });

it.each([['Back to Train', 'course-complete-back', false], ['the Train back control, over a week page', 'learn-back', true]] as const)(
  '%s on the course record returns to the one Train root', async (_label, button, overWeek) => {
    await mount(course('done'), [home, ...(overWeek ? [week4()] : []), { name: 'CourseComplete', params: K1 }]);
    // The record's footer draws only once the course has loaded: press after it, so the press never lands on the loading
    // masthead the loaded page can re-draw, then wait for the pop (CI saw the bare expect at :92 run before it).
    await screen.findByTestId('course-complete-back');
    await fireEvent.press(screen.getByTestId(button));
    await waitFor(() => {
      expect(stackOf('WorkoutTab')).toEqual(['WorkoutMain']);
      expect(here()).toEqual(['WorkoutTab', 'WorkoutMain']);
    });
  },
);

it.each([['the course home', false], ['a week page', true]] as const)(
  'the lesson that finishes the course ends on the record when the client is back on %s', async (_label, onWeek) => {
    const below = [home, ...(onWeek ? [week4()] : [])];
    await mount(course('open'), [...below, { name: 'CourseLesson', params: { id: 'k1', lesson: '4b' } }]);
    // The pages under the lesson have read the course (week 4 to do) before the lesson saves, as in the app.
    for (const t of onWeek ? ['Week 1 of 4', 'Part 4'] : ['Week 1 of 4']) await screen.findAllByText(t, { includeHiddenElements: true });
    // The lesson screen saved the last lesson of the course, then the client goes back.
    await act(async () => { qc.setQueryData<Course>(['learn-course', 'me', 'k1'], (c) => c && ({ ...c, weeks: c.weeks.map((w) => ({ ...w, lessons: w.lessons.map((l) => ({ ...l, done: true })) })) })); });
    await act(async () => ref.goBack());
    await screen.findByTestId('course-complete-back');
    expect(here()).toEqual(['WorkoutTab', 'CourseComplete']);
    expect(stackOf('WorkoutTab')).toEqual(['WorkoutMain', ...below.map((r) => r.name), 'CourseComplete']);
    expect(HapticService.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('week-moment')).toBeNull();
  },
);

it("Message {coach} on a locked week arrives in the coach's chat, with the sheet closed", async () => {
  await mount(course('locked'), [home]);
  await fireEvent.press(await screen.findByTestId('course-week-4'));
  await fireEvent.press(screen.getByText('Message Sam'));
  await waitFor(() => {
    expect(here()).toEqual(['Home', 'Messages']);
    expect(stackOf('Home')).toEqual(['HomeMain', 'Messages']);
  });
  await act(async () => ref.navigate('WorkoutTab'));
  expect(here()).toEqual(['WorkoutTab', 'Course']); // the course as the client left it, with no sheet over it
  expect(screen.queryByTestId('locked-week')).toBeNull();
});
