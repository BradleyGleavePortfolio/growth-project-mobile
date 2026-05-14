/**
 * Exercise catalog v1 — mobile contract tests.
 *
 * Covers:
 *   1. exerciseCatalogApi client: list() and getByIdOrSlug() hit the
 *      expected paths and serialise query params correctly.
 *   2. ExerciseLibraryScreen: renders the title, search bar, filter
 *      chip rows, and at least one row from the mocked list response.
 *   3. ExerciseDetailScreen:
 *        a. shows the "Video not yet available" caption when
 *           `playbackUrl` is null,
 *        b. mounts the VideoView (via its testID) when `playbackUrl`
 *           is a Mux HLS URL.
 *
 * Network and the heavyweight modules (VideoView, vector-icons, theme)
 * are mocked locally so the tests stay deterministic.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
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

// expo-video pulls in native bindings; replace with a minimal RN stub.
jest.mock('expo-video', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  return {
    __esModule: true,
    useVideoPlayer: () => ({ loop: false }),
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
function renderInNav(Screen: any, params?: unknown) {
  return render(
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

describe('ExerciseLibraryScreen', () => {
  test('renders title, chip filter labels, and a row from the list', async () => {
    mockedGet.mockResolvedValue(ok(SAMPLE_LIST));
    const { findByText, getByText } = renderInNav(ExerciseLibraryScreen);
    // Title + chip headers exist from the first paint.
    expect(getByText('Exercise Library')).toBeTruthy();
    expect(getByText('Category')).toBeTruthy();
    expect(getByText('Muscle')).toBeTruthy();
    expect(getByText('Equipment')).toBeTruthy();
    // A list row from the mocked response.
    await findByText('Barbell Bench Press');
  });
});

describe('ExerciseDetailScreen', () => {
  test('shows the "video not yet available" caption when playbackUrl is null', async () => {
    const detail: ExerciseDetail = { ...SAMPLE_EX, playbackUrl: null };
    mockedGet.mockResolvedValueOnce(ok(detail));
    const { findByText, queryByTestId } = renderInNav(
      ExerciseDetailScreen,
      { idOrSlug: 'ex-1' },
    );
    await findByText('Barbell Bench Press');
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
    const { findByTestId, queryByTestId } = renderInNav(
      ExerciseDetailScreen,
      { idOrSlug: 'ex-1' },
    );
    await findByTestId('exercise-detail-player');
    expect(queryByTestId('exercise-detail-no-video')).toBeNull();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
  });
});
