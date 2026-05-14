/**
 * Coach AI v1 — mobile contract tests.
 *
 * Covers:
 *   1. coachAiApi client: every method hits the expected path and body.
 *   2. isAiDisabledError: type guard recognises 503 ai_disabled responses.
 *   3. CoachAiSection: hides generate CTAs when /status returns ready=false.
 *   4. CoachAiSection: shows enabled CTAs when ready=true.
 *   5. AIWorkoutDraftScreen: inline edits mutate local state and the save
 *      call ships the patched payload.
 *
 * Network is mocked at the axios-instance level so we can assert the
 * exact URLs the client hits without standing up an HTTP server.
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

// ThemeProvider depends on useFoundingNumber → react-query → AsyncStorage.
// For unit tests we just need a deterministic colour map, so we replace
// the theme module with a stub returning every token the new screens read.
jest.mock('../theme/ThemeProvider', () => {
  const colors = new Proxy(
    {},
    { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Pass = ({ children }: { children: any }) => children;
  return {
    __esModule: true,
    ThemeProvider: Pass,
    default: Pass,
    useTheme: () => ({ colors }),
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
import coachAiApi, { isAiDisabledError } from '../api/coachAi';
import type {
  Draft,
  InsightPayload,
  MealPlanPayload,
  WorkoutPayload,
} from '../types/coachAi';

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

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

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
});

// ─── 1. API client contract ──────────────────────────────────────────────────���

describe('coachAiApi', () => {
  it('status() hits GET /coach/ai/status', async () => {
    mockedGet.mockResolvedValueOnce(ok({ ready: true, modelUsed: 'claude-opus-4-7' }));
    const res = await coachAiApi.status();
    expect(mockedGet).toHaveBeenCalledWith('/coach/ai/status');
    expect(res.data.ready).toBe(true);
  });

  it('generateWorkout() POSTs to /coach/ai/workout-program with the input', async () => {
    mockedPost.mockResolvedValueOnce(
      ok({ draftId: 'd1', type: 'WORKOUT_PROGRAM', clientId: 'c1', generatedPayload: { weeks: [] }, modelUsed: 'claude-opus-4-7', tokensIn: 1, tokensOut: 1, costCents: 1 }),
    );
    await coachAiApi.generateWorkout({
      clientId: 'c1',
      weeks: 4,
      daysPerWeek: 5,
      focus: 'Hypertrophy',
      notes: 'no knee impact',
    });
    expect(mockedPost).toHaveBeenCalledWith('/coach/ai/workout-program', {
      clientId: 'c1',
      weeks: 4,
      daysPerWeek: 5,
      focus: 'Hypertrophy',
      notes: 'no knee impact',
    });
  });

  it('generateMealPlan() POSTs to /coach/ai/meal-plan', async () => {
    mockedPost.mockResolvedValueOnce(ok({ draftId: 'd1' }));
    await coachAiApi.generateMealPlan({ clientId: 'c1', days: 7 });
    expect(mockedPost).toHaveBeenCalledWith('/coach/ai/meal-plan', {
      clientId: 'c1',
      days: 7,
    });
  });

  it('generateInsight() POSTs to /coach/ai/client-insight', async () => {
    mockedPost.mockResolvedValueOnce(ok({ draftId: 'd1' }));
    await coachAiApi.generateInsight({ clientId: 'c1', windowDays: 14 });
    expect(mockedPost).toHaveBeenCalledWith('/coach/ai/client-insight', {
      clientId: 'c1',
      windowDays: 14,
    });
  });

  it('getDraft() URL-encodes the draftId', async () => {
    mockedGet.mockResolvedValueOnce(ok({ draftId: 'd 1' }));
    await coachAiApi.getDraft('d 1');
    expect(mockedGet).toHaveBeenCalledWith('/coach/ai/drafts/d%201');
  });

  it('approveDraft() POSTs to /approve', async () => {
    mockedPost.mockResolvedValueOnce(ok({ approvedAsId: 'wp_1', approvedType: 'WORKOUT_PROGRAM' }));
    await coachAiApi.approveDraft('d1');
    expect(mockedPost).toHaveBeenCalledWith('/coach/ai/drafts/d1/approve');
  });

  it('editDraft() wraps the patch in { patch }', async () => {
    mockedPost.mockResolvedValueOnce(ok({ draftId: 'd1' }));
    await coachAiApi.editDraft<WorkoutPayload>('d1', { title: 'New title', weeks: [] });
    expect(mockedPost).toHaveBeenCalledWith('/coach/ai/drafts/d1/edit', {
      patch: { title: 'New title', weeks: [] },
    });
  });

  it('rejectDraft() sends the reason', async () => {
    mockedPost.mockResolvedValueOnce(ok({ rejected: true }));
    await coachAiApi.rejectDraft('d1', 'too volume-heavy');
    expect(mockedPost).toHaveBeenCalledWith('/coach/ai/drafts/d1/reject', {
      reason: 'too volume-heavy',
    });
  });
});

// ─── 2. isAiDisabledError type guard ─────────────────────────────────────────

describe('isAiDisabledError', () => {
  it('matches 503 ai_disabled responses', () => {
    const err = {
      response: { status: 503, data: { error: 'ai_disabled', action: 'set ANTHROPIC_API_KEY in Fly secrets' } },
    };
    expect(isAiDisabledError(err)).toBe(true);
  });
  it('rejects non-503', () => {
    expect(isAiDisabledError({ response: { status: 500, data: { error: 'ai_disabled' } } })).toBe(false);
  });
  it('rejects wrong body', () => {
    expect(isAiDisabledError({ response: { status: 503, data: { error: 'rate_limited' } } })).toBe(false);
  });
  it('rejects null/undefined', () => {
    expect(isAiDisabledError(null)).toBe(false);
    expect(isAiDisabledError(undefined)).toBe(false);
  });
});

// ─── 3 & 4. CoachAiSection visibility ────────────────────────────────────────

import CoachAiSection from '../components/coach/CoachAiSection';
import { ThemeProvider } from '../theme/ThemeProvider';

function renderWithNav(node: React.ReactNode) {
  return render(
    <ThemeProvider>
      <NavigationContainer>{node}</NavigationContainer>
    </ThemeProvider>,
  );
}

describe('CoachAiSection', () => {
  it('renders disabled CTAs and shows offline caption when status returns ready=false', async () => {
    mockedGet.mockResolvedValueOnce(ok({ ready: false, reason: 'no_api_key' }));
    const { findByTestId, getByText } = renderWithNav(
      <CoachAiSection clientId="c1" clientName="Jane Doe" />,
    );
    await waitFor(() => getByText('AI offline — owner action required'));
    const cta = await findByTestId('coach-ai-cta-workout');
    expect(cta.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it('renders enabled CTAs when status returns ready=true', async () => {
    mockedGet.mockResolvedValueOnce(ok({ ready: true, modelUsed: 'claude-opus-4-7' }));
    const { findByTestId } = renderWithNav(
      <CoachAiSection clientId="c1" clientName="Jane Doe" />,
    );
    const cta = await findByTestId('coach-ai-cta-meal');
    expect(cta.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
  });
});

// ─── 5. AIWorkoutDraftScreen — edit/save flow ────────────────────────────────

import AIWorkoutDraftScreen from '../screens/coach/AIWorkoutDraftScreen';

const Stack = createNativeStackNavigator();

function renderWorkoutScreen() {
  return render(
    <ThemeProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="AIWorkoutDraft"
            component={AIWorkoutDraftScreen}
            initialParams={{ draftId: 'd1', clientId: 'c1', clientName: 'Jane Doe' }}
          />
          <Stack.Screen name="ClientDetail" component={() => null} />
        </Stack.Navigator>
      </NavigationContainer>
    </ThemeProvider>,
  );
}

describe('AIWorkoutDraftScreen', () => {
  it('inline edit updates local state and Save ships a patched payload', async () => {
    const draft: Draft<WorkoutPayload> = {
      draftId: 'd1',
      type: 'WORKOUT_PROGRAM',
      clientId: 'c1',
      generatedPayload: {
        title: 'Hypertrophy phase 1',
        summary: null,
        weeks: [
          {
            week: 1,
            notes: null,
            days: [
              {
                day: 1,
                focus: 'Upper',
                exercises: [
                  { name: 'Bench press', sets: 3, reps: '8-10', rir: 2, rpe: null, notes: null },
                ],
              },
            ],
          },
        ],
      },
      modelUsed: 'claude-opus-4-7',
      tokensIn: 100,
      tokensOut: 200,
      costCents: 50,
    };
    mockedGet.mockResolvedValueOnce(ok(draft));
    mockedPost.mockResolvedValueOnce(ok({ ...draft }));

    const { findByTestId, getByText, getByLabelText } = renderWorkoutScreen();

    // Wait for the draft to load.
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/coach/ai/drafts/d1'));

    // Mutate the sets field for the first exercise.
    const setsInput = await findByTestId('workout-sets-0-0-0');
    await act(async () => {
      fireEvent.changeText(setsInput, '5');
    });

    // Save button enables after a dirty edit.
    const save = getByLabelText('Save edits');
    await act(async () => {
      fireEvent.press(save);
    });

    expect(mockedPost).toHaveBeenCalledWith(
      '/coach/ai/drafts/d1/edit',
      expect.objectContaining({
        patch: expect.objectContaining({
          weeks: expect.arrayContaining([
            expect.objectContaining({
              days: expect.arrayContaining([
                expect.objectContaining({
                  exercises: expect.arrayContaining([
                    expect.objectContaining({ sets: 5 }),
                  ]),
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
    // Suppress unused-var warnings for the type imports above.
    void ({} as InsightPayload | MealPlanPayload);
    void getByText;
  });
});
