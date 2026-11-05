/**
 * BF-1 (LS-871X on m#871, VF-848B), in the record sheet: a Hall note is playing behind the sheet. Listening
 * back to the new recording pauses that note first, and it shows Play with its place kept.
 */
import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

import VoiceNoteComposer from '../VoiceNoteComposer';
import VoiceNotePlayer from '../VoiceNotePlayer';
import {
  registerVoicePlayback,
  type VoicePlaybackEvents,
  type VoicePlaybackHandle,
} from '../voicePlaybackPort';
import type { MicPermissionStatus, VoiceRecorderPort, VoiceRecordingResult } from '../../../hooks/voiceRecorderPort';

const RESULT: VoiceRecordingResult = {
  uri: 'file:///tmp/rec.m4a',
  durationMs: 4200,
  bytes: 50_000,
  mimeType: 'audio/mp4',
  peaks: [0.2, 0.6, 0.9],
};
const recorder = (): VoiceRecorderPort => ({
  isAvailable: true,
  getPermissionStatus: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue('granted'),
  requestPermission: jest.fn<Promise<MicPermissionStatus>, []>().mockResolvedValue('granted'),
  start: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  stop: jest.fn<Promise<VoiceRecordingResult>, []>().mockResolvedValue(RESULT),
  cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
});

const log: string[] = [];
const events: Record<string, VoicePlaybackEvents> = {};
beforeEach(() => {
  log.length = 0;
  registerVoicePlayback({
    isAvailable: true,
    load: jest.fn(async (url: string, e: VoicePlaybackEvents) => {
      const name = url.startsWith('file:') ? 'preview' : 'hall';
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

it('composer preview: listening back pauses the Hall note first, and it shows Play', async () => {
  const s = await render(
    <View>
      <VoiceNotePlayer url="https://signed.example/hall.m4a" durationMs={20_000} testID="hall-note" />
      <VoiceNoteComposer
        onSend={jest.fn()}
        onClose={jest.fn()}
        target={{ kind: 'cohort', cohortName: 'Spring Block' }}
        recorder={recorder()}
      />
    </View>,
  );
  const toggle = (id: string) => within(s.getByTestId(id)).getByTestId('voice-player-toggle');
  await waitFor(() => expect(s.getByTestId('voice-record-button').props.accessibilityLabel).toMatch(/stop/i));

  await act(async () => {
    fireEvent.press(toggle('hall-note'));
  });
  await act(async () => events.hall.onProgress?.(6_000));
  await act(async () => {
    fireEvent.press(s.getByTestId('voice-record-button'));
  });
  await waitFor(() => expect(s.getByTestId('voice-composer-listen')).toBeTruthy());
  await act(async () => {
    fireEvent.press(toggle('voice-composer-listen'));
  });

  expect(log).toEqual(['play hall', 'pause hall', 'play preview']);
  expect(toggle('hall-note').props.accessibilityLabel).toBe('Play voice note, 0:20');
  expect(
    within(s.getByTestId('hall-note')).getByTestId('voice-player-duration', { includeHiddenElements: true }).props
      .children,
  ).toBe('0:06 / 0:20');
  expect(toggle('voice-composer-listen').props.accessibilityLabel).toBe('Pause voice note');
});
