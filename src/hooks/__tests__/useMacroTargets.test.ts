/**
 * Regression coverage for the cross-user macros leak (P0-5).
 *
 * Before the fix, `useMacroTargets` used a single global AsyncStorage key
 * (`macro_targets`). When user A's macros landed in cache and user B then
 * signed in on the same device (shared family phone, gym kiosk), the very
 * first frame of B's session painted A's macros — a PII leak on top of a
 * trust bug for a coach-prescribed value.
 *
 * The fix:
 *   - key the cache as `macro_targets:${userId}`
 *   - re-run the effect when the userId changes
 *   - clear `macroTargets` state before the new fetch lands, so no stale
 *     value can leak between users
 *   - remove the legacy global key on read so a future build can't
 *     accidentally revive cross-user data
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUser: { id: string } | null = null;
const mockCurrentForSelf = jest.fn();

jest.mock('../useCurrentUser', () => ({
  useCurrentUser: () => mockUser,
}));

jest.mock('../../api/macrosApi', () => ({
  macrosApi: {
    currentForSelf: (...args: unknown[]) => mockCurrentForSelf(...args),
  },
}));

import { useMacroTargets } from '../useMacroTargets';

const TARGETS_A = {
  calories: 2400,
  protein: 180,
  carbs: 250,
  fat: 80,
};
const TARGETS_B = {
  calories: 1800,
  protein: 140,
  carbs: 180,
  fat: 60,
};

function serverShape(t: typeof TARGETS_A) {
  return {
    id: 'mt',
    client_id: 'x',
    coach_id: 'c',
    calories_kcal: t.calories,
    protein_g: t.protein,
    carbs_g: t.carbs,
    fats_g: t.fat,
    fiber_g: null,
    notes: null,
    effective_from: '',
    created_at: '',
    archived_at: null,
  };
}

describe('useMacroTargets — per-user cache keying', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCurrentForSelf.mockReset();
    mockUser = null;
  });

  it('reads and writes a per-user AsyncStorage key', async () => {
    mockUser = { id: 'user-A' };
    mockCurrentForSelf.mockResolvedValue({ data: serverShape(TARGETS_A) });

    const { result } = renderHook(() => useMacroTargets());

    await waitFor(() => {
      expect(result.current).toEqual(TARGETS_A);
    });

    const writtenA = await AsyncStorage.getItem('macro_targets:user-A');
    expect(writtenA).not.toBeNull();
    expect(JSON.parse(writtenA as string)).toMatchObject(TARGETS_A);

    // The legacy global key must NOT carry the value — that's the cross-user
    // leak vector this PR exists to fix.
    expect(await AsyncStorage.getItem('macro_targets')).toBeNull();
  });

  it('does NOT paint user A\'s cached macros when user B signs in', async () => {
    // Pre-seed both the legacy global key and user-A's per-user key with A's
    // targets — the scenario the bug originally produced.
    await AsyncStorage.setItem('macro_targets', JSON.stringify(TARGETS_A));
    await AsyncStorage.setItem('macro_targets:user-A', JSON.stringify(TARGETS_A));

    mockUser = { id: 'user-B' };
    // Pretend B has no macros set yet on the server.
    mockCurrentForSelf.mockResolvedValue({ data: null });

    const { result } = renderHook(() => useMacroTargets());

    // Allow the effect to run; B has no cache entry of its own and the
    // server returns null, so the resolved value must be null — NEVER A's.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toBeNull();

    // The legacy global key must be cleared by the hook on read so the leak
    // can't reappear if a stale build ever reads from it again.
    expect(await AsyncStorage.getItem('macro_targets')).toBeNull();
  });

  it('refetches and replaces state when the signed-in user changes', async () => {
    mockUser = { id: 'user-A' };
    mockCurrentForSelf.mockResolvedValueOnce({ data: serverShape(TARGETS_A) });

    const { result, rerender } = renderHook(() => useMacroTargets());

    await waitFor(() => expect(result.current).toEqual(TARGETS_A));

    // Simulate logout → user B sign-in.
    mockUser = { id: 'user-B' };
    mockCurrentForSelf.mockResolvedValueOnce({ data: serverShape(TARGETS_B) });
    rerender(undefined);

    // The hook must reset state to null immediately on user change so A's
    // numbers never paint for B — even for a single frame.
    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current).toEqual(TARGETS_B));

    // Each user's cache key is independently populated.
    expect(JSON.parse((await AsyncStorage.getItem('macro_targets:user-A')) as string))
      .toMatchObject(TARGETS_A);
    expect(JSON.parse((await AsyncStorage.getItem('macro_targets:user-B')) as string))
      .toMatchObject(TARGETS_B);
  });

  it('returns null and never calls the server when no user is signed in', async () => {
    mockUser = null;

    const { result } = renderHook(() => useMacroTargets());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBeNull();
    expect(mockCurrentForSelf).not.toHaveBeenCalled();
  });
});
