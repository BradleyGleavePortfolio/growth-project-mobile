/**
 * BF-1 (LS-871X on m#871, VF-848B), on the note's own page: a Hall note is still playing under the page
 * (the Hall stays mounted below it). Play on the page pauses that note first, and it shows Play with its
 * place kept; then the Hall note again pauses the page's.
 */
import React from 'react';
import { View } from 'react-native';
import { act, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { voiceNoteId: 'vn-1', excerpt: 'my squat felt strong today' } }),
}));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communitySearch: true } }));
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { community_search: true }, isLoading: false, isError: false }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u-viewer' }) }));
jest.mock('../../../components/community', () => ({ ThreadHeader: () => null }));
jest.mock('../../../components/community/SafetyMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) =>
      ReactActual.createElement('HapticPressableHost', props, children),
  };
});
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: { workspace_id: 'ws-1', membership: { id: 'm-1', role: 'client' } } }),
}));
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: {
    getOne: jest.fn(async () => ({
      id: 'vn-1',
      author_id: 'u-author',
      url: 'https://signed.example/vn-1.m4a',
      duration_ms: 42_000,
      waveform_peaks: [0.2, 0.7, 0.4],
      created_at: '2026-10-24T10:00:00Z',
    })),
    remove: jest.fn(),
  },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';
import VoiceNotePlayer from '../../../components/community/VoiceNotePlayer';
import {
  registerVoicePlayback,
  type VoicePlaybackEvents,
  type VoicePlaybackHandle,
} from '../../../components/community/voicePlaybackPort';

const log: string[] = [];
const events: Record<string, VoicePlaybackEvents> = {};
beforeEach(() => {
  log.length = 0;
  registerVoicePlayback({
    isAvailable: true,
    load: jest.fn(async (url: string, e: VoicePlaybackEvents) => {
      const name = url.endsWith('vn-1.m4a') ? 'page' : 'hall';
      events[name] = e;
      return {
        play: jest.fn(async () => void log.push(`play ${name}`)),
        pause: jest.fn(async () => void log.push(`pause ${name}`)),
        seek: jest.fn().mockResolvedValue(undefined),
        unload: jest.fn(async () => void log.push(`unload ${name}`)),
      } as jest.Mocked<VoicePlaybackHandle>;
    }),
  });
});
afterAll(() => registerVoicePlayback(null));

it('detail: Play on the page pauses the Hall note first; the Hall note again pauses the page', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const s = await render(
    <QueryClientProvider client={qc}>
      <View>
        <VoiceNotePlayer url="https://signed.example/hall.m4a" durationMs={20_000} testID="hall-note" />
        <CommunityVoiceNoteDetail />
      </View>
    </QueryClientProvider>,
  );
  const toggle = (id: string) => within(s.getByTestId(id)).getByTestId('voice-player-toggle');
  await s.findByTestId('community-voice-detail-player');

  await act(async () => toggle('hall-note').props.onPress());
  await act(async () => events.hall.onProgress?.(5_000));
  await act(async () => toggle('community-voice-detail-player').props.onPress());

  expect(log).toEqual(['play hall', 'pause hall', 'play page']);
  expect(toggle('hall-note').props.accessibilityLabel).toBe('Play voice note, 0:20');
  expect(
    within(s.getByTestId('hall-note')).getByTestId('voice-player-duration', { includeHiddenElements: true }).props
      .children,
  ).toBe('0:05 / 0:20');
  expect(toggle('community-voice-detail-player').props.accessibilityLabel).toBe('Pause voice note');

  await act(async () => toggle('hall-note').props.onPress());
  expect(log).toEqual(['play hall', 'pause hall', 'play page', 'pause page', 'play hall']);
  expect(toggle('community-voice-detail-player').props.accessibilityLabel).toBe('Play voice note, 0:42');
});
