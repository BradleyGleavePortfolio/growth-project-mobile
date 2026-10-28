/**
 * VUX-B1 (LS-VUX m#886): the signal drops (or the sender taps Try again) while a voice note is playing.
 * The clip keeps playing, so its Pause must keep working; only a new Play is off until the note can load
 * again. Its own file: a clean act environment for every render.
 */
import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
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
import type { VoicePlaybackPort, VoicePlaybackHandle } from '../voicePlaybackPort';

const URL = 'https://signed.example/audio.m4a';

function makePlayback(): VoicePlaybackPort & { handle: jest.Mocked<VoicePlaybackHandle> } {
  const handle = {
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    seek: jest.fn().mockResolvedValue(undefined),
    unload: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<VoicePlaybackHandle>;
  return { handle, isAvailable: true, load: jest.fn().mockResolvedValue(handle) };
}

describe('VoiceNotePlayer — Pause survives a lost signal (VUX-B1)', () => {
  const { StyleSheet } = jest.requireActual('react-native');
  const flat = (n: { props: { style?: unknown } }) => StyleSheet.flatten(n.props.style);

  async function playThen(next: { offline?: boolean; disabled?: boolean }) {
    const playback = makePlayback();
    const view = await render(<VoiceNotePlayer url={URL} durationMs={4000} playback={playback} />);
    await fireEvent.press(view.getByTestId('voice-player-toggle'));
    await waitFor(() =>
      expect(view.getByTestId('voice-player-toggle').props.accessibilityLabel).toBe('Pause voice note'),
    );
    await view.rerender(<VoiceNotePlayer url={URL} durationMs={4000} playback={playback} {...next} />);
    return { ...view, playback };
  }

  it('goes offline while playing: Pause stays usable, then Play is off', async () => {
    const { getByTestId, playback } = await playThen({ offline: true });
    const toggle = getByTestId('voice-player-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Pause voice note');
    expect(toggle.props.accessibilityState).toMatchObject({ disabled: false });
    expect(toggle.props.disabled).toBe(false);
    expect(flat(toggle)).not.toMatchObject({ backgroundColor: '#E2E6E1' });

    await fireEvent.press(toggle);
    await waitFor(() => expect(playback.handle.pause).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getByTestId('voice-player-toggle').props.accessibilityLabel).toBe('Audio unavailable'),
    );
    expect(getByTestId('voice-player-toggle').props.accessibilityState).toMatchObject({ disabled: true });
    // A press offline after the pause starts nothing.
    await fireEvent.press(getByTestId('voice-player-toggle'));
    expect(playback.handle.play).toHaveBeenCalledTimes(1);
    expect(playback.load).toHaveBeenCalledTimes(1);
  });

  it('is held (Try again) while playing: Pause stays usable', async () => {
    const { getByTestId, playback } = await playThen({ disabled: true });
    const toggle = getByTestId('voice-player-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Pause voice note');
    expect(toggle.props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(toggle);
    await waitFor(() => expect(playback.handle.pause).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getByTestId('voice-player-toggle').props.accessibilityState).toMatchObject({ disabled: true }),
    );
    expect(getByTestId('voice-player-toggle').props.accessibilityLabel).toBe('Play voice note, 0:04');
  });

  it('offline from the start: Play stays off', async () => {
    const playback = makePlayback();
    const { getByTestId } = await render(
      <VoiceNotePlayer url={URL} durationMs={4000} playback={playback} offline />,
    );
    const toggle = getByTestId('voice-player-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Audio unavailable');
    expect(toggle.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(toggle);
    await act(async () => undefined);
    expect(playback.load).not.toHaveBeenCalled();
  });
});
