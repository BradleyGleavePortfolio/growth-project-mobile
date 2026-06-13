/**
 * romanP3FlagOffFinishWorkout — RUNTIME flag-off proof for the §2.8 completion
 * one-shot PRODUCER and CONSUMER (R11 D-004, guarding R11 D-001).
 *
 * The prior flag-off suite proved the §2.8 CARD is gated behind
 * `featureFlags.romanChat`, but a static render guard cannot see the hidden
 * side effects D-001 was about: with the flag off the finish-workout path still
 * navigated with a `justCompletedId` param and the WorkoutScreen one-shot still
 * read/wrote the `roman.p3.completion-consumed:*` AsyncStorage latch. A regex
 * over the render guard stays green through that bug.
 *
 * This suite mounts/drives the real code paths with `romanChat=false` and
 * asserts the OBSERVABLE flag-off behaviour:
 *   1. PRODUCER — ActiveWorkoutScreen's finish-workout success path calls
 *      `navigation.goBack()` and never `navigation.navigate('WorkoutMain', {
 *      justCompletedId })`. (Pre-P3 behaviour.)
 *   2. CONSUMER — the exported `useJustCompletedOneShot` hook, driven through a
 *      real focus lifecycle with `enabled=false`, never touches AsyncStorage
 *      with any `roman.p3.completion-consumed:*` key and never clears the param.
 *      A control run with `enabled=true` proves the same harness WOULD exercise
 *      those side effects when Roman is on.
 *   3. CONTAINMENT — WorkoutScreen mounted with the flag off AND a
 *      `justCompletedId` route param renders no Roman P3 testID and performs no
 *      `roman.p3.completion-consumed:*` AsyncStorage access.
 */
import React from 'react';
import { Alert, Text } from 'react-native';
import { render, renderHook, act, waitFor, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Every Roman-relevant flag OFF — the production default posture.
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    coachBrief: true,
    romanChat: false,
    romanCheckInBackendLive: false,
    romanStreakBackendLive: false,
  },
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'c1', email: 'm@x.io', role: 'client', firstName: 'Marcus' }),
}));

// Controllable navigation shared by ActiveWorkoutScreen + WorkoutScreen.
let mockRouteParams: Record<string, unknown> = {};
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSetParams = jest.fn();
// useFocusEffect for the WorkoutScreen mount: run the effect once on mount so
// the one-shot consumer path executes exactly as it would on focus.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  // Require React lazily inside the factory (out-of-scope refs are forbidden).
  const ReactLib = jest.requireActual('react');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setParams: mockSetParams,
      getParent: () => ({ navigate: mockNavigate }),
      addListener: () => () => undefined,
    }),
    useRoute: () => ({ params: mockRouteParams }),
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      // Run the focus effect immediately on mount (mirrors a focused screen).
      ReactLib.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});

// ── ActiveWorkoutScreen dependency mocks ─────────────────────────────────────
// The finish path: local SQLite write loop → createWorkout.mutate(payload,
// { onSuccess }). We capture the per-call onSuccess and invoke it with a server
// id so the navigation branch (the D-001 producer) runs.
let capturedMutateOptions: { onSuccess?: (data: unknown) => void; onError?: (e: unknown) => void } | null = null;
const mockMutate = jest.fn((_vars: unknown, options: typeof capturedMutateOptions) => {
  capturedMutateOptions = options;
});
jest.mock('../../../hooks/useApi', () => ({
  useCreateWorkout: () => ({ mutate: mockMutate, mutateAsync: jest.fn(async () => ({ id: 'w1' })) }),
}));

const mockLoadActiveWorkoutSession = jest.fn();
jest.mock('../../../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: () => mockLoadActiveWorkoutSession(),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));

jest.mock('../../../db/workoutDb', () => ({
  getAllExercises: jest.fn(async () => []),
}));

jest.mock('../../../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: jest.fn(async () => undefined) },
}));

jest.mock('../../../offline', () => ({
  writeWorkoutLog: jest.fn(async () => undefined),
  triggerSync: jest.fn(async () => undefined),
  markSessionSyncedBySessionName: jest.fn(async () => undefined),
}));

// ── WorkoutScreen dependency mocks (landing data sources) ────────────────────
const mockWorkoutGetRoutines = jest.fn();
const mockWorkoutGetAll = jest.fn();
const mockWorkoutGetVolume = jest.fn();
jest.mock('../../../services/api', () => ({
  workoutApi: {
    getRoutines: (...a: unknown[]) => mockWorkoutGetRoutines(...a),
    getAll: (...a: unknown[]) => mockWorkoutGetAll(...a),
    getVolume: (...a: unknown[]) => mockWorkoutGetVolume(...a),
  },
}));

jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
}));

import ActiveWorkoutScreen from '../../../screens/client/ActiveWorkoutScreen';
import {
  useJustCompletedOneShot,
  ROMAN_COMPLETION_CONSUMED_PREFIX,
} from '../../../screens/client/WorkoutScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = {};
  capturedMutateOptions = null;
  mockLoadActiveWorkoutSession.mockResolvedValue(null);
  mockWorkoutGetRoutines.mockResolvedValue({ data: [] });
  mockWorkoutGetAll.mockResolvedValue({ data: [] });
  mockWorkoutGetVolume.mockResolvedValue({ data: [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRODUCER — ActiveWorkoutScreen finish path with romanChat OFF
// ─────────────────────────────────────────────────────────────────────────────
describe('§2.8 producer: ActiveWorkoutScreen finish path is pre-P3 when romanChat is OFF', () => {
  it('navigates with goBack() and never passes justCompletedId on a successful save', async () => {
    // Restore a persisted session that already carries a COMPLETED set so the
    // finish path has something to save; auto-press Resume on the restore
    // prompt, then auto-press Finish on the finish prompt, capturing the
    // create-workout mutate options.
    const startedAtMs = Date.now() - 5 * 60 * 1000;
    mockLoadActiveWorkoutSession.mockResolvedValue({
      isStale: false,
      session: {
        version: 1,
        startedAtMs,
        updatedAtMs: startedAtMs,
        routineName: 'Push Day',
        exercisesJson: JSON.stringify([]),
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
        sessionExercises: [
          {
            exerciseId: 'ex-1',
            exerciseName: 'Bench Press',
            sets: [{ weight: 135, reps: 8, completed: true }],
          },
        ],
      },
    });

    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _body, buttons) => {
        const resume = (buttons ?? []).find((b) => b.text === 'Resume');
        const finish = (buttons ?? []).find((b) => b.text === 'Finish');
        if (resume) resume.onPress?.();
        if (finish) finish.onPress?.();
      });
    mockRouteParams = {
      routineName: 'Push Day',
      exercises: JSON.stringify([
        { exerciseId: 'ex-1', name: 'Bench Press', muscle: 'chest', sets: [{ weight: 135, reps: 8 }] },
      ]),
      assignmentId: null,
    };

    try {
      const { getByText } = render(<ActiveWorkoutScreen />);
      // Wait until the restored session committed (routine header visible).
      await waitFor(() => expect(getByText('Push Day')).toBeTruthy());

      // Trigger the finish flow. Pressing the Finish control calls
      // finishWorkout() -> Alert.alert('Finish Workout?', ...), which our spy
      // resolves by pressing Finish, running the save handler that calls
      // createWorkout.mutate(payload, options). The onPress lives on the
      // HapticPressable wrapping the label, so fire the press event (it bubbles)
      // rather than reading props off the Text node.
      await act(async () => {
        fireEvent.press(getByText('Finish'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // The save handler installed mutate options; run the server-success branch.
      expect(capturedMutateOptions?.onSuccess).toBeTruthy();
      act(() => capturedMutateOptions!.onSuccess!({ id: 'server-123' }));

      // PRE-P3 behaviour: goBack(), and NO navigate to WorkoutMain with the
      // Roman completion signal.
      expect(mockGoBack).toHaveBeenCalledTimes(1);
      const navigatedWithSignal = mockNavigate.mock.calls.some(
        ([target, params]) =>
          target === 'WorkoutMain' &&
          params != null &&
          Object.prototype.hasOwnProperty.call(params, 'justCompletedId'),
      );
      expect(navigatedWithSignal).toBe(false);
    } finally {
      alertSpy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CONSUMER — useJustCompletedOneShot is a true no-op when disabled
// ─────────────────────────────────────────────────────────────────────────────
describe('§2.8 consumer: useJustCompletedOneShot does nothing when enabled=false', () => {
  it('never reads/writes a roman.p3.completion-consumed latch and never clears the param', async () => {
    const getItemSpy = jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(null);
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem').mockResolvedValue(undefined);
    try {
      const clearParam = jest.fn();
      // enabled=false: the flag-off posture. A real completion id + user key are
      // present, so any side effect would be the bug.
      renderHook(() =>
        useJustCompletedOneShot('workout-999', 'user-1', clearParam, false),
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const consumedReads = getItemSpy.mock.calls.filter(([k]) =>
        String(k).startsWith(ROMAN_COMPLETION_CONSUMED_PREFIX),
      );
      const consumedWrites = setItemSpy.mock.calls.filter(([k]) =>
        String(k).startsWith(ROMAN_COMPLETION_CONSUMED_PREFIX),
      );
      expect(consumedReads).toHaveLength(0);
      expect(consumedWrites).toHaveLength(0);
      expect(clearParam).not.toHaveBeenCalled();
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });

  it('CONTROL: the same harness DOES read the latch when enabled=true', async () => {
    const getItemSpy = jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(null);
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem').mockResolvedValue(undefined);
    try {
      const clearParam = jest.fn();
      renderHook(() =>
        useJustCompletedOneShot('workout-control', 'user-1', clearParam, true),
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const consumedReads = getItemSpy.mock.calls.filter(([k]) =>
        String(k).startsWith(ROMAN_COMPLETION_CONSUMED_PREFIX),
      );
      // Proves the no-op test above is meaningful: with the flag on, the same
      // inputs DO exercise the latch read.
      expect(consumedReads.length).toBeGreaterThan(0);
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CONTAINMENT — the WorkoutScreen consumer wiring, mounted as a real
//    component with the flag off + a completion param.
//
// WorkoutScreen itself is chart/animation-heavy and impractical to fully render
// in a unit test (its own §2.8 behaviour suite drives the extracted hook in
// romanP3HostWiring.test.tsx). Here we mount a faithful mini-host that uses the
// REAL exported `useJustCompletedOneShot` with EXACTLY the WorkoutScreen wiring
// — the route param as the id, the acting user key, navigation.setParams as the
// param-clear, and `featureFlags.romanChat` as the enable gate — through a real
// focus lifecycle. With the flag off this must perform no completion-consumed
// AsyncStorage access and never clear the param.
// ─────────────────────────────────────────────────────────────────────────────
function WorkoutCompletionConsumerHost(): React.ReactElement {
  // Mirror WorkoutScreen's wiring 1:1.
  const justCompletedId = (mockRouteParams as { justCompletedId?: string }).justCompletedId;
  const clearParam = React.useCallback(() => {
    mockSetParams({ justCompletedId: undefined });
  }, []);
  const enabled = (jest.requireMock('../../../config/featureFlags') as {
    featureFlags: { romanChat: boolean };
  }).featureFlags.romanChat;
  const justCompleted = useJustCompletedOneShot(justCompletedId, 'user-1', clearParam, enabled);
  // Render the Roman card testID only when the one-shot fires AND the flag is on
  // — the same condition WorkoutScreen uses.
  return enabled && justCompleted ? (
    <Text testID="roman-workout-card">complete</Text>
  ) : (
    <Text testID="workout-main-fallback">main</Text>
  );
}

describe('§2.8 containment: the WorkoutScreen consumer is inert with romanChat OFF', () => {
  it('mounts with a justCompletedId param but performs no completion-consumed AsyncStorage access and shows no Roman testID', async () => {
    const getItemSpy = jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(null);
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem').mockResolvedValue(undefined);
    try {
      // A real completion signal is present in the route param — exactly the
      // input the consumer would act on if the flag were on.
      mockRouteParams = { justCompletedId: 'server-555' };
      const { queryByTestId } = render(<WorkoutCompletionConsumerHost />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const consumedReads = getItemSpy.mock.calls.filter(([k]) =>
        String(k).startsWith(ROMAN_COMPLETION_CONSUMED_PREFIX),
      );
      const consumedWrites = setItemSpy.mock.calls.filter(([k]) =>
        String(k).startsWith(ROMAN_COMPLETION_CONSUMED_PREFIX),
      );
      expect(consumedReads).toHaveLength(0);
      expect(consumedWrites).toHaveLength(0);
      // No Roman P3 card is mounted with the flag off; the plain fallback shows.
      expect(queryByTestId('roman-workout-card')).toBeNull();
      expect(queryByTestId('workout-main-fallback')).toBeTruthy();
      // The param is left untouched (no clear) while disabled.
      expect(mockSetParams).not.toHaveBeenCalled();
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });
});
