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
    // Reset hook mocks to their default-shape between tests so per-test
    // mock customizations (e.g. swapping mutateAsync) don't bleed across
    // tests. The mocks defined at the module top level set the canonical
    // "happy-path" defaults; we re-apply them here for safety.
    mockUseWorkoutPlan.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });
    const hook = jest.requireMock('../../../hooks/useWorkoutBuilder');
    hook.useCreateWorkoutPlan.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Push Day' }),
      isPending: false,
    });
    hook.useUpdateWorkoutPlan.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue({}),
      isPending: false,
    });
    hook.useSetWorkoutExercises.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue([]),
      isPending: false,
    });
    mockUseRoute.mockReturnValue({ params: {} });
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
    const { findByText, queryByText, getByLabelText } = render(
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

    // Save button must be disabled while validation fails (Finding 3 ask).
    const saveBtn = getByLabelText('Save changes');
    expect(saveBtn.props.accessibilityState?.disabled).toBe(true);
  });

  // ── Boundary coverage for numeric validation — Finding 3 ask ───────────────
  it('blocks save when reps_or_duration_seconds is zero', async () => {
    const plan = {
      id: 'plan-zero-reps',
      name: 'Zero Reps Plan',
      type: 'strength' as const,
      duration_estimate_minutes: undefined,
      exercises: [
        {
          exercise_external_id: 'ex-1',
          sets: 3,
          reps_or_duration_seconds: 0,
          rest_seconds: 60,
          notes: null,
        },
      ],
    };
    mockUseWorkoutPlan.mockReturnValue({ data: plan });
    mockUseRoute.mockReturnValue({ params: { planId: 'plan-zero-reps' } });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { findAllByText, getByLabelText } = render(
      <QueryClientProvider client={qc}>
        <CoachWorkoutBuilderScreen />
      </QueryClientProvider>,
    );
    const errors = await findAllByText('Must be ≥ 1');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const saveBtn = getByLabelText('Save changes');
    expect(saveBtn.props.accessibilityState?.disabled).toBe(true);
  });

  it('blocks save when sets is negative (−1) and mutations never fire', async () => {
    const updateMutateAsync = jest.fn();
    const setExercisesMutateAsync = jest.fn();
    const hook = jest.requireMock('../../../hooks/useWorkoutBuilder');
    hook.useUpdateWorkoutPlan.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
    hook.useSetWorkoutExercises.mockReturnValue({
      mutateAsync: setExercisesMutateAsync,
      isPending: false,
    });

    const plan = {
      id: 'plan-neg',
      name: 'Negative Sets Plan',
      type: 'strength' as const,
      duration_estimate_minutes: undefined,
      exercises: [
        {
          exercise_external_id: 'ex-neg',
          sets: -1,
          reps_or_duration_seconds: 10,
          rest_seconds: 60,
          notes: null,
        },
      ],
    };
    mockUseWorkoutPlan.mockReturnValue({ data: plan });
    mockUseRoute.mockReturnValue({ params: { planId: 'plan-neg' } });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { findByText, getByLabelText } = render(
      <QueryClientProvider client={qc}>
        <CoachWorkoutBuilderScreen />
      </QueryClientProvider>,
    );

    expect(await findByText('Must be ≥ 1')).toBeTruthy();
    const saveBtn = getByLabelText('Save changes');
    expect(saveBtn.props.accessibilityState?.disabled).toBe(true);
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(setExercisesMutateAsync).not.toHaveBeenCalled();
  });

  it('allows save when all numeric values are valid positive integers', async () => {
    const updateMutateAsync = jest.fn().mockResolvedValue({});
    const setExercisesMutateAsync = jest.fn().mockResolvedValue([]);
    const hook = jest.requireMock('../../../hooks/useWorkoutBuilder');
    hook.useUpdateWorkoutPlan.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
    hook.useSetWorkoutExercises.mockReturnValue({
      mutateAsync: setExercisesMutateAsync,
      isPending: false,
    });

    const plan = {
      id: 'plan-valid',
      name: 'Valid Plan',
      type: 'strength' as const,
      duration_estimate_minutes: 45,
      exercises: [
        {
          exercise_external_id: 'ex-valid',
          sets: 3,
          reps_or_duration_seconds: 10,
          rest_seconds: 60,
          notes: null,
          order: 1,
        },
      ],
    };
    mockUseWorkoutPlan.mockReturnValue({ data: plan });
    mockUseRoute.mockReturnValue({ params: { planId: 'plan-valid' } });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByLabelText, queryByText } = render(
      <QueryClientProvider client={qc}>
        <CoachWorkoutBuilderScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(queryByText('Must be ≥ 1')).toBeNull();
    });

    const saveBtn = getByLabelText('Save changes');
    expect(saveBtn.props.accessibilityState?.disabled).toBeFalsy();
  });

  // ── Finding 1 — HIGH severity data-loss bug guard ─────────────────────
  it('blocks save in edit mode while the plan is still loading (no data wipe)', async () => {
    const updateMutateAsync = jest.fn();
    const setExercisesMutateAsync = jest.fn();
    const hook = jest.requireMock('../../../hooks/useWorkoutBuilder');
    hook.useUpdateWorkoutPlan.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
    hook.useSetWorkoutExercises.mockReturnValue({
      mutateAsync: setExercisesMutateAsync,
      isPending: false,
    });

    mockUseWorkoutPlan.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });
    mockUseRoute.mockReturnValue({ params: { planId: 'plan-loading' } });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByLabelText, getAllByText } = render(
      <QueryClientProvider client={qc}>
        <CoachWorkoutBuilderScreen />
      </QueryClientProvider>,
    );

    // Loading copy appears in BOTH the banner and the save button label — both
    // are part of the same hydration UX. We assert at least one is visible.
    expect(getAllByText('Loading plan…').length).toBeGreaterThanOrEqual(1);

    // Save button is disabled and labelled to reflect hydration.
    const saveBtn = getByLabelText('Save changes');
    expect(saveBtn.props.accessibilityState?.disabled).toBe(true);

    // Mutations must NOT have fired.
    expect(updateMutateAsync).not.toHaveBeenCalled();
    expect(setExercisesMutateAsync).not.toHaveBeenCalled();
  });

  // ── Finding 2 — hydration sorts exercises by `order` ───────────────────
  it('hydrates exercises by `order` even when API returns them unsorted', async () => {
    const plan = {
      id: 'plan-unsorted',
      name: 'Unsorted Plan',
      type: 'strength' as const,
      duration_estimate_minutes: undefined,
      exercises: [
        {
          exercise_external_id: 'ex-B',
          sets: 3,
          reps_or_duration_seconds: 10,
          rest_seconds: 60,
          notes: null,
          order: 2,
        },
        {
          exercise_external_id: 'ex-A',
          sets: 3,
          reps_or_duration_seconds: 10,
          rest_seconds: 60,
          notes: null,
          order: 1,
        },
        {
          exercise_external_id: 'ex-C',
          sets: 3,
          reps_or_duration_seconds: 10,
          rest_seconds: 60,
          notes: null,
          order: 3,
        },
      ],
    };
    mockUseWorkoutPlan.mockReturnValue({ data: plan });
    mockUseRoute.mockReturnValue({ params: { planId: 'plan-unsorted' } });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { findByText } = render(
      <QueryClientProvider client={qc}>
        <CoachWorkoutBuilderScreen />
      </QueryClientProvider>,
    );

    // Row header text is "{idx + 1}. {display_name}". After sort by `order`,
    // ex-A should render as row 1, ex-B as row 2, ex-C as row 3.
    expect(await findByText('1. ex-A')).toBeTruthy();
    expect(await findByText('2. ex-B')).toBeTruthy();
    expect(await findByText('3. ex-C')).toBeTruthy();
  });
});
