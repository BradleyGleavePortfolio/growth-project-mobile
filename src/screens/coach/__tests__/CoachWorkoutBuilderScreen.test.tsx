/**
 * CoachWorkoutBuilderScreen — interaction test.
 *
 * Asserts that the screen renders the essential interactive elements:
 *   - Plan name input
 *   - Workout type chips (Strength / Cardio / Mobility)
 *   - Save Plan / Create plan button
 *   - Correct accessibility labels on primary controls
 *
 * The component uses useRoute, useNavigation, React Query hooks, and
 * useTheme. All are mocked below so no network traffic or native
 * bindings are needed.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock vector icons ─────────────────────────────────────────────────────────

jest.mock('@expo/vector-icons', () => {
  function Icon(_props: { name?: string; size?: number; color?: string }) {
    return null;
  }
  return { Ionicons: Icon };
});

// ── Mock ThemeProvider ────────────────────────────────────────────────────────

jest.mock('../../../theme/ThemeProvider', () => {
  const semanticColors = {
    bgPrimary: '#F5EFE4',
    bgSurface: '#F1E8D5',
    textPrimary: '#1A1A18',
    textMuted: '#B1A89F',
    accent: '#2C4A36',
    border: '#B1A89F',
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

// ── Mock React Query workout-builder hooks ────────────────────────────────────

jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useWorkoutPlan: jest.fn().mockReturnValue({ data: undefined }),
  useCreateWorkoutPlan: jest.fn().mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Push Day' }),
    isPending: false,
  }),
  useUpdateWorkoutPlan: jest.fn().mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useSetWorkoutExercises: jest.fn().mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue([]),
    isPending: false,
  }),
}));

jest.mock('../../../hooks/useExerciseLibrary', () => ({
  useExerciseSearch: jest.fn().mockReturnValue({
    data: {
      items: [
        {
          id: '0001',
          name: 'barbell bench press',
          bodyPart: 'chest',
          equipment: 'barbell',
          target: 'pectorals',
          secondaryMuscles: [],
          instructions: [],
          gifUrl: '',
        },
      ],
      nextCursor: null,
      total: 1,
    },
  }),
}));

// ── Import the component under test ──────────────────────────────────────────

import CoachWorkoutBuilderScreen from '../CoachWorkoutBuilderScreen';

// ── Test helpers ──────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator();

function renderInNav(params?: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="CoachWorkoutBuilder"
            component={CoachWorkoutBuilderScreen}
            initialParams={params}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('CoachWorkoutBuilderScreen', () => {
  it('renders the plan name input and Create plan button', () => {
    const { getByLabelText, getByText } = renderInNav();

    // The plan name text input should be accessible
    const nameInput = getByLabelText('Plan name');
    expect(nameInput).toBeTruthy();

    // The save button should be labelled "Create plan" when no planId param
    const saveButton = getByText('Create plan');
    expect(saveButton).toBeTruthy();
  });

  it('renders all three workout type chips', () => {
    const { getByText } = renderInNav();

    expect(getByText('strength')).toBeTruthy();
    expect(getByText('cardio')).toBeTruthy();
    expect(getByText('mobility')).toBeTruthy();
  });

  it('renders the exercise search input', () => {
    const { getByLabelText } = renderInNav();

    const searchInput = getByLabelText('Search exercise catalog');
    expect(searchInput).toBeTruthy();
  });

  it('has correct accessibility labels on primary interactive elements', () => {
    const { getByLabelText } = renderInNav();

    expect(getByLabelText('Plan name')).toBeTruthy();
    expect(getByLabelText('Search exercise catalog')).toBeTruthy();
    expect(getByLabelText('Create plan')).toBeTruthy();
  });
});
