/**
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
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AxiosResponse } from 'axios';

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
import { spacing } from '../theme/tokens';
import type { WorkoutStackParamList } from '../navigation/ClientNavigator';

const W3 = 'No details for this exercise yet.';
const FAILED = 'Exercise details did not load. Check your connection and try again.';
const get = api.get as jest.Mock;
const Stack = createNativeStackNavigator<WorkoutStackParamList>();

function ok<T>(data: T): AxiosResponse<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as any };
}
const httpError = (status: number) => ({ response: { status } });
const noAnswer = { message: 'Network Error' };
const timeout = { code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' };
const libraryRow = {
  id: '0025', name: 'barbell bench press', bodyPart: 'chest', target: 'pectorals',
  secondaryMuscles: [], equipment: 'barbell', instructions: ['Lie on the bench.'], gifUrl: '',
};

function screen() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug: '0025' }} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

beforeEach(() => get.mockReset());

it('says the library has no details yet, with no Retry, when the exercise is not in the library (404)', async () => {
  get.mockRejectedValueOnce(httpError(404)).mockRejectedValueOnce(httpError(404));
  const view = await screen();
  expect(await view.findByText(W3)).toBeTruthy();
  expect(view.queryByText(FAILED)).toBeNull();
  expect(view.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(view.queryByText('Retry')).toBeNull();
  expect(get.mock.calls.map((c) => c[0])).toEqual(['/exercise-catalog/0025', '/exercises/0025']);
  const state = StyleSheet.flatten(view.getByTestId('exercise-detail-missing').props.style);
  expect(state.paddingHorizontal).toBe(spacing.lg);
});

it.each([
  ['no network on the catalog read', [noAnswer]],
  ['a timeout on the catalog read', [timeout]],
  ['a server error on the catalog read', [httpError(500)]],
  ['an access refusal on the catalog read', [httpError(403)]],
  ['no network on the fallback read', [httpError(404), noAnswer]],
  ['a server error on the fallback read', [httpError(404), httpError(503)]],
])('keeps the failed-load words and a working Retry on %s', async (_label, failures) => {
  for (const failure of failures) get.mockRejectedValueOnce(failure);
  get.mockRejectedValueOnce(httpError(404)).mockResolvedValueOnce(ok(libraryRow));
  const view = await screen();
  expect(await view.findByText(FAILED)).toBeTruthy();
  expect(view.queryByText(W3)).toBeNull();
  const state = StyleSheet.flatten(view.getByTestId('exercise-detail-error').props.style);
  expect(state.paddingHorizontal).toBe(spacing.lg);
  const retry = view.getByRole('button', { name: 'Retry' });
  expect(StyleSheet.flatten(retry.props.style).minHeight).toBe(44);
  await fireEvent.press(retry);
  expect(await view.findByText('Lie on the bench.')).toBeTruthy();
  expect(view.queryByText(FAILED)).toBeNull();
});
