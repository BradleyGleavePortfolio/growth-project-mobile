/**
 * AUDIT-08-125 — AI workout draft approve uses the route draft id.
 *
 * GET /coach/ai/drafts/:id returns the stored AIDraft row: `id` (no
 * `draftId`), so Approve must post to /coach/ai/drafts/<route id>/approve,
 * never /coach/ai/drafts/undefined/... .
 */

import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AxiosResponse } from 'axios';

jest.mock('@expo/vector-icons', () => {
  function Icon(_props: { name?: string; size?: number; color?: string }) {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});

jest.mock('../theme/ThemeProvider', () => {
  const colors = new Proxy(
    {},
    { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') },
  );
  const Pass = ({ children }: { children: React.ReactNode }) => children;
  return {
    __esModule: true,
    ThemeProvider: Pass,
    default: Pass,
    useTheme: () => ({ colors, semanticColors: jest.requireActual('../theme/tokens').lightTokens }),
  };
});

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
import AIWorkoutDraftScreen from '../screens/coach/AIWorkoutDraftScreen';

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

function ok<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as AxiosResponse<T>['config'],
  };
}

const Stack = createNativeStackNavigator();

async function renderScreen(
  name: 'AIWorkoutDraft',
  component: React.ComponentType,
) {
  return await render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name={name}
          component={component}
          initialParams={{ draftId: 'd1', clientId: 'c1', clientName: 'Jane Doe' }}
        />
        <Stack.Screen name="ClientDetail">
          {({ route }) => <Text testID="approved-client-detail">{JSON.stringify(route.params)}</Text>}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AIWorkoutDraftScreen approve (AUDIT-08-125)', () => {
  it('approves the route draft id when the loaded row carries only id', async () => {
    mockedGet.mockResolvedValueOnce(
      ok({
        id: 'd1',
        clientId: 'c1',
        type: 'WORKOUT_PROGRAM',
        status: 'DRAFT',
        modelUsed: 'claude-opus',
        tokensIn: 1,
        tokensOut: 1,
        costCents: 1,
        generatedPayload: { title: 'Block 1', summary: null, weeks: [] },
      }),
    );
    mockedPost.mockResolvedValue(ok({}));
    const { findByLabelText } = await renderScreen('AIWorkoutDraft', AIWorkoutDraftScreen);
    const approve = await findByLabelText('Approve draft');
    await act(async () => {
      await fireEvent.press(approve);
    });
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/coach/ai/drafts/d1/approve'),
    );
  });
});
