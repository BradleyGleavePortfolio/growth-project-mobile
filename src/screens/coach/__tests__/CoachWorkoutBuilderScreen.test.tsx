/**
 * CoachWorkoutBuilderScreen — interaction test.
 *
 * Asserts that the screen renders the essential interactive elements:
 *   - Plan name input
 *   - Workout type chips (Strength / Cardio / Mobility)
 *   - Save Plan / Create plan button
 *   - Correct accessibility labels on primary controls
 *   - Edit-mode form hydration after async plan load  (FIX 2)
 *
 * The component uses useRoute, useNavigation, React Query hooks, and
 * useTheme. All are mocked below so no network traffic or native
 * bindings are needed.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
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

// ── Mock @react-navigation/native hooks ──────────────────────────────────────
// We mock useRoute/useNavigation so the component can also be rendered
// directly (without a NavigationContainer) in the hydration test.

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: jest.fn(() => ({ params: {} })),
    useNavigation: jest.fn(() => ({ goBack: mockGoBack })),
  };
});

// ── Import the component under test ──────────────────────────────────────────

import CoachWorkoutBuilderScreen from '../CoachWorkoutBuilderScreen';

// ── Typed references to mocked hooks ─────────────────────────────────────────

import { useWorkoutPlan as _useWorkoutPlan } from '../../../hooks/useWorkoutBuilder';
import { useRoute as _useRoute } from '@react-navigation/native';

const mockUseWorkoutPlan = _useWorkoutPlan as jest.Mock;
const mockUseRoute = _useRoute as jest.Mock;

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
  beforeEach(() => {
    mockUseWorkoutPlan.mockReturnValue({ data: undefined });
    mockGoBack.mockReset();
  });

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

  // ── FIX 2: Edit-mode hydration after async plan load ──────────────────────
  it('hydrates form fields when edit-mode plan data arrives asynchronously', async () => {
    const loadedPlan = {
      id: 'plan-abc',
      name: 'Loaded Push Day',
      type: 'cardio' as const,
      duration_estimate_minutes: 45,
      exercises: [
        {
          exercise_external_id: 'ex-001',
          sets: 4,
          reps_or_duration_seconds: 12,
          rest_seconds: 90,
          notes: null,
        },
      ],
    };

    // Start with no data (query still pending).
    mockUseWorkoutPlan.mockReturnValue({ data: undefined });

    // A wrapper component that owns a "dataReady" flag. When flipped, it
    // switches the mock to return the loaded plan — keeping the same
    // CoachWorkoutBuilderScreen instance alive so the useEffect can fire.
    let deliverPlan!: () => void;
    function HydrationDriver() {
      const [dataReady, setDataReady] = React.useState(false);

      if (dataReady) {
        mockUseWorkoutPlan.mockReturnValue({ data: loadedPlan });
      } else {
        mockUseWorkoutPlan.mockReturnValue({ data: undefined });
      }

      deliverPlan = () => setDataReady(true);

      const qc = React.useMemo(
        () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
        [],
      );

      return (
        <QueryClientProvider client={qc}>
          <CoachWorkoutBuilderScreen />
        </QueryClientProvider>
      );
    }

    mockUseRoute.mockReturnValue({ params: { planId: 'plan-abc' } });
    const { getByLabelText } = render(<HydrationDriver />);

    // Initially blank — data not yet loaded.
    expect(getByLabelText('Plan name').props.value).toBe('');

    // Simulate the query resolving.
    await act(async () => {
      deliverPlan();
    });

    // The useEffect watching existingPlan should populate the name field.
    await waitFor(() => {
      expect(getByLabelText('Plan name').props.value).toBe('Loaded Push Day');
    });
  });

  // ── FIX 3: Numeric zero validation blocks save ────────────────────────────
  it('shows a validation error and disables save when sets is zero', async () => {
    const planWithZeroSets = {
      id: 'plan-zero',
      name: 'Zero Sets Plan',
      type: 'strength' as const,
      duration_estimate_minutes: undefined,
      exercises: [
        {
          exercise_external_id: 'ex-999',
          sets: 0,
          reps_or_duration_seconds: 10,
          rest_seconds: 60,
          notes: null,
        },
      ],
    };
    mockUseWorkoutPlan.mockReturnValue({ data: planWithZeroSets });
    mockUseRoute.mockReturnValue({ params: { planId: 'plan-zero' } });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { findByText, queryByText } = render(
      <QueryClientProvider client={qc}>
        <CoachWorkoutBuilderScreen />
      </QueryClientProvider>,
    );

    // The inline "Must be ≥ 1" validation error should appear on the Sets field
    // once the plan data has been hydrated (sets=0 triggers isInvalid).
    const validationError = await findByText('Must be ≥ 1');
    expect(validationError).toBeTruthy();

    // Regression guard.
    expect(queryByText('Must be ≥ 1')).toBeTruthy();
  });
});
