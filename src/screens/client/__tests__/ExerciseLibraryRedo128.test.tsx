import React from 'react';
import { AxiosHeaders } from 'axios';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ExerciseLibraryScreen from '../ExerciseLibraryScreen';
import ExerciseDetailScreen from '../ExerciseDetailScreen';
import { exerciseCatalogApi } from '../../../api/exerciseCatalog';
import { lightTokens } from '../../../theme/tokens';
import type { WorkoutStackParamList } from '../../../navigation/ClientNavigator';
import type { ExerciseDetail } from '../../../types/exerciseCatalog';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../api/exerciseCatalog', () => ({
  exerciseCatalogApi: { browse: jest.fn(), getDetail: jest.fn() },
}));
const mockStatusListener = jest.fn();
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ addListener: mockStatusListener }),
  VideoView: 'VideoView',
}));
const Stack = createNativeStackNavigator<WorkoutStackParamList>();
const list = jest.mocked(exerciseCatalogApi.browse);
const getDetail = jest.mocked(exerciseCatalogApi.getDetail);
const exercise: ExerciseDetail = {
  id: 'squat', slug: 'squat', name: 'Squat', primaryMuscle: 'quads', category: 'legs',
  secondaryMuscles: ['glutes'], equipment: ['barbell'], difficulty: 'beginner',
  instructions: ['Stand tall.'], playbackUrl: null,
};
function response<T>(data: T) {
  return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };
}
function screen(detail = false) {
  return render(<NavigationContainer><Stack.Navigator initialRouteName={detail ? 'ExerciseDetail' : 'ExerciseLibrary'}>
    <Stack.Screen name="ExerciseLibrary" component={ExerciseLibraryScreen} />
    <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug: exercise.id }} />
  </Stack.Navigator></NavigationContainer>);
}
beforeEach(() => {
  jest.clearAllMocks();
  mockStatusListener.mockReturnValue({ remove: jest.fn() });
  list.mockResolvedValue(response({ items: [exercise], nextCursor: null, total: 1 }));
  getDetail.mockResolvedValue(response(exercise));
});
it('keeps search, every facet toggle, detail navigation and actual equipment reachable', async () => {
  const view = await screen();
  await view.findByRole('button', { name: 'Open Squat' });
  expect(view.getByText('quads · barbell · legs · beginner')).toBeTruthy();
  const search = view.getByLabelText('Search exercises');
  expect(StyleSheet.flatten(search.props.style)).toMatchObject({ minHeight: 44, borderBottomColor: lightTokens.border });
  await fireEvent.changeText(search, ' squat ');
  await fireEvent(search, 'submitEditing');
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'squat' })));
  const facets = {
    category: ['chest', 'back', 'shoulders', 'upper arms', 'upper legs', 'lower legs', 'waist', 'cardio'],
    equipment: ['barbell', 'dumbbell', 'body weight', 'cable', 'kettlebell', 'leverage machine'],
  };
  for (const [param, values] of Object.entries(facets)) {
    for (const value of values) {
      const chip = view.getByRole('button', { name: value });
      await fireEvent.press(chip);
      await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ [param]: value })));
      expect(view.getByRole('button', { name: value }).props.accessibilityState.selected).toBe(true);
      expect(StyleSheet.flatten(view.getByText(value).props.style).color).toBe(lightTokens.textPrimary);
      await fireEvent.press(chip);
      await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ [param]: undefined })));
    }
  }
  await fireEvent.press(view.getByRole('button', { name: 'Open Squat' }));
  await view.findByTestId('exercise-detail-screen');
  expect(getDetail).toHaveBeenCalledWith('squat');
  for (const heading of ['MUSCLES', 'EQUIPMENT', 'HOW TO']) expect(view.getByText(heading)).toBeTruthy();
  expect(view.getByText('Stand tall.')).toBeTruthy();
  expect(view.queryByText(/history|personal record/i)).toBeNull();
});
it('keeps cursor pagination and library retry working', async () => {
  list.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response({ items: [exercise], nextCursor: 'page2', total: 2 }));
  const view = await screen();
  const retry = await view.findByRole('button', { name: 'Retry' });
  expect(StyleSheet.flatten(retry.props.style).minHeight).toBe(44);
  await fireEvent.press(retry);
  await view.findByRole('button', { name: 'Open Squat' });
  list.mockResolvedValueOnce(response({ items: [{ ...exercise, id: 'squat2', name: 'Second squat' }], nextCursor: null, total: 2 }));
  await fireEvent(view.getByTestId('exercise-library-list'), 'endReached');
  await view.findByRole('button', { name: 'Open Second squat' });
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'page2' }));
});
it('keeps detail retry and native playback, fullscreen and PiP available', async () => {
  getDetail.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response({ ...exercise, playbackUrl: 'https://stream.mux.com/example.m3u8' }));
  const view = await screen(true);
  await fireEvent.press(await view.findByRole('button', { name: 'Retry' }));
  const player = await view.findByTestId('exercise-detail-player');
  expect(player.props.fullscreenOptions).toEqual({ enable: true });
  expect(player.props.allowsPictureInPicture).toBe(true);
});
it.each([{ instructions: [] }, { instructions: ['Stand tall.'] }])('does not promise missing instructions after a GIF failure: %j', async ({ instructions }) => {
  getDetail.mockResolvedValue(response({ ...exercise, instructions, gifUrl: 'https://example.com/squat.gif' }));
  const view = await screen(true);
  await fireEvent(await view.findByTestId('exercise-detail-animation'), 'error');
  const copy = instructions.length ? 'The demonstration did not load. Follow the instructions below.' : 'The demonstration did not load.';
  expect(view.getByText(copy)).toBeTruthy();
});
it('describes missing media without promising future availability', async () => {
  const view = await screen(true);
  expect(await view.findByText('No demonstration available for this exercise.')).toBeTruthy();
});
it('keeps native video errors truthful and hides absent exercise sections', async () => {
  getDetail.mockResolvedValue(response({ ...exercise, playbackUrl: 'https://stream.mux.com/example.m3u8',
    instructions: [], equipment: [], primaryMuscle: '', secondaryMuscles: [] }));
  const view = await screen(true);
  await view.findByTestId('exercise-detail-player');
  const listener = mockStatusListener.mock.calls.at(-1)?.[1];
  await act(async () => listener({ status: 'error' }));
  expect(view.getByText('The demonstration did not load.')).toBeTruthy();
  for (const heading of ['MUSCLES', 'EQUIPMENT', 'HOW TO']) expect(view.queryByText(heading)).toBeNull();
  expect(view.queryByTestId('exercise-detail-player')).toBeNull();
});
it('keeps the empty library neutral and does not invent results', async () => {
  list.mockResolvedValue(response({ items: [], nextCursor: null, total: 0 }));
  const view = await screen();
  expect(await view.findByText('No exercises match.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Open Squat' })).toBeNull();
});
