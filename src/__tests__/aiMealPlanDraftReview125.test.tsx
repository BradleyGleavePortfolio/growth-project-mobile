/**
 * AUDIT-08-125 — AI meal plan review shows what the client will get.
 *
 * GET /coach/ai/drafts/:id returns the stored AIDraft row: `id` (no
 * `draftId`) and the backend payload shape from meal-plan.prompt.ts
 * (meal `slot`, item `serving`, day `daily_totals`, plan `coach_notes`).
 * The approve step copies exactly those fields into the client's plan.
 *
 * Fails on main: the slot, serving, day totals and notes render empty, and
 * Save / Approve post to /coach/ai/drafts/undefined/... .
 */

import React from 'react';
import { Alert } from 'react-native';
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
    useTheme: () => ({ colors }),
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
import AIMealPlanDraftScreen from '../screens/coach/AIMealPlanDraftScreen';
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

// The row exactly as the backend returns it (Prisma AIDraft): `id`, no `draftId`.
const mealRow = {
  id: 'd1',
  coachId: 'coach1',
  clientId: 'c1',
  type: 'MEAL_PLAN',
  status: 'DRAFT',
  modelUsed: 'claude-opus',
  tokensIn: 100,
  tokensOut: 200,
  costCents: 5,
  generatedPayload: {
    summary: 'High-protein week.',
    coach_notes: 'Swap rice for potatoes on rest days.',
    days: [
      {
        day: 1,
        meals: [
          {
            slot: 'breakfast',
            items: [
              { name: 'Greek yogurt', serving: '1 cup', calories: 200, protein_g: 20, carbs_g: 10, fat_g: 5 },
              { name: 'Oats', serving: '40 g', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
            ],
          },
        ],
        daily_totals: { calories: 350, protein_g: 25, carbs_g: 37, fat_g: 8 },
      },
    ],
  },
};

const Stack = createNativeStackNavigator();

async function renderScreen(
  name: 'AIMealPlanDraft' | 'AIWorkoutDraft',
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
        <Stack.Screen name="ClientDetail" component={() => null} />
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

describe('AIMealPlanDraftScreen (AUDIT-08-125)', () => {
  it('shows the meal, serving, day totals and client notes the backend sends', async () => {
    mockedGet.mockResolvedValueOnce(ok(mealRow));
    const { findByTestId, getByTestId } = await renderScreen(
      'AIMealPlanDraft',
      AIMealPlanDraftScreen,
    );

    expect((await findByTestId('mealplan-slot-0-0')).props.value).toBe('breakfast');
    expect(getByTestId('mealplan-serving-0-0-0').props.value).toBe('1 cup');
    expect(getByTestId('mealplan-coach-notes').props.value).toBe(
      'Swap rice for potatoes on rest days.',
    );
    const totals = getByTestId('mealplan-day-totals-0');
    expect([totals.props.children].flat().join('')).toBe('350 kcal · P 25g');
  });

  it('saves edits to the fields the client sees and approves the loaded draft id', async () => {
    mockedGet.mockResolvedValueOnce(ok(mealRow));
    mockedPost.mockResolvedValue(ok(mealRow));
    const { findByTestId, getByTestId, getByLabelText } = await renderScreen(
      'AIMealPlanDraft',
      AIMealPlanDraftScreen,
    );

    const serving = await findByTestId('mealplan-serving-0-0-0');
    await act(async () => {
      await fireEvent.changeText(serving, '150 g');
      await fireEvent.changeText(getByTestId('mealplan-kcal-0-0-0'), '100');
      await fireEvent.changeText(getByTestId('mealplan-coach-notes'), 'Eat the oats first.');
    });

    // Day totals follow the edited items.
    const totals = getByTestId('mealplan-day-totals-0');
    expect([totals.props.children].flat().join('')).toBe('250 kcal · P 25g');

    await act(async () => {
      await fireEvent.press(getByLabelText('Save edits'));
    });
    expect(mockedPost).toHaveBeenCalledWith('/coach/ai/drafts/d1/edit', {
      patch: expect.objectContaining({
        coach_notes: 'Eat the oats first.',
        days: [
          expect.objectContaining({
            daily_totals: expect.objectContaining({ calories: 250, protein_g: 25 }),
            meals: [
              expect.objectContaining({
                slot: 'breakfast',
                items: expect.arrayContaining([
                  expect.objectContaining({ name: 'Greek yogurt', serving: '150 g', calories: 100 }),
                ]),
              }),
            ],
          }),
        ],
      }),
    });

    await act(async () => {
      await fireEvent.press(getByLabelText('Approve and assign'));
    });
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/coach/ai/drafts/d1/approve'),
    );
    expect(mockedPost).not.toHaveBeenCalledWith(
      expect.stringContaining('undefined'),
      expect.anything(),
    );
  });
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
    const approve = await findByLabelText('Approve and assign');
    await act(async () => {
      await fireEvent.press(approve);
    });
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/coach/ai/drafts/d1/approve'),
    );
  });
});
