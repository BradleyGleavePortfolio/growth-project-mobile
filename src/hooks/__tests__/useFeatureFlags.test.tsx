/**
 * useFeatureFlags — hook behaviour tests for the v3-4 server-evaluated flag map
 * (D5=B+γ). The hook is the inner, server-authoritative RUNTIME gate the
 * community screens read. The contract under test:
 *
 *   - FAIL-SAFE: while loading AND on error, EVERY typed flag reads `false`.
 *     A failed flags fetch must never enable a gated surface.
 *   - On success, each of the four typed keys reflects the server map; a key
 *     absent from the map is treated as OFF.
 *   - The hook trusts the server's role gating: a non-coach caller simply gets
 *     `coach_community_wearable_prompts: false` in the map and the hook surfaces
 *     that as-is (no client-side role re-check).
 *
 * featureFlagsApi is mocked so the tests are deterministic and never touch the
 * network. (AppState foreground-refetch wiring is exercised by the screen
 * tests; here we pin the resolution semantics.)
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/featureFlagsApi', () => ({
  featureFlagsApi: { getFeatureFlags: jest.fn() },
  SERVER_FEATURE_FLAG_KEYS: [
    'community_search',
    'coach_community_wearable_prompts',
    'community_classroom',
    'community_events',
  ],
}));

import { featureFlagsApi } from '../../api/featureFlagsApi';
import type { FeatureFlagsResponse } from '../../api/featureFlagsApi';
import { useFeatureFlags } from '../useFeatureFlags';

const api = jest.mocked(featureFlagsApi);

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper };
}

function resp(flags: Record<string, boolean>): FeatureFlagsResponse {
  return { flags, evaluated_at: '2026-06-15T00:00:00.000Z' };
}

beforeEach(() => {
  (api.getFeatureFlags as jest.Mock).mockReset();
});

describe('useFeatureFlags — fail-safe OFF', () => {
  it('reads every flag OFF while loading (before the first success)', async () => {
    // A never-resolving promise keeps the query in the loading state.
    api.getFeatureFlags.mockReturnValue(new Promise(() => undefined));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useFeatureFlags(), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.flags).toEqual({
      community_search: false,
      coach_community_wearable_prompts: false,
      community_classroom: false,
      community_events: false,
    });
  });

  it('reads every flag OFF on error', async () => {
    api.getFeatureFlags.mockRejectedValue(new Error('boom'));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useFeatureFlags(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.flags).toEqual({
      community_search: false,
      coach_community_wearable_prompts: false,
      community_classroom: false,
      community_events: false,
    });
  });
});

describe('useFeatureFlags — server resolution', () => {
  it('reflects the server map for each typed key on success', async () => {
    api.getFeatureFlags.mockResolvedValue(
      resp({
        community_search: true,
        coach_community_wearable_prompts: true,
        community_classroom: false,
        community_events: true,
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useFeatureFlags(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.flags).toEqual({
      community_search: true,
      coach_community_wearable_prompts: true,
      community_classroom: false,
      community_events: true,
    });
  });

  it('treats a key absent from the map as OFF', async () => {
    api.getFeatureFlags.mockResolvedValue(resp({ community_search: true }));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useFeatureFlags(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.flags.community_search).toBe(true));
    expect(result.current.flags.coach_community_wearable_prompts).toBe(false);
    expect(result.current.flags.community_classroom).toBe(false);
    expect(result.current.flags.community_events).toBe(false);
  });

  it('surfaces a server-resolved coach flag without re-applying client role gating', async () => {
    // The server resolves coach_community_wearable_prompts: false for a
    // non-coach caller; the hook trusts that value as-is.
    api.getFeatureFlags.mockResolvedValue(
      resp({ coach_community_wearable_prompts: false, community_search: true }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useFeatureFlags(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.flags.coach_community_wearable_prompts).toBe(false);
  });
});
