import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

jest.mock('../../HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) =>
      ReactActual.createElement('HapticPressableHost', props, children),
  };
});

import VoiceNotePlayer from '../VoiceNotePlayer';
import type { VoicePlaybackHandle, VoicePlaybackPort } from '../voicePlaybackPort';

it('LS871R7 BF-1: playing the next voice note stops the earlier note', async () => {
  const playing = new Set<number>();
  const handles: VoicePlaybackHandle[] = [0, 1].map((id) => ({
    play: jest.fn(async () => { playing.add(id); }),
    pause: jest.fn(async () => { playing.delete(id); }),
    seek: jest.fn(async () => undefined),
    unload: jest.fn(async () => { playing.delete(id); }),
  }));
  let nextHandle = 0;
  const playback: VoicePlaybackPort = {
    isAvailable: true,
    load: jest.fn(async () => handles[nextHandle++]),
  };
  const screen = await render(
    <>
      <VoiceNotePlayer url="https://signed.example/first.m4a" durationMs={4000} playback={playback} />
      <VoiceNotePlayer url="https://signed.example/second.m4a" durationMs={6000} playback={playback} />
    </>,
  );
  fireEvent.press(screen.getAllByTestId('voice-player-toggle')[0]);
  await waitFor(() => expect(playing).toEqual(new Set([0])));
  fireEvent.press(screen.getAllByTestId('voice-player-toggle')[1]);
  await waitFor(() => expect(playing.has(1)).toBe(true));
  expect(playing).toEqual(new Set([1]));
});
