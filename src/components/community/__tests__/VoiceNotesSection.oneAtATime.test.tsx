/**
 * BF-1 (LS-871X on m#871, VF-848B), in the Hall: Play one member's note, then another's. The first is
 * paused, and shows Play with its place kept, before the second starts; the real players, one shared port.
 */
import React from 'react';
import { act, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import VoiceNotesSection from '../VoiceNotesSection';
import { resetVoiceOutbox } from '../../../hooks/useVoiceOutbox';
import { resetReportedVoiceNotes } from '../VoiceReportedFold';
import {
  registerVoicePlayback,
  type VoicePlaybackEvents,
  type VoicePlaybackHandle,
} from '../voicePlaybackPort';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communityVoiceNotes: true } }));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) =>
      ReactActual.createElement('HapticPressableHost', props, children),
  };
});
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: { membership: { role: 'client' } } }),
}));
jest.mock('../VoiceRecordSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
const mockListFeed = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../../api/communityVoiceApi');
  return { ...actual, communityVoiceApi: { listFeed: (...a: unknown[]) => mockListFeed(...a) } };
});

const note = (id: string, author: string) => ({
  id,
  workspace_id: 'ws-1',
  cohort_id: null,
  conversation_id: null,
  author_id: author,
  url: `https://storage.example.test/${id}`,
  duration_ms: 42_000,
  bytes: 1000,
  mime_type: 'audio/mp4',
  created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
});

const log: string[] = [];
const events: Record<string, VoicePlaybackEvents> = {};
beforeEach(() => {
  log.length = 0;
  resetVoiceOutbox();
  resetReportedVoiceNotes();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockListFeed.mockReset().mockResolvedValue({
    voice_notes: [note('vn-a', 'u-alice'), note('vn-b', 'u-bob')],
    next_cursor: null,
  });
  registerVoicePlayback({
    isAvailable: true,
    load: jest.fn(async (url: string, e: VoicePlaybackEvents) => {
      const name = url.endsWith('vn-a') ? 'A' : 'B';
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

it('Hall: Play A, then Play B — A is paused first and shows Play, its place kept; B plays', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const s = await render(
    <QueryClientProvider client={qc}>
      <VoiceNotesSection workspaceId="ws-1" viewerUserId="u-me" viewerCoachId="u-coach" testID="vn" />
    </QueryClientProvider>,
  );
  const row = (id: string) => within(s.getByTestId(`vn-player-${id}`));
  const toggle = (id: string) => row(id).getByTestId('voice-player-toggle');
  await s.findByTestId('vn-player-vn-b');

  await act(async () => toggle('vn-a').props.onPress());
  await act(async () => events.A.onProgress?.(9_000));
  await act(async () => toggle('vn-b').props.onPress());

  expect(log).toEqual(['play A', 'pause A', 'play B']);
  expect(toggle('vn-a').props.accessibilityLabel).toBe('Play voice note, 0:42');
  expect(row('vn-a').getByTestId('voice-player-duration', { includeHiddenElements: true }).props.children).toBe(
    '0:09 / 0:42',
  );
  expect(toggle('vn-b').props.accessibilityLabel).toBe('Pause voice note');
});
