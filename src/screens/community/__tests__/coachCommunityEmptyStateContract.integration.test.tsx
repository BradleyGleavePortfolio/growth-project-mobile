/**
 * Coach community empty-state CONTRACT integration tests (code re-audit R3,
 * Finding 1 — real-hook / API-missing-surface path).
 *
 * The sibling `coachCommunityScreens.test.tsx` suite mocks the WHOLE
 * `useCoachCommunity` module (including `useCoachEmptyStatePayload`) and injects
 * a synthetic `{ status: 'error', kind: 'contract' }` result. That proves the
 * screen renders an already-synthesised error result, but it does NOT prove the
 * end-to-end screen + REAL hook + `coachCommunityApi.getCoachEmptyStates()`
 * contract path: a 200 response missing a required surface must surface as
 * `CoachErrorState` (with retry) — never the calm Roman empty state, never the
 * Roman empty-state face, never local fallback copy.
 *
 * This file closes that gap. It deliberately:
 *   - renders the real coach screens under a REAL `QueryClientProvider`,
 *   - exercises the REAL `useCoachEmptyStatePayload` / `useCoachEmptyStates`
 *     hooks (it NEVER mocks the `useCoachCommunity` module),
 *   - mocks ONLY the API layer (`coachCommunityApi.getCoachEmptyStates` plus the
 *     screen's primary data query, e.g. `getCohorts` / `getInbox`),
 *   - asserts the missing-surface 200 drives the screen into the honest
 *     error/retry branch and asserts the Roman EMPTY-state surface (its
 *     `CoachEmptyState` container, its `*-avatar` face image, and the local
 *     `coachVoice.ts` fallback copy) is absent.
 *
 * Boundary note: the honest error branch (`CoachErrorState`) intentionally
 * renders a NEUTRAL Roman avatar under a DIFFERENT testID
 * (`${root}-payload-error-avatar`). That is the error surface's face, not the
 * calm/celebratory EMPTY-state face this contract forbids; the assertions below
 * target the EMPTY-state testIDs (`${root}` / `${root}-avatar`) and the calm
 * fallback copy, which is the precise boundary the audit requires.
 */
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  CoachEmptyStateSurfaceKey,
  RomanCopyPayload,
} from '../../../api/coachCommunityApi';

// ── Theme: real light tokens, no ThemeProvider (mirror the sibling suite). ───
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

// ── Safe-area: no SafeAreaProvider in the test tree (mirror the sibling suite,
// which itself mirrors the wearables suite). CompletionToast reads insets. ──
jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLocal.createElement(View, { style }, children),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// ── Navigation (mirror the sibling suite's nav-mock pattern). ────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: {} }),
}));

// ── API LAYER ONLY. We spread the ACTUAL module so the real exports the hook
// relies on (`COACH_EMPTY_STATE_SURFACE_KEYS`, `CoachCommunityApiError`, the
// Zod schemas, the types) stay intact — we replace ONLY the network methods
// each screen calls. Critically, the `useCoachCommunity` module is NOT mocked,
// so the real `useCoachEmptyStates` runtime invariant runs for real. ──
jest.mock('../../../api/coachCommunityApi', () => {
  const actual = jest.requireActual('../../../api/coachCommunityApi');
  return {
    ...actual,
    coachCommunityApi: {
      ...actual.coachCommunityApi,
      getCoachEmptyStates: jest.fn(),
      getCohorts: jest.fn(),
      getInbox: jest.fn(),
    },
  };
});

import {
  coachCommunityApi,
  COACH_EMPTY_STATE_SURFACE_KEYS,
  type CoachEmptyStateSurfaceKey as SurfaceKey,
} from '../../../api/coachCommunityApi';
import { COACH_EMPTY_FALLBACK } from '../../../components/community/coach/coachVoice';
import CoachCommunityCohortsScreen from '../CoachCommunityCohortsScreen';
import CoachCommunityInboxScreen from '../CoachCommunityInboxScreen';

const mockGetEmptyStates =
  coachCommunityApi.getCoachEmptyStates as jest.Mock;
const mockGetCohorts = coachCommunityApi.getCohorts as jest.Mock;
const mockGetInbox = coachCommunityApi.getInbox as jest.Mock;

/** A valid Roman copy payload for one surface (live, non-fallback variant). */
function payloadFor(surface: SurfaceKey): RomanCopyPayload {
  return {
    text: `live backend copy for ${surface}`,
    avatar_crop:
      surface === 'coach_community_moderation_empty' ? 'smile' : 'neutral',
    surface_key: surface,
    voice_variant: 'roman_v2',
  };
}

/**
 * A contract-complete empty-states 200 response with EXACTLY ONE required
 * surface omitted — the exact "missing surface on an otherwise-valid 200" shape
 * the audit requires. `useCoachEmptyStates` must throw a typed `contract` error.
 */
function responseMissing(
  omit: SurfaceKey,
): Partial<Record<CoachEmptyStateSurfaceKey, RomanCopyPayload>> {
  const out: Partial<Record<CoachEmptyStateSurfaceKey, RomanCopyPayload>> = {};
  for (const key of COACH_EMPTY_STATE_SURFACE_KEYS) {
    if (key === omit) continue;
    out[key] = payloadFor(key);
  }
  return out;
}

async function renderWithRealQuery(ui: React.ReactElement) {
  // retry:false so a thrown contract error settles to `isError` immediately,
  // exactly like the real screen would after the policy fetch fails.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const utils = await render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
  return { qc, ...utils };
}

beforeEach(() => {
  mockGetEmptyStates.mockReset();
  mockGetCohorts.mockReset();
  mockGetInbox.mockReset();
  mockNavigate.mockReset();
});

describe('coach screen empty-state CONTRACT path (real hook, mocked API only)', () => {
  it('Cohorts: a 200 missing coach_community_cohorts_empty renders CoachErrorState + retry — never the Roman empty state, face, or fallback copy', async () => {
    // The cohort LIST loads successfully and is genuinely empty, so the screen
    // reaches its "quiet" branch and must resolve the Roman copy from the
    // policy. The policy 200 is MISSING the cohorts surface.
    mockGetCohorts.mockResolvedValue([]);
    mockGetEmptyStates.mockResolvedValue(
      responseMissing('coach_community_cohorts_empty'),
    );

    const { getByTestId, queryByTestId, queryByText } = await renderWithRealQuery(
      <CoachCommunityCohortsScreen />,
    );

    // The honest error/retry surface appears once both queries settle.
    await waitFor(() =>
      expect(
        getByTestId('coach-community-cohorts-empty-payload-error'),
      ).toBeTruthy(),
    );
    expect(
      getByTestId('coach-community-cohorts-empty-payload-error-retry'),
    ).toBeTruthy();

    // The calm Roman EMPTY state and its face image are NOT rendered.
    expect(queryByTestId('coach-community-cohorts-empty')).toBeNull();
    expect(queryByTestId('coach-community-cohorts-empty-avatar')).toBeNull();

    // No local fallback copy (from coachVoice.ts) leaks onto the screen.
    expect(
      queryByText(COACH_EMPTY_FALLBACK.coach_community_cohorts_empty.copy),
    ).toBeNull();
    // Nor the live backend copy for that surface (it was omitted from the 200).
    expect(
      queryByText('live backend copy for coach_community_cohorts_empty'),
    ).toBeNull();
  });

  it('Cohorts: tapping retry re-invokes the policy fetch (real retry wiring)', async () => {
    mockGetCohorts.mockResolvedValue([]);
    mockGetEmptyStates.mockResolvedValue(
      responseMissing('coach_community_cohorts_empty'),
    );

    const { getByTestId } = await renderWithRealQuery(<CoachCommunityCohortsScreen />);

    await waitFor(() =>
      expect(
        getByTestId('coach-community-cohorts-empty-payload-error'),
      ).toBeTruthy(),
    );
    const callsBefore = mockGetEmptyStates.mock.calls.length;

    await fireEvent.press(
      getByTestId('coach-community-cohorts-empty-payload-error-retry'),
    );

    await waitFor(() =>
      expect(mockGetEmptyStates.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it('Inbox: a 200 missing coach_community_inbox_empty renders CoachErrorState + retry — never the Roman empty state, face, or fallback copy', async () => {
    mockGetInbox.mockResolvedValue({ items: [], next_before: null });
    mockGetEmptyStates.mockResolvedValue(
      responseMissing('coach_community_inbox_empty'),
    );

    const { getByTestId, queryByTestId, queryByText } = await renderWithRealQuery(
      <CoachCommunityInboxScreen />,
    );

    await waitFor(() =>
      expect(
        getByTestId('coach-community-inbox-empty-payload-error'),
      ).toBeTruthy(),
    );
    expect(
      getByTestId('coach-community-inbox-empty-payload-error-retry'),
    ).toBeTruthy();

    expect(queryByTestId('coach-community-inbox-empty')).toBeNull();
    expect(queryByTestId('coach-community-inbox-empty-avatar')).toBeNull();

    expect(
      queryByText(COACH_EMPTY_FALLBACK.coach_community_inbox_empty.copy),
    ).toBeNull();
    expect(
      queryByText('live backend copy for coach_community_inbox_empty'),
    ).toBeNull();
  });

  it('Cohorts: while the policy fetch is in flight the screen shows a non-Roman spinner — never the empty-state face or copy', async () => {
    // The cohort list is empty (quiet branch), but the policy fetch never
    // settles, so the empty-state must be the loading branch: a plain spinner.
    mockGetCohorts.mockResolvedValue([]);
    mockGetEmptyStates.mockReturnValue(new Promise<never>(() => {}));

    const { getByTestId, queryByTestId, queryByText } = await renderWithRealQuery(
      <CoachCommunityCohortsScreen />,
    );

    // The non-Roman loading spinner for the empty-state surface appears once the
    // (empty) cohort list settles and the policy query is still pending.
    await waitFor(() =>
      expect(
        getByTestId('coach-community-cohorts-empty-loading'),
      ).toBeTruthy(),
    );

    // No Roman EMPTY state, no face, no error surface, no fallback copy while
    // the policy is loading.
    expect(queryByTestId('coach-community-cohorts-empty')).toBeNull();
    expect(queryByTestId('coach-community-cohorts-empty-avatar')).toBeNull();
    expect(
      queryByTestId('coach-community-cohorts-empty-payload-error'),
    ).toBeNull();
    expect(
      queryByText(COACH_EMPTY_FALLBACK.coach_community_cohorts_empty.copy),
    ).toBeNull();
  });
});
