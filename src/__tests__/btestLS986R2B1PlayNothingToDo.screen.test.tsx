/**
 * B-TEST LS-986R2 B1 (growth-project-mobile#986 at 29d96f74): the bar's play control is drawn on a page that has an
 * animation only and no history above it, where the demonstration is already the first thing under the name. A press
 * there starts nothing (an animation moves by itself; ExerciseDetailScreen.tsx:158 plays a video only) and scrolls to
 * where the page already is, so the control has nothing to do (KT-3; this round's own rule, refine986.screen.test.tsx:202:
 * "a drawn control with nothing to do is not drawn"). With a video the control stays: a press starts it.
 * The real ExerciseDetailScreen in a navigator; only the HTTP client (services/api) and the video player are mocked, as
 * refine986.screen.test.tsx mocks them.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackHeaderProps } from '@react-navigation/native-stack';

jest.mock('../ui/skeletons/Skeleton', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View: MockView } = require('react-native');
  return {
    __esModule: true,
    SkeletonScreen: (props: { testID?: string }) => ReactLib.createElement(MockView, { testID: props.testID }),
  };
});
const mockPlayer = { loop: false, play: jest.fn(), addListener: () => ({ remove: () => undefined }) };
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: 'VideoView' }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const t = require('../theme/tokens');
    return { semanticColors: t.lightTokens };
  },
}));
jest.mock('../services/api', () => {
  const get = jest.fn();
  return { __esModule: true, default: { get, defaults: { baseURL: 'http://test.local/api' } }, get };
});

import api from '../services/api';
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import type { WorkoutStackParamList } from '../navigation/ClientNavigator';

const get = api.get as jest.Mock;
const Stack = createNativeStackNavigator<WorkoutStackParamList>();
const PLAY = 'Play demonstration';

// A fictional row in the shape the /exercises fallback maps (exerciseCatalog.ts fromLibrary).
const DETAIL = {
  id: '0025', slug: '0025', name: 'Bench press', primaryMuscle: 'pectorals', category: 'chest', difficulty: '',
  secondaryMuscles: ['triceps'], equipment: ['barbell'], instructions: ['Lie flat on the bench.'],
  playbackUrl: null as string | null, gifUrl: null as string | null,
};
// The client has never logged this exercise: the server's answer with no session, so no history is drawn.
const NO_HISTORY = { best: null, first: null, sessions: [] };

function serve(detail: typeof DETAIL) {
  get.mockImplementation((url: string) => {
    const data = url.startsWith('/exercise-catalog/') ? detail : url.startsWith('/workouts/exercise-history') ? NO_HISTORY : null;
    return data ? Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config: {} })
      : Promise.reject({ response: { status: 404 } });
  });
}
/** The bar as the screen leaves it: the test header draws the headerRight the screen sets. */
function TestBar({ options }: NativeStackHeaderProps) {
  return (
    <View testID="bar">
      <Text>{typeof options.title === 'string' ? options.title : ''}</Text>
      {options.headerRight ? options.headerRight({ canGoBack: true }) : null}
    </View>
  );
}
const screen = () => render(
  <NavigationContainer>
    <Stack.Navigator>
      <Stack.Screen
        name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug: '0025' }}
        options={{ headerShown: true, title: 'Exercise', headerShadowVisible: false, presentation: 'modal', header: TestBar }}
      />
    </Stack.Navigator>
  </NavigationContainer>,
);
const settle = () => waitFor(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

beforeEach(() => {
  get.mockReset();
  mockPlayer.play.mockReset();
});

it('B1: with an animation only and no history above it the bar draws no play control (nothing to play, nowhere to go); with a video it stays and a press starts it', async () => {
  serve({ ...DETAIL, gifUrl: 'https://media.test.local/bench.gif' });
  const animation = await screen();
  // The demonstration is the first thing under the name and the meta line.
  await fireEvent(await animation.findByTestId('exercise-detail-animation'), 'layout', { nativeEvent: { layout: { x: 0, y: 80, width: 342, height: 192 } } });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/workouts/exercise-history?name=Bench%20press'));
  await settle();
  expect(animation.queryByTestId('exercise-history')).toBeNull();
  expect(within(animation.getByTestId('bar')).queryByRole('button', { name: PLAY })).toBeNull();
  animation.unmount();

  serve({ ...DETAIL, playbackUrl: 'https://stream.test.local/bench.m3u8' });
  const video = await screen();
  await video.findByTestId('exercise-detail-player');
  await fireEvent.press(await within(video.getByTestId('bar')).findByRole('button', { name: PLAY }));
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});
