/**
 * OB1 (m#896 AUDIT 6482721065, VF-848C), in the Hall: a member's note is playing and the viewer taps Record.
 * The note is paused, and shows Play with its place kept, before the take starts; the real players, the real
 * record sheet, one shared playback port.
 */
import React from 'react';
import { act, render, waitFor, within } from '@testing-library/react-native';
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
import {
  registerVoiceRecorder,
  type MicPermissionStatus,
  type VoiceRecorderPort,
  type VoiceRecordingResult,
} from '../../../hooks/voiceRecorderPort';

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
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: { membership: { role: 'client' } } }),
}));
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
const RESULT: VoiceRecordingResult = {
  uri: 'file:///tmp/rec.m4a',
  durationMs: 4200,
  bytes: 50_000,
  mimeType: 'audio/mp4',
  peaks: [0.2, 0.6, 0.9],
};

const log: string[] = [];
const events: Record<string, VoicePlaybackEvents> = {};
const recorder = (): VoiceRecorderPort => ({
  isAvailable: true,
  getPermissionStatus: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue('granted'),
  requestPermission: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue('granted'),
  start: jest.fn(async () => void log.push('take starts')),
  stop: jest.fn<Promise<VoiceRecordingResult>, []>().mockResolvedValue(RESULT),
  cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
});
beforeEach(() => {
  log.length = 0;
  resetVoiceOutbox();
  resetReportedVoiceNotes();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockListFeed.mockReset().mockResolvedValue({ voice_notes: [note('vn-a', 'u-alice')], next_cursor: null });
  registerVoiceRecorder(recorder());
  registerVoicePlayback({
    isAvailable: true,
    load: jest.fn(async (url: string, e: VoicePlaybackEvents) => {
      const name = url.startsWith('file:') ? 'preview' : 'A';
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
afterAll(() => {
  registerVoicePlayback(null);
  registerVoiceRecorder(null);
});

it('Hall: A is playing, tap Record — A is paused first and shows Play, its place kept; then the take starts', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const s = await render(
    <QueryClientProvider client={qc}>
      <VoiceNotesSection workspaceId="ws-1" viewerUserId="u-me" viewerCoachId="u-coach" testID="vn" />
    </QueryClientProvider>,
  );
  const row = within(await s.findByTestId('vn-player-vn-a'));
  const toggle = () => row.getByTestId('voice-player-toggle');

  await act(async () => toggle().props.onPress());
  await act(async () => events.A.onProgress?.(9_000));
  await act(async () => s.getByTestId('vn-record').props.onPress());
  await waitFor(() => expect(log).toContain('take starts'));

  expect(log).toEqual(['play A', 'pause A', 'take starts']);
  expect(toggle().props.accessibilityLabel).toBe('Play voice note, 0:42');
  expect(row.getByTestId('voice-player-duration', { includeHiddenElements: true }).props.children).toBe(
    '0:09 / 0:42',
  );
});
