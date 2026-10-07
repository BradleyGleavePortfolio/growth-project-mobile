/**
 * Exercise catalog v1 — mobile contract tests.
 *
 * Covers:
 *   1. exerciseCatalogApi client: list() and getByIdOrSlug() hit the
 *      expected paths and serialise query params correctly.
 *   2. ExerciseLibraryScreen: renders the title, search bar, filter
 *      chip rows, and at least one row from the mocked list response.
 *   3. ExerciseDetailScreen:
 *        a. shows a neutral no-demonstration caption when
 *           `playbackUrl` is null,
 *        b. mounts the VideoView (via its testID) when `playbackUrl`
 *           is a Mux HLS URL.
 *
 * Network and the heavyweight modules (VideoView, vector-icons, theme)
 * are mocked locally so the tests stay deterministic.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AxiosResponse } from 'axios';

// @expo/vector-icons depends on expo-font in tests — stub it.
jest.mock('@expo/vector-icons', () => {
  function Icon(_props: { name?: string; size?: number; color?: string }) {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});

// SkeletonScreen pulls in react-native-reanimated which requires native
// initialisation. Replace with a lightweight testID-bearing View stub.
jest.mock('../ui/skeletons/Skeleton', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  return {
    __esModule: true,
    SkeletonScreen: (props: { testID?: string }) =>
      ReactLib.createElement(View, { testID: props.testID ?? 'skeleton-screen' }),
  };
});

// expo-video pulls in native bindings; replace with a minimal RN stub.
jest.mock('expo-video', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  const player = {
    loop: false,
    addListener: jest.fn((_event: string, listener: (event: { status: string }) => void) => {
      mockVideoStatusListener = listener;
      return { remove: jest.fn() };
    }),
  };
  return {
    __esModule: true,
    useVideoPlayer: () => player,
    VideoView: (props: { testID?: string }) =>
      ReactLib.createElement(View, { testID: props.testID ?? 'video-view' }),
  };
});

// ThemeProvider depends on react-query/AsyncStorage init at module load.
// Stub the hook so the screens get a deterministic semantic palette.
jest.mock('../theme/ThemeProvider', () => {
  const semanticColors = {
    bgPrimary: '#fff',
    bgSurface: '#eee',
    textPrimary: '#000',
    textMuted: '#555',
    accent: '#4A0404',
    border: '#ccc',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Pass = ({ children }: { children: any }) => children;
  return {
    __esModule: true,
    ThemeProvider: Pass,
    default: Pass,
    useTheme: () => ({ semanticColors, colors: semanticColors }),
  };
});

// Replace the shared axios instance with mockable get/post stubs.
jest.mock('../services/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  return {
    __esModule: true,
    default: { get, post, defaults: { baseURL: 'http://test.local/api' } },
    get,
    post,
  };
});

import api from '../services/api';
import { exerciseCatalogApi } from '../api/exerciseCatalog';
import ExerciseLibraryScreen from '../screens/client/ExerciseLibraryScreen';
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import type {
  Exercise,
  ExerciseDetail,
  ExerciseListResponse,
} from '../types/exerciseCatalog';

const mockedGet = api.get as jest.Mock;
let mockVideoStatusListener: (event: { status: string }) => void;

function ok<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: {} as any,
  };
}

const SAMPLE_EX: Exercise = {
  id: 'ex-1',
  slug: 'barbell-bench-press',
  name: 'Barbell Bench Press',
  category: 'strength',
  primaryMuscle: 'chest',
  secondaryMuscles: ['triceps', 'shoulders'],
  equipment: ['barbell', 'bench'],
  difficulty: 'intermediate',
  instructions: ['Lie on the bench.', 'Lower the bar to mid-chest.'],
  muxPlaybackId: null,
};

const SAMPLE_LIST: ExerciseListResponse = {
  items: [SAMPLE_EX],
  nextCursor: null,
  total: 1,
};

beforeEach(() => {
  mockedGet.mockReset();
});

describe('exerciseCatalogApi', () => {
  test('resolves a seed workout id through the existing exercise route on catalog 404', async () => {
    mockedGet.mockRejectedValueOnce({ response: { status: 404 } });
    mockedGet.mockResolvedValueOnce(ok({
      id: 'seed:push-001', name: 'Barbell Bench Press', bodyPart: 'chest',
      target: 'pectorals', equipment: 'barbell', secondaryMuscles: ['triceps'],
      instructions: ['Lower under control.'], gifUrl: '', video_url: null,
    }));
    const response = await exerciseCatalogApi.getDetail('seed:push-001');
    expect(mockedGet).toHaveBeenLastCalledWith('/exercises/seed%3Apush-001');
    expect(response.data).toMatchObject({
      name: 'Barbell Bench Press', equipment: ['barbell'],
      instructions: ['Lower under control.'], playbackUrl: null,
    });
  });

  test('never falls back around a catalog access denial', async () => {
    mockedGet.mockRejectedValueOnce({ response: { status: 403 } });
    await expect(exerciseCatalogApi.getDetail('private-1')).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
  test('list() builds the query string with every supplied filter', async () => {
    mockedGet.mockResolvedValueOnce(ok(SAMPLE_LIST));
    await exerciseCatalogApi.list({
      q: 'bench press',
      category: 'strength',
      primaryMuscle: 'chest',
      equipment: 'barbell',
      limit: 20,
      cursor: 'abc123',
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
    const url = mockedGet.mock.calls[0][0] as string;
    expect(url.startsWith('/exercise-catalog?')).toBe(true);
    expect(url).toContain('q=bench%20press');
    expect(url).toContain('category=strength');
    expect(url).toContain('primaryMuscle=chest');
    expect(url).toContain('equipment=barbell');
    expect(url).toContain('limit=20');
    expect(url).toContain('cursor=abc123');
  });

  test('list() with no params hits the bare path', async () => {
    mockedGet.mockResolvedValueOnce(ok(SAMPLE_LIST));
    await exerciseCatalogApi.list();
    expect(mockedGet).toHaveBeenCalledWith('/exercise-catalog');
  });

  test('getByIdOrSlug() URL-encodes the path segment', async () => {
    const detail: ExerciseDetail = { ...SAMPLE_EX, playbackUrl: null };
    mockedGet.mockResolvedValueOnce(ok(detail));
    await exerciseCatalogApi.getByIdOrSlug('barbell bench-press');
    expect(mockedGet).toHaveBeenCalledWith(
      '/exercise-catalog/barbell%20bench-press',
    );
  });
});

// ── Screen rendering ─────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderInNav(Screen: any, params?: unknown) {
  return await render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Test"
          component={Screen}
          initialParams={params as object | undefined}
        />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

// The client library lists GET /exercises/search (the ExerciseDB proxy the
// coach builder uses); the /exercise-catalog table is empty in production.
const LIBRARY_LIST = {
  items: [{
    id: '0025', name: 'barbell bench press', bodyPart: 'chest', target: 'pectorals',
    equipment: 'barbell', secondaryMuscles: ['triceps'], instructions: ['Lie on the bench.'],
    gifUrl: '',
  }],
  nextCursor: null,
  total: 1,
};

describe('ExerciseLibraryScreen', () => {
  test('lists real exercises from the /exercises source, not the empty catalog', async () => {
    mockedGet.mockResolvedValue(ok(LIBRARY_LIST));
    const { findByText, getByText } = await renderInNav(ExerciseLibraryScreen);
    expect(getByText('Exercise library')).toBeTruthy();
    expect(getByText('Body part')).toBeTruthy();
    expect(getByText('Equipment')).toBeTruthy();
    await findByText('Barbell bench press');
    expect(getByText('pectorals · barbell · chest')).toBeTruthy();
    expect(mockedGet.mock.calls[0][0]).toBe('/exercises/search');
    expect(mockedGet.mock.calls.some(([url]) => String(url).startsWith('/exercise-catalog'))).toBe(false);
  });

  test('search and both filter rows reach the live source; both chips apply together', async () => {
    mockedGet.mockResolvedValue(ok(LIBRARY_LIST));
    const screen = await renderInNav(ExerciseLibraryScreen);
    await screen.findByText('Barbell bench press');
    await fireEvent.press(screen.getByText('chest'));
    await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith('/exercises/search?muscleGroup=chest&limit=100'));
    await screen.findByText('Barbell bench press');
    await fireEvent.press(screen.getByText('dumbbell'));
    await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith('/exercises/search?muscleGroup=chest&equipment=dumbbell&limit=100'));
    // The server ignores equipment beside a body part; the barbell row is filtered out here.
    expect(await screen.findByText('No exercises match.')).toBeTruthy();
    await fireEvent.press(screen.getByText('chest'));
    await fireEvent.press(screen.getByText('dumbbell'));
    const search = screen.getByLabelText('Search exercises');
    await fireEvent.changeText(search, 'bench');
    await fireEvent(search, 'submitEditing');
    await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith('/exercises/search?q=bench&limit=100'));
  });

  test('shows a specific retry when the library cannot load', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(ok(LIBRARY_LIST));
    const screen = await renderInNav(ExerciseLibraryScreen);
    await screen.findByText('Exercises did not load. Check your connection and try again.');
    await fireEvent.press(screen.getByText('Retry'));
    expect(await screen.findByText('Barbell bench press')).toBeTruthy();
  });

  test('opens a listed ExerciseDB exercise through the detail fallback', async () => {
    mockedGet.mockResolvedValueOnce(ok(LIBRARY_LIST))
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce(ok(LIBRARY_LIST.items[0]));
    const screen = await render(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="ExerciseLibrary" component={ExerciseLibraryScreen} />
          <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Open Barbell bench press' }));
    await screen.findByText('Lie on the bench.');
    expect(mockedGet).toHaveBeenCalledWith('/exercise-catalog/0025');
    expect(mockedGet).toHaveBeenLastCalledWith('/exercises/0025');
  });
});

describe('ExerciseDetailScreen', () => {
  test('keeps instructions visible when a real video fails to load', async () => {
    mockedGet.mockResolvedValueOnce(ok({
      ...SAMPLE_EX, playbackUrl: 'https://stream.mux.com/missing.m3u8',
    }));
    const screen = await renderInNav(ExerciseDetailScreen, { idOrSlug: 'ex-1' });
    await screen.findByTestId('exercise-detail-player');
    await act(async () => mockVideoStatusListener({ status: 'error' }));
    expect(screen.queryByTestId('exercise-detail-player')).toBeNull();
    expect(screen.getByText('The demonstration did not load. Follow the instructions below.')).toBeTruthy();
    expect(screen.getByText('Lie on the bench.')).toBeTruthy();
  });
  test('shows a neutral no-demonstration caption when playbackUrl is null', async () => {
    const detail: ExerciseDetail = { ...SAMPLE_EX, playbackUrl: null };
    mockedGet.mockResolvedValueOnce(ok(detail));
    const { findByText, queryByTestId } = await renderInNav(
      ExerciseDetailScreen,
      { idOrSlug: 'ex-1' },
    );
    await findByText('Barbell Bench Press');
    expect(await findByText('No demonstration available for this exercise.')).toBeTruthy();
    expect(queryByTestId('exercise-detail-no-video')).not.toBeNull();
    expect(queryByTestId('exercise-detail-player')).toBeNull();
  });

  test('renders the VideoView when playbackUrl is a Mux URL', async () => {
    const detail: ExerciseDetail = {
      ...SAMPLE_EX,
      muxPlaybackId: 'abc123',
      playbackUrl: 'https://stream.mux.com/abc123.m3u8?token=jwt',
    };
    mockedGet.mockResolvedValueOnce(ok(detail));
    const { findByTestId, queryByTestId } = await renderInNav(
      ExerciseDetailScreen,
      { idOrSlug: 'ex-1' },
    );
    await findByTestId('exercise-detail-player');
    expect(queryByTestId('exercise-detail-no-video')).toBeNull();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
  });
});
