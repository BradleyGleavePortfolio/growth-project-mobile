/**
 * LO-918 B-TEST (round 1). Base: the PR's own W3 harness.
 *
 * W3 (owner #191-E3, about 19:35 PST 11-01, verbatim: "Words for exercise
 * details - approved"): when the library has no details for an exercise
 * (the server answers 404 for that id on both the catalog and the
 * /exercises fallback), Exercise details says "No details for this
 * exercise yet." with no Retry. A failed load (no network, a timeout, a
 * 5xx, an access refusal) keeps today's words and its working Retry.
 *
 * Runs through the real exerciseCatalogApi.getDetail (catalog, then the
 * /exercises fallback on a catalog 404), with only the HTTP client mocked.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

jest.mock('../ui/skeletons/Skeleton', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  return {
    __esModule: true,
    SkeletonScreen: (props: { testID?: string }) => ReactLib.createElement(View, { testID: props.testID }),
  };
});
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ loop: false, addListener: () => ({ remove: () => undefined }) }),
  VideoView: 'VideoView',
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../theme/tokens').lightTokens }),
}));
jest.mock('../services/api', () => {
  const get = jest.fn();
  return { __esModule: true, default: { get, defaults: { baseURL: 'http://test.local/api' } }, get };
});

import api from '../services/api';
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import { catalogKey } from '../utils/workout/exerciseId';
import type { WorkoutStackParamList } from '../navigation/ClientNavigator';

const W3 = 'No details for this exercise yet.';
const FAILED = 'Exercise details did not load. Check your connection and try again.';
const get = api.get as jest.Mock;
const Stack = createNativeStackNavigator<WorkoutStackParamList>();

const httpError = (status: number) => ({ response: { status } });

// Watch video on a saved routine's exercise with no library id (every routine
// today: production's catalog table has no rows) opens the exercise by its name
// slug. The catalog answers 404. /exercises only holds ExerciseDB ids and seed:
// ids, so backend main 8a99e76f answers a slug with 500 (fetchApi throws a plain
// Error on the upstream non-OK answer; HttpExceptionFilter makes it 500).
// The library has no details for this exercise; W3 must show, not the
// connection words with a Retry that can never work.
const slugKey = catalogKey('routine:r1/barbell-bench-press', 'Barbell Bench Press');

function screen(idOrSlug: string) {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug }} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

beforeEach(() => get.mockReset());

it('shows W3, not the connection words, when a saved routine exercise is not in the library (catalog 404, slug unknown to /exercises)', async () => {
  expect(slugKey).toBe('barbell-bench-press');
  get.mockImplementation((url: string) => Promise.reject(
    httpError(url.startsWith('/exercise-catalog/') ? 404 : 500),
  ));
  const view = await screen(slugKey);
  expect(await view.findByText(W3)).toBeTruthy();
  expect(view.queryByText(FAILED)).toBeNull();
  expect(view.queryByText('Retry')).toBeNull();
});
