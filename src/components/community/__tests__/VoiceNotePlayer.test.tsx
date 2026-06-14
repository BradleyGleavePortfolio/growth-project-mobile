/**
 * VoiceNotePlayer — render + degradation tests. Pins:
 *   • a null url → disabled control labelled "Audio unavailable" (no broken
 *     play button);
 *   • no playback adapter bundled → disabled with the honest "not available on
 *     this build" label;
 *   • with an available port + url → play loads + plays via the injected port,
 *     and a second press pauses.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import VoiceNotePlayer from '../VoiceNotePlayer';
import type {
  VoicePlaybackPort,
  VoicePlaybackHandle,
} from '../voicePlaybackPort';

const URL = 'https://signed.example/audio.m4a';

function makePlayback(
  isAvailable = true,
): VoicePlaybackPort & { handle: jest.Mocked<VoicePlaybackHandle> } {
  const handle = {
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    seek: jest.fn().mockResolvedValue(undefined),
    unload: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<VoicePlaybackHandle>;
  return {
    handle,
    isAvailable,
    load: jest.fn().mockResolvedValue(handle),
  };
}

describe('VoiceNotePlayer — degradation', () => {
  it('disables the control with "Audio unavailable" when url is null', async () => {
    const playback = makePlayback(true);
    const { getByTestId } = await render(
      <VoiceNotePlayer url={null} durationMs={4000} playback={playback} />,
    );
    const toggle = getByTestId('voice-player-toggle');
    expect(toggle.props.accessibilityState).toMatchObject({ disabled: true });
    expect(toggle.props.accessibilityLabel).toBe('Audio unavailable');
    expect(
      getByTestId('voice-player-duration', { includeHiddenElements: true }).props
        .children,
    ).toBe('—:—');
  });

  it('disables honestly when no playback adapter is bundled', async () => {
    const playback = makePlayback(false);
    const { getByTestId } = await render(
      <VoiceNotePlayer url={URL} durationMs={4000} playback={playback} />,
    );
    const toggle = getByTestId('voice-player-toggle');
    expect(toggle.props.accessibilityState).toMatchObject({ disabled: true });
    expect(toggle.props.accessibilityLabel).toBe(
      'Audio playback is not available on this build',
    );
  });
});

describe('VoiceNotePlayer — playback', () => {
  it('loads + plays on first press, pauses on the second', async () => {
    const playback = makePlayback(true);
    const { getByTestId } = await render(
      <VoiceNotePlayer url={URL} durationMs={4000} playback={playback} />,
    );
    const toggle = getByTestId('voice-player-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Play voice note, 0:04');

    fireEvent.press(toggle);
    await waitFor(() => expect(playback.load).toHaveBeenCalledWith(URL, expect.any(Object)));
    await waitFor(() => expect(playback.handle.play).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getByTestId('voice-player-toggle').props.accessibilityLabel).toBe(
        'Pause voice note',
      ),
    );

    fireEvent.press(getByTestId('voice-player-toggle'));
    await waitFor(() => expect(playback.handle.pause).toHaveBeenCalledTimes(1));
  });
});
