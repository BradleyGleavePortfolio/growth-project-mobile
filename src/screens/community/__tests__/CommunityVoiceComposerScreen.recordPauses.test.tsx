/**
 * OB1 (m#896 AUDIT 6482721065, VF-848C), on the voice composer screen: a voice note is playing on the screen
 * below when the composer opens and starts the take. The note is paused, and shows Play with its place kept,
 * before the take starts; the real composer and player, one shared playback port.
 */
import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communityVoiceNotes: true } }));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: { target: 'hall' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../hooks/useCommunity', () => ({ useCommunityMe: () => ({ data: { workspace_id: 'ws-1' } }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u-me' }) }));
jest.mock('../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => ({ send: jest.fn() }) }));
jest.mock('../../../components/community', () => ({ ThreadHeader: () => null }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

import CommunityVoiceComposerScreen from '../CommunityVoiceComposerScreen';
import VoiceNotePlayer from '../../../components/community/VoiceNotePlayer';
import {
  registerVoicePlayback,
  type VoicePlaybackEvents,
  type VoicePlaybackHandle,
} from '../../../components/community/voicePlaybackPort';
import {
  registerVoiceRecorder,
  type MicPermissionStatus,
  type VoiceRecorderPort,
  type VoiceRecordingResult,
} from '../../../hooks/voiceRecorderPort';

const RESULT: VoiceRecordingResult = {
  uri: 'file:///tmp/rec.m4a',
  durationMs: 4200,
  bytes: 50_000,
  mimeType: 'audio/mp4',
  peaks: [0.2, 0.6],
};
const log: string[] = [];
const events: Record<string, VoicePlaybackEvents> = {};
beforeEach(() => {
  log.length = 0;
  const recorder: VoiceRecorderPort = {
    isAvailable: true,
    getPermissionStatus: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue('granted'),
    requestPermission: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue('granted'),
    start: jest.fn(async () => void log.push('take starts')),
    stop: jest.fn<Promise<VoiceRecordingResult>, []>().mockResolvedValue(RESULT),
    cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
  registerVoiceRecorder(recorder);
  registerVoicePlayback({
    isAvailable: true,
    load: jest.fn(async (_url: string, e: VoicePlaybackEvents) => {
      events.hall = e;
      return {
        play: jest.fn(async () => void log.push('play hall')),
        pause: jest.fn(async () => void log.push('pause hall')),
        seek: jest.fn().mockResolvedValue(undefined),
        unload: jest.fn(async () => void log.push('unload hall')),
      } as jest.Mocked<VoicePlaybackHandle>;
    }),
  });
});
afterAll(() => {
  registerVoicePlayback(null);
  registerVoiceRecorder(null);
});

function Stack({ composing }: { composing: boolean }): React.ReactElement {
  return (
    <View>
      <VoiceNotePlayer url="https://signed.example/hall.m4a" durationMs={20_000} testID="hall-note" />
      {composing ? <CommunityVoiceComposerScreen /> : null}
    </View>
  );
}

it('composer screen: the note playing below is paused and shows Play, its place kept, before the take starts', async () => {
  const s = await render(<Stack composing={false} />);
  const toggle = () => within(s.getByTestId('hall-note')).getByTestId('voice-player-toggle');
  await act(async () => {
    fireEvent.press(toggle());
  });
  await act(async () => events.hall.onProgress?.(6_000));

  await act(async () => s.rerender(<Stack composing />));
  await waitFor(() => expect(log).toContain('take starts'));

  expect(log).toEqual(['play hall', 'pause hall', 'take starts']);
  expect(toggle().props.accessibilityLabel).toBe('Play voice note, 0:20');
  expect(
    within(s.getByTestId('hall-note')).getByTestId('voice-player-duration', { includeHiddenElements: true }).props
      .children,
  ).toBe('0:06 / 0:20');
});
