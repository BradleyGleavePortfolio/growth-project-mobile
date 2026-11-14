/**
 * B-TEST LS-986R1 B1 (growth-project-mobile#986 at dbcb139b): on an exercise's page, a weighted exercise whose sets
 * were logged at 0 lb must not read as body weight. The app's own rule (src/utils/workout/bodyWeight.ts, FIX-928-BW):
 * body weight comes from the exercise's equipment, never from a 0 weight; a weighted exercise at 0 keeps its number.
 * The page holds the exercise's equipment (detail.equipment), so it can tell. The real ExerciseDetailScreen in a
 * navigator; only the HTTP client (services/api) is mocked, as workoutDetailM.screen.test.tsx mocks it.
 */
import React from 'react';
import { render, within } from '@testing-library/react-native';
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

const detail = (name: string, equipment: string[]) => ({
  id: '0025', slug: '0025', name, primaryMuscle: 'pectorals', category: 'chest', difficulty: '',
  secondaryMuscles: [], equipment, instructions: ['Lower the bar, then press it up.'], playbackUrl: null, gifUrl: null,
});
// Three sets of 10 ticked with no weight typed: the server stores and returns 0 lb.
const untyped = {
  workout_id: 'w-1', date: '2026-10-13', sets: 3, reps_per_set: [10, 10, 10], weight_per_set_lbs: [0, 0, 0], rpe: null,
  top_set: { weight_lbs: 0, reps: 10 }, est_1rm_lbs: null, volume_lbs: 0, coach_comments: [],
};
const point = { date: untyped.date, top_set: untyped.top_set };
const ANSWER = { best: point, first: point, sessions: [untyped] };

function serve(name: string, equipment: string[]) {
  get.mockImplementation((url: string) => {
    const data = url.startsWith('/exercise-catalog/') ? detail(name, equipment)
      : url.startsWith('/workouts/exercise-history') ? ANSWER : null;
    return data ? Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config: {} })
      : Promise.reject({ response: { status: 404 } });
  });
}
const screen = () => render(
  <NavigationContainer>
    <Stack.Navigator>
      <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug: '0025' }} />
    </Stack.Navigator>
  </NavigationContainer>,
);

beforeEach(() => get.mockReset());

it('B1: a barbell exercise logged at 0 lb never reads "BW" or "body weight" in Best ever or its row; a body-weight exercise still reads BW', async () => {
  serve('Barbell bench press', ['barbell']);
  const weighted = await screen();
  const best = await weighted.findByTestId('exercise-history-best');
  expect(within(best).queryAllByText(/BW/)).toHaveLength(0);
  expect(within(weighted.getByTestId('exercise-history-row-0')).queryAllByText(/BW/)).toHaveLength(0);
  expect(weighted.queryAllByLabelText(/body weight/i)).toHaveLength(0);
  weighted.unmount();

  serve('Push-up', ['body weight']);
  const bodyWeight = await screen();
  expect(within(await bodyWeight.findByTestId('exercise-history-best')).getByText('BW × 10')).toBeTruthy();
  expect(bodyWeight.getAllByLabelText('body weight by 10').length).toBeGreaterThan(0);
});
