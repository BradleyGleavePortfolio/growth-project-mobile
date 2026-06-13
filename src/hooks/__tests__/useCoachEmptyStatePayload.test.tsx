/**
 * useCoachEmptyStatePayload — hook behaviour tests for the stateful Roman
 * empty-state resolver (fixer R2, BLOCKER 1).
 *
 * The hook MUST collapse the old silent local-fallback behaviour into an honest
 * discriminated result driven entirely by the backend voice-policy query:
 *   - in flight                          → { status: 'loading' }
 *   - full payload present               → { status: 'ready', payload }
 *   - network/transport failure          → { status: 'error', kind: 'network' }
 *   - 200 missing a required surface     → { status: 'error', kind: 'contract' }
 *
 * `coachCommunityApi.getCoachEmptyStates` is mocked so each branch is
 * deterministic; the hook runs under a REAL QueryClientProvider so the React
 * Query state machine (loading → success/error) is exercised for real, not
 * stubbed. There is intentionally NO assertion that any local-constant copy is
 * ever returned — the contract is that it never is.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/coachCommunityApi', () => {
  const actual = jest.requireActual('../../api/coachCommunityApi');
  return {
    ...actual,
    coachCommunityApi: {
      ...actual.coachCommunityApi,
      getCoachEmptyStates: jest.fn(),
    },
  };
});

import {
  coachCommunityApi,
  CoachCommunityApiError,
  COACH_EMPTY_STATE_SURFACE_KEYS,
  type RomanCopyPayload,
  type CoachEmptyStateSurfaceKey,
} from '../../api/coachCommunityApi';
import { useCoachEmptyStatePayload } from '../useCoachCommunity';

const mockGet = coachCommunityApi.getCoachEmptyStates as jest.Mock;

/** A valid Roman copy payload for one surface. */
function payloadFor(
  surface: CoachEmptyStateSurfaceKey,
  over: Partial<RomanCopyPayload> = {},
): RomanCopyPayload {
  return {
    text: `live copy for ${surface}`,
    avatar_crop: surface === 'coach_community_moderation_empty' ? 'smile' : 'neutral',
    surface_key: surface,
    voice_variant: 'roman_v2',
    ...over,
  };
}

/** A full, contract-complete response (every required surface present). */
function fullResponse(): Record<CoachEmptyStateSurfaceKey, RomanCopyPayload> {
  const out = {} as Record<CoachEmptyStateSurfaceKey, RomanCopyPayload>;
  for (const key of COACH_EMPTY_STATE_SURFACE_KEYS) {
    out[key] = payloadFor(key);
  }
  return out;
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  mockGet.mockReset();
});

describe('useCoachEmptyStatePayload — stateful, backend-driven result', () => {
  it('Case 1: a full payload resolves to { status: "ready", payload }', async () => {
    mockGet.mockResolvedValue(fullResponse());
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useCoachEmptyStatePayload('coach_community_home_empty'),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({
      status: 'ready',
      payload: payloadFor('coach_community_home_empty'),
    });
  });

  it('Case 2: while the query is in flight it reports { status: "loading" }', async () => {
    // A never-resolving promise keeps the query pending.
    mockGet.mockReturnValue(new Promise<never>(() => {}));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useCoachEmptyStatePayload('coach_community_inbox_empty'),
      { wrapper: Wrapper },
    );

    // The very first render is the loading branch — no Roman payload yet.
    expect(result.current.status).toBe('loading');
  });

  it('Case 3: a network/transport failure resolves to { status: "error", kind: "network" }', async () => {
    mockGet.mockRejectedValue(
      new CoachCommunityApiError('network', 0, 'offline'),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useCoachEmptyStatePayload('coach_community_cohorts_empty'),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ status: 'error', kind: 'network' });
    if (result.current.status === 'error') {
      expect(typeof result.current.retry).toBe('function');
    }
  });

  it('Case 3b: a generic (non-typed) rejection still classifies as network', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useCoachEmptyStatePayload('coach_community_cohorts_empty'),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ status: 'error', kind: 'network' });
  });

  it('Case 4: a 200 MISSING a required surface resolves to { status: "error", kind: "contract" }', async () => {
    // Drop one required surface from an otherwise-valid response. The
    // useCoachEmptyStates runtime invariant must throw a typed `contract`
    // error rather than letting the screen fall back to a local constant.
    const partial = fullResponse();
    delete (partial as Record<string, unknown>)[
      'coach_community_moderation_empty'
    ];
    mockGet.mockResolvedValue(partial);
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useCoachEmptyStatePayload('coach_community_moderation_empty'),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ status: 'error', kind: 'contract' });
  });

  it('retry() re-invokes the policy fetch', async () => {
    mockGet.mockRejectedValueOnce(
      new CoachCommunityApiError('network', 0, 'offline'),
    );
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useCoachEmptyStatePayload('coach_community_home_empty'),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    const callsBefore = mockGet.mock.calls.length;
    // Next fetch succeeds.
    mockGet.mockResolvedValue(fullResponse());
    if (result.current.status === 'error') {
      result.current.retry();
    }
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGet.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
