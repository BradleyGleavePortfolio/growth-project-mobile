/**
 * CommunityWearablePromptsScreen — F6 screen-level tests for the v3-4 COACH-ONLY
 * wearable coaching prompts surface.
 *
 * Coverage (the behaviours the R81 rebuild closed):
 *   - F2: the surface renders the neutral "not available" state when the
 *     server-evaluated coach_community_wearable_prompts flag is OFF (this also
 *     covers a non-coach caller, since the backend resolves the flag OFF for
 *     non-coaches — the screen trusts the server flag, no client role re-check).
 *   - N1: the list query gate (enabled) is only true once the flag resolved ON,
 *     the prereq finished, the caller is a coach/owner, and both ids exist — so
 *     a still-loading flag map shows the loading state, never a premature fetch.
 *   - N2: a FAILED dismiss / act-on is no longer silently absorbed — the matching
 *     card renders an inline error + a retry control (it does NOT dead-end).
 *   - F4: a successful dismiss / act-on emits the matching coach telemetry event
 *     (opaque ids only; never the prompt body).
 *
 * Every data hook is mocked so each render path is deterministic.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { clientId: 'client-1' } }),
}));

// Static build-time flag ON (route registered); the runtime gate is the
// server-evaluated useFeatureFlags mock below.
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { communityWearablePrompts: true },
}));

const mockFlagsState = {
  flags: {
    community_search: false,
    coach_community_wearable_prompts: true,
    community_classroom: false,
    community_events: false,
  },
  isLoading: false,
  isError: false,
};
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => mockFlagsState,
}));

const mockMeState = {
  data: {
    workspace_id: 'ws-1',
    membership: { role: 'coach' },
  },
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => mockMeState,
}));

const mockListState = {
  data: { version: 1, prompts: [] as unknown[] },
  isLoading: false,
  isError: false,
  isSuccess: true,
  refetch: jest.fn(),
};
const mockGenerate = { mutateAsync: jest.fn(), isPending: false, isError: false };
const mockDismiss = { mutateAsync: jest.fn(), isPending: false, isError: false };
const mockActOn = { mutateAsync: jest.fn(), isPending: false, isError: false };
jest.mock('../../../hooks/useWearablePrompts', () => ({
  useWearablePrompts: () => mockListState,
  useGenerateWearablePrompts: () => mockGenerate,
  useDismissWearablePrompt: () => mockDismiss,
  useActOnWearablePrompt: () => mockActOn,
}));

const mockTrack = jest.fn();
jest.mock('../../../analytics/posthog.service', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import CommunityWearablePromptsScreen from '../CommunityWearablePromptsScreen';
import { AnalyticsEvents } from '../../../analytics/events';

function prompt(over: Record<string, unknown> = {}) {
  return {
    id: 'prompt-1',
    workspaceId: 'ws-1',
    coachId: 'coach-1',
    clientId: 'client-1',
    metricKey: 'HRV_MS',
    promptText: 'Their HRV trended up this week — worth a check-in.',
    sources: [],
    generatedAt: '2026-03-01T00:00:00.000Z',
    dismissedAt: null,
    actedOnAt: null,
    ...over,
  };
}

beforeEach(() => {
  mockTrack.mockReset();
  mockGenerate.mutateAsync.mockReset();
  mockDismiss.mutateAsync.mockReset();
  mockActOn.mutateAsync.mockReset();
  mockListState.data = { version: 1, prompts: [] };
  mockListState.isLoading = false;
  mockListState.isError = false;
  mockFlagsState.flags = {
    community_search: false,
    coach_community_wearable_prompts: true,
    community_classroom: false,
    community_events: false,
  };
  mockFlagsState.isLoading = false;
  mockMeState.isLoading = false;
  mockMeState.isError = false;
  mockMeState.data = { workspace_id: 'ws-1', membership: { role: 'coach' } };
});

describe('CommunityWearablePromptsScreen — F2 runtime flag gate', () => {
  it('renders the neutral not-available state when the server flag is OFF', async () => {
    mockFlagsState.flags.coach_community_wearable_prompts = false;
    await render(<CommunityWearablePromptsScreen />);
    expect(screen.getByTestId('wearable-prompts-flag-off')).toBeTruthy();
    expect(screen.queryByTestId('wearable-prompts-list')).toBeNull();
  });
});

describe('CommunityWearablePromptsScreen — N1 no premature fetch while flags load', () => {
  it('shows the loading state (not the list) while the flag map is still resolving', async () => {
    mockFlagsState.isLoading = true;
    await render(<CommunityWearablePromptsScreen />);
    expect(screen.getByTestId('wearable-prompts-prereq-loading')).toBeTruthy();
    expect(screen.queryByTestId('wearable-prompts-list')).toBeNull();
  });
});

describe('CommunityWearablePromptsScreen — N2 inline failure + retry', () => {
  it('renders an inline error + retry when a dismiss fails (no silent absorb)', async () => {
    mockListState.data = { version: 1, prompts: [prompt()] };
    mockDismiss.mutateAsync.mockRejectedValueOnce(new Error('boom'));
    await render(<CommunityWearablePromptsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('wearable-prompt-dismiss-prompt-1'));
    });

    expect(screen.getByTestId('wearable-prompt-error-prompt-1')).toBeTruthy();
    expect(
      screen.getByTestId('wearable-prompt-error-retry-prompt-1'),
    ).toBeTruthy();
  });

  it('retries the failed action when the inline retry is pressed', async () => {
    mockListState.data = { version: 1, prompts: [prompt()] };
    mockActOn.mutateAsync
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(prompt({ actedOnAt: '2026-03-02T00:00:00.000Z' }));
    await render(<CommunityWearablePromptsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('wearable-prompt-act-prompt-1'));
    });
    expect(screen.getByTestId('wearable-prompt-error-prompt-1')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('wearable-prompt-error-retry-prompt-1'));
    });
    expect(mockActOn.mutateAsync).toHaveBeenCalledTimes(2);
  });
});

describe('CommunityWearablePromptsScreen — F4 telemetry', () => {
  it('emits coach_wearable_prompt_dismissed on a successful dismiss', async () => {
    mockListState.data = { version: 1, prompts: [prompt()] };
    mockDismiss.mutateAsync.mockResolvedValueOnce(
      prompt({ dismissedAt: '2026-03-02T00:00:00.000Z' }),
    );
    await render(<CommunityWearablePromptsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('wearable-prompt-dismiss-prompt-1'));
    });

    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.COACH_WEARABLE_PROMPT_DISMISSED,
      { client_id: 'client-1', prompt_id: 'prompt-1' },
    );
  });

  it('emits coach_wearable_prompt_acted_on on a successful act-on', async () => {
    mockListState.data = { version: 1, prompts: [prompt()] };
    mockActOn.mutateAsync.mockResolvedValueOnce(
      prompt({ actedOnAt: '2026-03-02T00:00:00.000Z' }),
    );
    await render(<CommunityWearablePromptsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('wearable-prompt-act-prompt-1'));
    });

    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.COACH_WEARABLE_PROMPT_ACTED_ON,
      { client_id: 'client-1', prompt_id: 'prompt-1', action: 'acted_on' },
    );
  });
});
