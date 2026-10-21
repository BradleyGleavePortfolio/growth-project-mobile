/**
 * LEARN-POLISH (flag learnCourses): the c06 footer's Next on a real stack shaped like ClientNavigator's Train stack. Next opens the week's next
 * lesson in place of the one just done, so Back from it returns to the week, never to the lesson already finished.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api, { lessonsApi } from '../../../../services/api';
import CourseLessonScreen from '../CourseLessonScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ addListener: () => ({ remove: () => undefined }) }), VideoView: () => null }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me', coach_id: 'c1' }) }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../useMotionAnswer', () => ({ useMotionAnswer: () => true })); // the moments' own Reduce Motion read (CourseMomentsMotion.test covers it)
jest.mock('../../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }), isEffectivelyOnline: (n: { online: boolean }) => n.online }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() }, lessonsApi: { complete: jest.fn() } }));

const lesson = (id: string, title: string, done: boolean) => ({ id, title, kind: 'page', done, body_markdown: `${title}, the page.` });
const COURSE = { id: 'k1', title: 'Knee Rehab', coach_name: 'Sam Lee', starts_on: '2026-09-28', modules: [
  { id: 'w1', position: 1, title: 'Build the base', open: true, opens_on: '2026-10-12', finish_by: '2026-10-18',
    lessons: [lesson('l31', 'Quad sets', true), lesson('l32', 'How much discomfort is fine', false), lesson('l33', 'Stairs without fear', false)] },
] };
const Train = createNativeStackNavigator();
const ref = createNavigationContainerRef<ParamListBase>();
const Nothing = () => null;
const stack = () => ref.getRootState().routes.map((r) => `${r.name}${(r.params as { lesson?: string } | undefined)?.lesson ?? ''}`);

it('Next opens the next lesson in place of this one; Back from it returns to the week', async () => {
  jest.mocked(api.get).mockImplementation(((url: string) => Promise.resolve({ data: url === '/v1/client/courses' ? [COURSE] : COURSE })) as never);
  jest.mocked(lessonsApi.complete).mockResolvedValue({ data: {} } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      <QueryClientProvider client={qc}>
        <NavigationContainer ref={ref} initialState={{ index: 3, routes: [{ name: 'WorkoutMain' }, { name: 'Course', params: { id: 'k1' } },
          { name: 'CourseWeek', params: { id: 'k1', week: 'w1' } }, { name: 'CourseLesson', params: { id: 'k1', lesson: 'l32' } }] }}>
          <Train.Navigator screenOptions={{ headerShown: false }}>
            <Train.Screen name="WorkoutMain" component={Nothing} />
            <Train.Screen name="Course" component={Nothing} />
            <Train.Screen name="CourseWeek" component={Nothing} />
            <Train.Screen name="CourseLesson" component={CourseLessonScreen} />
          </Train.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await fireEvent.press(await screen.findByText('Mark as complete'));
  await fireEvent.press(await screen.findByText('Next: Stairs without fear'));
  expect(await screen.findByText('Stairs without fear, the page.')).toBeTruthy();
  expect(screen.getByText('Week 1')).toBeTruthy(); // Back still names the week
  expect(stack()).toEqual(['WorkoutMain', 'Course', 'CourseWeek', 'CourseLessonl33']);
  await act(async () => ref.goBack());
  expect(stack()).toEqual(['WorkoutMain', 'Course', 'CourseWeek']);
});
