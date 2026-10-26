/**
 * FR-886R (LS-1165 B2, phone half): a coach's removal reaches viewer B with no tap. The removal ping
 * (community.message.updated, backend #1165) re-reads every voice list and voice note page on screen
 * over REST, so a playable card turns into the named placeholder (RB-W4) and its player, holding the
 * audio, goes away. A ping missed while the phone slept heals on the way back (the bounded catch-up).
 * The ping stays untrusted: only its event name is read, and an odd ping still re-reads.
 */
import React from 'react';
import { Alert, AppState, type AlertButton, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContext } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';

jest.mock('../../config/featureFlags', () => ({
  featureFlags: { communityVoiceNotes: true, communitySearch: true },
}));
jest.mock('../useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { community_search: true }, isLoading: false, isError: false }),
}));
jest.mock('../useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u-me' }) }));
jest.mock('../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../components/HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: (p: { children: React.ReactNode; onPress?: () => void; testID?: string }) =>
      React.createElement(Pressable, { onPress: p.onPress, testID: p.testID }, p.children),
  };
});
jest.mock('../../components/community', () => ({ ThreadHeader: () => null }));
// The player holds the clip; unmounting it is what releases the audio (VoiceNotePlayer.tsx release()).
const mockReleased = jest.fn();
jest.mock('../../components/community/VoiceNotePlayer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (p: { testID?: string; url: string; trailing?: unknown; footer?: unknown }) => {
      React.useEffect(() => () => mockReleased(p.url), [p.url]);
      return React.createElement(View, { testID: p.testID, accessibilityHint: p.url }, p.trailing, p.footer);
    },
  };
});
jest.mock('../../components/community/VoiceRecordSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
const mockParams = { voiceNoteId: 'vn-other', excerpt: '' };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

// The private broadcast channel: the test holds the ping handler useCommunityBadge registers.
const mockPing: { current: ((ping?: unknown) => void) | null } = { current: null };
jest.mock('../../api/communityRealtime', () => ({
  ...jest.requireActual('../../api/communityRealtime'),
  subscribeToCommunityUser: (_userId: string, onPing: (ping?: unknown) => void) => {
    mockPing.current = onPing;
    return () => {
      mockPing.current = null;
    };
  },
}));
const mockGetMe = jest.fn();
jest.mock('../../api/communityApi', () => {
  const actual = jest.requireActual('../../api/communityApi');
  return { ...actual, communityApi: { ...actual.communityApi, getMe: (...a: unknown[]) => mockGetMe(...a) } };
});
const mockListFeed = jest.fn();
const mockGetOne = jest.fn();
const mockRemove = jest.fn();
jest.mock('../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../api/communityVoiceApi');
  return {
    ...actual,
    communityVoiceApi: {
      listFeed: (...a: unknown[]) => mockListFeed(...a),
      getOne: (...a: unknown[]) => mockGetOne(...a),
      remove: (...a: unknown[]) => mockRemove(...a),
      issueUploadUrl: jest.fn().mockRejectedValue(new Error('upload target unavailable')),
    },
  };
});

import VoiceNotesSection from '../../components/community/VoiceNotesSection';
import CommunityVoiceNoteDetail from '../../screens/community/CommunityVoiceNoteDetail';
import { voiceRemovedLine } from '../../components/community/removed/VoiceRemovedPlaceholder';
import { resetReportedVoiceNotes } from '../../components/community/VoiceReportedFold';
import { resetVoiceOutbox } from '../useVoiceOutbox';
import { useCommunityBadge } from '../useCommunity';
import { VOICE_CATCH_UP_MS, useVoiceFeed } from '../useVoiceFeed';

const UPDATED = 'community.message.updated';
const note = (id: string, author: string) => ({
  id,
  workspace_id: 'ws-1',
  cohort_id: null as string | null,
  conversation_id: null,
  author_id: author,
  url: `https://storage.example.test/${id}`,
  duration_ms: 42_000,
  bytes: 1000,
  mime_type: 'audio/mp4',
  waveform_peaks: [0.2, 0.7],
  created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
});
// What the server reads back once Coach Sam removed it (backend #1165 CONTRACT §1).
const removed = (n: ReturnType<typeof note>) => ({
  ...n,
  url: null,
  duration_ms: 0,
  bytes: 0,
  waveform_peaks: null,
  removed_at: new Date().toISOString(),
  removed_by: { role: 'coach' as const, user_id: 'u-coach', name: 'Sam' },
});
// The removal ping as backend #1165 sends it (the phone reads only `event`).
const removalPing = (cohortId: string | null) => ({
  event: UPDATED,
  payload: { id: 'vn-other', cohortId, kind: 'voice', authorId: 'u-alice', removedBy: { role: 'coach', userId: 'u-coach' } },
});
const page = (...notes: unknown[]) => ({ voice_notes: notes, next_cursor: null });

function Badge() {
  useCommunityBadge('u-me');
  return null;
}
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
async function ping(p?: unknown) {
  await act(async () => {
    mockPing.current?.(p);
  });
}

let alertSpy: jest.SpyInstance;
const spies: jest.SpyInstance[] = [];
beforeEach(() => {
  resetVoiceOutbox();
  resetReportedVoiceNotes();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockPing.current = null;
  mockReleased.mockReset();
  mockGetMe.mockReset().mockResolvedValue({
    membership: { role: 'client' },
    unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  });
  mockListFeed.mockReset();
  mockGetOne.mockReset();
  mockRemove.mockReset().mockResolvedValue({ id: 'vn-mine', deleted: true });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  alertSpy.mockRestore();
  spies.splice(0).forEach((s) => s.mockRestore());
});

describe('a removal ping turns a playable note into its placeholder with no tap', () => {
  it('the Hall list', async () => {
    mockListFeed
      .mockResolvedValueOnce(page(note('vn-other', 'u-alice'), note('vn-mine', 'u-me')))
      .mockResolvedValue(page(removed(note('vn-other', 'u-alice')), note('vn-mine', 'u-me')));
    const { findByTestId, getByText, queryByTestId, getByTestId } = await render(
      <QueryClientProvider client={newClient()}>
        <Badge />
        <VoiceNotesSection workspaceId="ws-1" viewerUserId="u-me" testID="vn" />
      </QueryClientProvider>,
    );
    expect(await findByTestId('vn-player-vn-other')).toBeTruthy();
    await waitFor(() => expect(mockPing.current).not.toBeNull());

    await ping(removalPing(null));

    expect(await findByTestId('vn-removed-vn-other')).toBeTruthy();
    expect(getByText('Removed by Coach Sam')).toBeTruthy();
    expect(queryByTestId('vn-player-vn-other')).toBeNull();
    expect(mockReleased).toHaveBeenCalledWith('https://storage.example.test/vn-other'); // its audio dropped
    expect(getByTestId('vn-player-vn-mine')).toBeTruthy(); // the rest of the list plays on
  });

  it("a space's voice section", async () => {
    const live = { ...note('vn-other', 'u-alice'), cohort_id: 'c-1' };
    mockListFeed.mockResolvedValueOnce(page(live)).mockResolvedValue(page(removed(live)));
    const qc = newClient();
    const { result } = await renderHook(
      () => {
        useCommunityBadge('u-me');
        return useVoiceFeed({ workspaceId: 'ws-1', cohortId: 'c-1' });
      },
      { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> },
    );
    await waitFor(() => expect(result.current.data?.pages[0].voice_notes[0].url).toBeTruthy());
    expect(mockListFeed.mock.calls[0][1]).toMatchObject({ cohortId: 'c-1' });

    await ping(removalPing('c-1'));

    await waitFor(() => expect(result.current.data?.pages[0].voice_notes[0].removed_at).toBeTruthy());
    const shown = result.current.data!.pages[0].voice_notes[0];
    expect(shown.url).toBeNull();
    expect(voiceRemovedLine(shown, 'u-me')?.text).toBe('Removed by Coach Sam');
  });

  it('the voice note page', async () => {
    mockGetOne
      .mockResolvedValueOnce(note('vn-other', 'u-alice'))
      .mockResolvedValue(removed(note('vn-other', 'u-alice')));
    const { findByTestId, getByText, queryByTestId } = await render(
      <QueryClientProvider client={newClient()}>
        <Badge />
        <CommunityVoiceNoteDetail />
      </QueryClientProvider>,
    );
    expect(await findByTestId('community-voice-detail-player')).toBeTruthy();
    await waitFor(() => expect(mockPing.current).not.toBeNull());

    await ping(removalPing(null));

    expect(await findByTestId('community-voice-detail-removed')).toBeTruthy();
    expect(getByText('Removed by Coach Sam')).toBeTruthy();
    expect(queryByTestId('community-voice-detail-player')).toBeNull();
    expect(mockReleased).toHaveBeenCalledWith('https://storage.example.test/vn-other');
    expect(mockGetOne).toHaveBeenLastCalledWith('vn-other');
  });
});

describe('the ping stays untrusted', () => {
  async function renderFeed() {
    mockListFeed.mockResolvedValue(page(note('vn-other', 'u-alice')));
    const qc = newClient();
    const { result } = await renderHook(
      () => {
        useCommunityBadge('u-me');
        return useVoiceFeed({ workspaceId: 'ws-1' });
      },
      { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(mockPing.current).not.toBeNull());
    return result;
  }

  it.each([
    ['no ping object', undefined],
    ['null', null],
    ['no event', {}],
    ['a number for the event', { event: 42 }],
    ['an unknown event', { event: 'community.voice.gone', payload: 'odd' }],
    ['an update with no payload', { event: UPDATED }],
    ['an update with an odd payload', { event: UPDATED, payload: { id: 7, cohortId: {}, removedBy: 'x' } }],
  ])('%s still re-reads the voice list, without a crash', async (_label, odd) => {
    await renderFeed();
    const before = mockListFeed.mock.calls.length;
    const meBefore = mockGetMe.mock.calls.length;
    await ping(odd);
    await waitFor(() => expect(mockListFeed.mock.calls.length).toBe(before + 1));
    await waitFor(() => expect(mockGetMe.mock.calls.length).toBeGreaterThan(meBefore)); // the badge as before
  });

  it('a ping for a new message re-reads the badge only, not the voice list', async () => {
    await renderFeed();
    const before = mockListFeed.mock.calls.length;
    const meBefore = mockGetMe.mock.calls.length;
    await ping({ event: 'community.message.created' });
    await waitFor(() => expect(mockGetMe.mock.calls.length).toBeGreaterThan(meBefore));
    expect(mockListFeed.mock.calls.length).toBe(before);
  });
});

const BOUND = 15_000; // VOICE_CATCH_UP_MS

describe('the bounded catch-up heals a missed ping', () => {
  let appListeners: Array<(s: AppStateStatus) => void>;
  let focusListeners: Array<() => void>;
  const navigation = {
    addListener: (name: string, cb: () => void) => {
      if (name === 'focus') focusListeners.push(cb);
      return () => {
        focusListeners = focusListeners.filter((x) => x !== cb);
      };
    },
  };
  // AppState.addEventListener is already a jest mock (react-native's jest setup); swap it for this block
  // and put it back, so later tests keep the subscription it returns.
  const realAdd = AppState.addEventListener;
  beforeEach(() => {
    appListeners = [];
    focusListeners = [];
    AppState.addEventListener = ((type: string, cb: (s: AppStateStatus) => void) => {
      if (type === 'change') appListeners.push(cb);
      return { remove: () => (appListeners = appListeners.filter((x) => x !== cb)) };
    }) as never;
  });
  afterEach(() => {
    AppState.addEventListener = realAdd;
  });
  const app = async (s: AppStateStatus) => act(async () => appListeners.forEach((cb) => cb(s)));
  const focus = async () => act(async () => focusListeners.forEach((cb) => cb()));

  it('the app back in front or the screen refocused re-reads at most once per bound', async () => {
    const live = note('vn-other', 'u-alice');
    mockListFeed.mockResolvedValueOnce(page(live)).mockResolvedValue(page(removed(live)));
    const qc = newClient();
    const { result } = await renderHook(() => useVoiceFeed({ workspaceId: 'ws-1' }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={qc}>
          <NavigationContext.Provider value={navigation as never}>{children}</NavigationContext.Provider>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const start = Date.now();
    const clock = jest.spyOn(Date, 'now');
    spies.push(clock);

    // Inside the bound after the first read: a burst of returns reads nothing.
    clock.mockReturnValue(start + 5_000);
    await app('background');
    await app('active');
    await focus();
    expect(mockListFeed).toHaveBeenCalledTimes(1);

    // Past the bound the ping missed in the background heals: one read, then the bound holds again.
    clock.mockReturnValue(start + BOUND + 1_000);
    await app('active');
    await waitFor(() => expect(result.current.data?.pages[0].voice_notes[0].removed_at).toBeTruthy());
    expect(mockListFeed).toHaveBeenCalledTimes(2);
    await app('inactive');
    await app('active');
    await focus();
    expect(mockListFeed).toHaveBeenCalledTimes(2);

    // Coming back to the screen after the next bound reads once more.
    clock.mockReturnValue(start + 2 * BOUND + 2_000);
    await focus();
    await app('active');
    await waitFor(() => expect(mockListFeed).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(mockListFeed).toHaveBeenCalledTimes(3);
    expect(VOICE_CATCH_UP_MS).toBe(BOUND);
  });

  it('the voice note page catches up when the app comes back', async () => {
    mockGetOne
      .mockResolvedValueOnce(note('vn-other', 'u-alice'))
      .mockResolvedValue(removed(note('vn-other', 'u-alice')));
    const { findByTestId } = await render(
      <QueryClientProvider client={newClient()}>
        <CommunityVoiceNoteDetail />
      </QueryClientProvider>,
    );
    expect(await findByTestId('community-voice-detail-player')).toBeTruthy();
    const start = Date.now();
    spies.push(jest.spyOn(Date, 'now').mockReturnValue(start + BOUND + 1_000));
    await app('active');
    expect(await findByTestId('community-voice-detail-removed')).toBeTruthy();
    expect(mockGetOne).toHaveBeenCalledTimes(2);
  });
});

describe("an author's own delete", () => {
  it('still vanishes from the Hall list, with no placeholder, before and after the ping', async () => {
    mockListFeed
      .mockResolvedValueOnce(page(note('vn-other', 'u-alice'), note('vn-mine', 'u-me')))
      .mockResolvedValue(page(note('vn-other', 'u-alice')));
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <QueryClientProvider client={newClient()}>
        <Badge />
        <VoiceNotesSection workspaceId="ws-1" viewerUserId="u-me" testID="vn" />
      </QueryClientProvider>,
    );
    await fireEvent.press(await findByTestId('vn-menu-vn-mine'));
    await fireEvent.press(getByTestId('vn-menu-vn-mine-delete'));
    const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    const del = ((call[2] ?? []) as AlertButton[]).find((b) => b.text === 'Delete');
    await act(async () => {
      await del?.onPress?.();
    });
    expect(mockRemove).toHaveBeenCalledWith('vn-mine');
    await waitFor(() => expect(queryByTestId('vn-note-vn-mine')).toBeNull());
    expect(queryByTestId('vn-removed-vn-mine')).toBeNull();

    await ping({ event: UPDATED, payload: { id: 'vn-mine', cohortId: null } });
    await waitFor(() => expect(mockListFeed.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(queryByTestId('vn-note-vn-mine')).toBeNull();
    expect(queryByTestId('vn-removed-vn-mine')).toBeNull();
    expect(getByTestId('vn-player-vn-other')).toBeTruthy();
  });
});
