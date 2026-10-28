/**
 * BF-1 (LS-871X on m#871, VF-848B), in the coach's report queue: two reported voice notes. Play the first,
 * then the second: the first is paused, and shows Play with its place kept, before the second starts.
 */
import React from 'react';
import { act, render, within } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../components/HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) =>
      ReactActual.createElement('HapticPressableHost', props, children),
  };
});

const mockItem1 = '11111111-1111-4111-8111-111111111111';
const mockItem2 = '22222222-2222-4222-8222-222222222222';
const mockVoiceItem = (id: string, url: string, durationMs: number) => ({
  id,
  target_type: 'voice_note',
  target_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  content: '',
  author_name: 'Maya Patel',
  cohort_name: 'Spring block',
  reason: 'spam',
  removed: false,
  created_at: new Date(Date.now() - 7_200_000).toISOString(),
  media: { kind: 'voice_note', url, duration_ms: durationMs, mime_type: 'audio/mp4' },
});
jest.mock('../../../hooks/useCoachCommunity', () => ({
  useCoachFlagged: () => ({
    data: [
      mockVoiceItem(mockItem1, 'https://storage.example.test/first.m4a', 30_000),
      mockVoiceItem(mockItem2, 'https://storage.example.test/second.m4a', 15_000),
    ],
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
  useModerateFlagged: () => ({ mutate: jest.fn(), isPending: false }),
  useCoachEmptyStatePayload: () => ({
    status: 'ready',
    payload: {
      text: 'TEST_EMPTY_MODERATION_COPY',
      avatar_crop: 'smile',
      surface_key: 'coach_community_moderation_empty',
      voice_variant: 'roman_v2',
    },
  }),
}));

import CoachCommunityModerationScreen from '../CoachCommunityModerationScreen';
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
      const name = url.endsWith('first.m4a') ? 'first' : 'second';
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

it('moderation: Play the first reported note, then the second — the first is paused first and shows Play', async () => {
  const s = await render(<CoachCommunityModerationScreen />);
  const player = (id: string) => within(s.getByTestId(`coach-community-flagged-player-${id}`));
  const toggle = (id: string) => player(id).getByTestId('voice-player-toggle');

  await act(async () => toggle(mockItem1).props.onPress());
  await act(async () => events.first.onProgress?.(12_000));
  await act(async () => toggle(mockItem2).props.onPress());

  expect(log).toEqual(['play first', 'pause first', 'play second']);
  expect(toggle(mockItem1).props.accessibilityLabel).toBe('Play voice note, 0:30');
  expect(player(mockItem1).getByTestId('voice-player-duration', { includeHiddenElements: true }).props.children).toBe(
    '0:12 / 0:30',
  );
  expect(toggle(mockItem2).props.accessibilityLabel).toBe('Pause voice note');
});
