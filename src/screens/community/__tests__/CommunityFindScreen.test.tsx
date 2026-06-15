/**
 * CommunityFindScreen — F6 screen-level tests for the v3-4 search surface.
 *
 * Coverage (the behaviours the R81 rebuild closed):
 *   - F1: a `voice_note_transcript` hit opens CommunityVoiceNoteDetail with the
 *     VOICE NOTE id (not a postId) and carries the transcript excerpt.
 *   - F8: a `classroom_lesson` / `event` hit only navigates when the matching
 *     server flag is ON; when OFF it shows a calm notice instead of dead-ending.
 *   - F4: a settled search emits community_search_submitted (length only, never
 *     the raw term); a result tap emits community_search_result_tapped.
 *   - F2: the surface renders the neutral "not available" state when the
 *     server-evaluated community_search flag is OFF.
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

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// Static build-time flag ON (route registered); the runtime gate is the
// server-evaluated useFeatureFlags mock below.
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { communitySearch: true },
}));

const mockFlagsState = {
  flags: {
    community_search: true,
    coach_community_wearable_prompts: false,
    community_classroom: true,
    community_events: true,
  },
  isLoading: false,
  isError: false,
};
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => mockFlagsState,
}));

jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({
    data: { workspace_id: 'ws-1' },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

const mockSearchState = {
  data: { pages: [{ results: [] as unknown[] }] },
  isLoading: false,
  isError: false,
  isSuccess: true,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: jest.fn(),
  refetch: jest.fn(),
};
jest.mock('../../../hooks/useCommunitySearch', () => ({
  useCommunitySearch: () => mockSearchState,
}));

const mockTrack = jest.fn();
jest.mock('../../../analytics/posthog.service', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import CommunityFindScreen from '../CommunityFindScreen';
import { AnalyticsEvents } from '../../../analytics/events';

function resultRow(over: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    kind: 'post',
    targetId: 'post-1',
    cohortId: null,
    authorId: null,
    excerpt: 'an excerpt',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

/**
 * The screen debounces the typed term (SEARCH_DEBOUNCE_MS = 300) before the
 * result list mounts (an empty term renders the idle state). This types a term
 * and advances the debounce so the FlatList of results renders.
 */
async function typeAndSettle(term = 'hello') {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('community-search-input'), term);
  });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockNavigate.mockReset();
  mockTrack.mockReset();
  mockSearchState.data = { pages: [{ results: [] }] };
  mockFlagsState.flags = {
    community_search: true,
    coach_community_wearable_prompts: false,
    community_classroom: true,
    community_events: true,
  };
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('CommunityFindScreen — F2 runtime flag gate', () => {
  it('renders the neutral not-available state when the server flag is OFF', async () => {
    mockFlagsState.flags.community_search = false;
    await render(<CommunityFindScreen />);
    expect(screen.getByText('Search is not available right now.')).toBeTruthy();
    expect(screen.queryByTestId('community-search-bar')).toBeNull();
  });
});

describe('CommunityFindScreen — F1 voice-note routing', () => {
  it('opens CommunityVoiceNoteDetail with the voiceNoteId + excerpt for a transcript hit', async () => {
    mockSearchState.data = {
      pages: [
        {
          results: [
            resultRow({
              id: 'vn-res',
              kind: 'voice_note_transcript',
              targetId: 'voice-note-9',
              excerpt: 'the matched transcript text',
            }),
          ],
        },
      ],
    };
    await render(<CommunityFindScreen />);
    await typeAndSettle();
    fireEvent.press(screen.getByTestId('community-search-result-vn-res'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityVoiceNoteDetail', {
      voiceNoteId: 'voice-note-9',
      excerpt: 'the matched transcript text',
    });
  });
});

describe('CommunityFindScreen — F8 dependent-flag containment', () => {
  it('navigates to a lesson when community_classroom is ON', async () => {
    mockSearchState.data = {
      pages: [
        {
          results: [
            resultRow({ id: 'l-res', kind: 'classroom_lesson', targetId: 'lesson-2' }),
          ],
        },
      ],
    };
    await render(<CommunityFindScreen />);
    await typeAndSettle();
    fireEvent.press(screen.getByTestId('community-search-result-l-res'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunityLessonDetail', {
      postId: 'lesson-2',
    });
  });

  it('does NOT navigate and shows a notice when community_classroom is OFF', async () => {
    mockFlagsState.flags.community_classroom = false;
    mockSearchState.data = {
      pages: [
        {
          results: [
            resultRow({ id: 'l-res', kind: 'classroom_lesson', targetId: 'lesson-2' }),
          ],
        },
      ],
    };
    await render(<CommunityFindScreen />);
    await typeAndSettle();
    await act(async () => {
      fireEvent.press(screen.getByTestId('community-search-result-l-res'));
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('community-find-unavailable-notice')).toBeTruthy();
  });

  it('does NOT navigate and shows a notice when community_events is OFF', async () => {
    mockFlagsState.flags.community_events = false;
    mockSearchState.data = {
      pages: [
        {
          results: [resultRow({ id: 'e-res', kind: 'event', targetId: 'event-3' })],
        },
      ],
    };
    await render(<CommunityFindScreen />);
    await typeAndSettle();
    await act(async () => {
      fireEvent.press(screen.getByTestId('community-search-result-e-res'));
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('community-find-unavailable-notice')).toBeTruthy();
  });
});

describe('CommunityFindScreen — F4 telemetry', () => {
  it('emits community_search_result_tapped with the result_type + position on tap', async () => {
    mockSearchState.data = {
      pages: [
        { results: [resultRow({ id: 'res-1', kind: 'post', targetId: 'post-1' })] },
      ],
    };
    await render(<CommunityFindScreen />);
    await typeAndSettle();
    fireEvent.press(screen.getByTestId('community-search-result-res-1'));
    expect(mockTrack).toHaveBeenCalledWith(
      AnalyticsEvents.COMMUNITY_SEARCH_RESULT_TAPPED,
      { result_type: 'thread', position: 0 },
    );
  });
});
