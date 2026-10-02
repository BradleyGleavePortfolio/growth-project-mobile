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

/**
 * B-314-5: the loaded clip is keyed to its URL. A refreshed signed URL (queue
 * refetch after an expired link) must be the one that plays; the old clip is
 * released; a failed clip is dropped so Retry reloads; a load that resolves
 * after the URL changed is released, never adopted.
 */
describe('VoiceNotePlayer — signed URL lifecycle (B-314-5)', () => {
  function makeSequencedPlayback() {
    const handles: Array<jest.Mocked<VoicePlaybackHandle>> = [];
    const events: Array<{ onError?: (e: unknown) => void; onEnd?: () => void }> = [];
    const port: VoicePlaybackPort & { load: jest.Mock } = {
      isAvailable: true,
      load: jest.fn(async (_url: string, ev: { onError?: (e: unknown) => void }) => {
        const handle = {
          play: jest.fn().mockResolvedValue(undefined),
          pause: jest.fn().mockResolvedValue(undefined),
          seek: jest.fn().mockResolvedValue(undefined),
          unload: jest.fn().mockResolvedValue(undefined),
        } as jest.Mocked<VoicePlaybackHandle>;
        handles.push(handle);
        events.push(ev);
        return handle;
      }),
    };
    return { port, handles, events };
  }

  it('releases the old clip on a new URL and plays the new URL on the next press', async () => {
    const { port, handles } = makeSequencedPlayback();
    const { getByTestId, rerender } = await render(
      <VoiceNotePlayer url={URL} durationMs={5000} playback={port} />,
    );
    fireEvent.press(getByTestId('voice-player-toggle'));
    await waitFor(() => expect(handles[0]?.play).toHaveBeenCalledTimes(1));
    expect(port.load).toHaveBeenLastCalledWith(URL, expect.any(Object));

    const FRESH = 'https://signed.example/audio.m4a?token=fresh';
    await rerender(<VoiceNotePlayer url={FRESH} durationMs={5000} playback={port} />);
    await waitFor(() => expect(handles[0].unload).toHaveBeenCalledTimes(1));
    // The control is reset, not stuck on "playing" the released clip.
    expect(getByTestId('voice-player-toggle').props.accessibilityLabel).toBe(
      'Play voice note, 0:05',
    );

    fireEvent.press(getByTestId('voice-player-toggle'));
    await waitFor(() => expect(port.load).toHaveBeenCalledTimes(2));
    expect(port.load).toHaveBeenLastCalledWith(FRESH, expect.any(Object));
    await waitFor(() => expect(handles[1].play).toHaveBeenCalledTimes(1));
  });

  it('drops a failed clip so Retry reloads, and asks the parent for a fresh URL', async () => {
    const { port, handles, events } = makeSequencedPlayback();
    const onPlaybackError = jest.fn();
    const { getByTestId, findByTestId } = await render(
      <VoiceNotePlayer
        url={URL}
        durationMs={5000}
        playback={port}
        onPlaybackError={onPlaybackError}
      />,
    );
    fireEvent.press(getByTestId('voice-player-toggle'));
    await waitFor(() => expect(handles[0]?.play).toHaveBeenCalled());
    // The native player reports the expired link.
    events[0].onError?.(new Error('403'));
    const error = await findByTestId('voice-player-error');
    expect(error.props.children).toBe('Could not play this voice note. Tap play to try again.');
    expect(handles[0].unload).toHaveBeenCalledTimes(1);
    expect(onPlaybackError).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('voice-player-toggle'));
    await waitFor(() => expect(port.load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(handles[1].play).toHaveBeenCalledTimes(1));
  });

  it('releases a load that resolves after the URL changed', async () => {
    let resolveLoad: (h: VoicePlaybackHandle) => void = () => undefined;
    const late = {
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn().mockResolvedValue(undefined),
      seek: jest.fn().mockResolvedValue(undefined),
      unload: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<VoicePlaybackHandle>;
    const port: VoicePlaybackPort = {
      isAvailable: true,
      load: jest.fn(() => new Promise<VoicePlaybackHandle>((r) => (resolveLoad = r))),
    };
    const { getByTestId, rerender } = await render(
      <VoiceNotePlayer url={URL} durationMs={5000} playback={port} />,
    );
    fireEvent.press(getByTestId('voice-player-toggle'));
    await waitFor(() => expect(port.load).toHaveBeenCalledTimes(1));
    await rerender(<VoiceNotePlayer url={`${URL}?v=2`} durationMs={5000} playback={port} />);
    resolveLoad(late);
    await waitFor(() => expect(late.unload).toHaveBeenCalledTimes(1));
    expect(late.play).not.toHaveBeenCalled();
  });

  it('releases the clip on unmount', async () => {
    const { port, handles } = makeSequencedPlayback();
    const { getByTestId, unmount } = await render(
      <VoiceNotePlayer url={URL} durationMs={5000} playback={port} />,
    );
    fireEvent.press(getByTestId('voice-player-toggle'));
    await waitFor(() => expect(handles[0]?.play).toHaveBeenCalled());
    await unmount();
    expect(handles[0].unload).toHaveBeenCalledTimes(1);
  });
});
