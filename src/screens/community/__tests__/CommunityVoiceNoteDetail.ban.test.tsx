/**
 * VUX-B2 (LS-VUX m#886): a member is banned while a voice note's page is open and playing. The next
 * community read (Me) says the member has no community any more. The page must not keep the note: it asks
 * the server again, shows Loading with the player unloaded and the transcript hidden, and shows the calm
 * not-found when the server says no. A coach (no membership row) and a viewer the server still lets in
 * keep the note.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockParams = { voiceNoteId: 'vn-1', excerpt: 'my squat felt strong today' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: () => undefined, // FR-865R4: the page's forest status band registers on focus
}));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communitySearch: true } }));
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { community_search: true }, isLoading: false, isError: false }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u-viewer' }) }));
jest.mock('../../../components/community', () => ({ ThreadHeader: () => null }));
jest.mock('../../../components/community/SafetyMenu', () => ({ __esModule: true, default: () => null }));
// The real player, with taps delivered straight to onPress.
jest.mock('../../../components/HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) =>
      ReactActual.createElement('HapticPressableHost', props, children),
  };
});
const mockMe: { current: unknown } = { current: null };
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: mockMe.current }),
}));
const mockGetOne = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: { getOne: (...a: unknown[]) => mockGetOne(...a), remove: jest.fn() },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';
import { registerVoicePlayback, type VoicePlaybackHandle } from '../../../components/community/voicePlaybackPort';
import { CommunityApiError } from '../../../api/apiCall';

const NOTE = {
  id: 'vn-1',
  author_id: 'u-author',
  url: 'https://signed.example/vn-1.m4a',
  duration_ms: 42_000,
  waveform_peaks: [0.2, 0.7, 0.4],
  created_at: '2026-10-24T10:00:00Z',
};
const MEMBER = { workspace_id: 'ws-1', membership: { id: 'm-1', role: 'client' } };
const BANNED = { workspace_id: null, membership: null };
const COACH = { workspace_id: 'ws-1', membership: null }; // a coach's Me has their community, no membership row

let handle: jest.Mocked<VoicePlaybackHandle>;
beforeEach(() => {
  handle = {
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    seek: jest.fn().mockResolvedValue(undefined),
    unload: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<VoicePlaybackHandle>;
  registerVoicePlayback({ isAvailable: true, load: jest.fn(async () => handle) });
  mockGetOne.mockReset().mockResolvedValue(NOTE);
});
afterAll(() => registerVoicePlayback(null));

function notFound(): CommunityApiError {
  const http = Object.assign(new Error('Request failed with status code 404'), {
    isAxiosError: true,
    response: { status: 404, data: { code: 'community.voice.not_found' } },
  });
  return new CommunityApiError('unknown', 404, 'voice note', http);
}

async function openAndPlay(me: unknown) {
  mockMe.current = me;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={qc}>
      <CommunityVoiceNoteDetail />
    </QueryClientProvider>
  );
  const view = await render(tree());
  await fireEvent.press(await view.findByTestId('voice-player-toggle'));
  await waitFor(() => expect(view.getByTestId('voice-player-toggle').props.accessibilityLabel).toBe('Pause voice note'));
  expect(view.getByTestId('community-voice-detail-excerpt')).toBeTruthy();
  return { ...view, tree };
}

it('a ban while the page plays: the player unloads, the transcript goes, then the calm not-found', async () => {
  const view = await openAndPlay(MEMBER);
  let refuse: (e: unknown) => void = () => undefined;
  mockGetOne.mockImplementation(() => new Promise((_ok, no) => (refuse = no)));
  mockMe.current = BANNED; // the next Me read after the ban
  await view.rerender(view.tree());

  await waitFor(() => expect(handle.unload).toHaveBeenCalledTimes(1));
  expect(view.getByTestId('community-voice-detail-loading')).toBeTruthy();
  expect(view.queryByTestId('community-voice-detail-excerpt')).toBeNull();
  expect(view.queryByTestId('voice-player-toggle')).toBeNull();
  expect(mockGetOne).toHaveBeenCalledTimes(2);

  await act(async () => refuse(notFound()));
  expect(
    await view.findByText(
      'This voice note is no longer available. It may have been deleted or removed. Go back and refresh.',
    ),
  ).toBeTruthy();
  expect(view.queryByTestId('community-voice-detail-excerpt')).toBeNull();
  expect(view.queryByTestId('voice-player-toggle')).toBeNull();
});

it('a coach keeps playing across a Me refresh; nothing is asked again', async () => {
  const view = await openAndPlay(COACH);
  mockMe.current = { ...COACH, unread: {} }; // a fresh read, same community
  await view.rerender(view.tree());
  await act(async () => undefined);
  expect(mockGetOne).toHaveBeenCalledTimes(1);
  expect(handle.unload).not.toHaveBeenCalled();
  expect(view.getByTestId('voice-player-toggle').props.accessibilityLabel).toBe('Pause voice note');
});

it('the server still lets the viewer hear it: the page comes back after the check', async () => {
  const view = await openAndPlay(MEMBER);
  let allow: (v: unknown) => void = () => undefined;
  mockGetOne.mockImplementation(() => new Promise((ok) => (allow = ok)));
  mockMe.current = BANNED;
  await view.rerender(view.tree());
  await waitFor(() => expect(handle.unload).toHaveBeenCalledTimes(1));
  expect(view.getByTestId('community-voice-detail-loading')).toBeTruthy();

  await act(async () => allow(NOTE));
  expect(await view.findByTestId('community-voice-detail-excerpt')).toBeTruthy();
  expect(view.getByTestId('voice-player-toggle').props.accessibilityLabel).toBe('Play voice note, 0:42');
});
