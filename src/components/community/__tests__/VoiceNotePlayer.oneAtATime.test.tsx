/**
 * BF-1 (LS-871X on m#871, VF-848B): one voice note plays at a time. Play A, then Play B: A is paused, and
 * shows Play with its place kept, before B starts; A plays on from there when tapped again. Pins, on one
 * shared port, on two separate ports and on the real expo-audio adapter (jest.expoAudioMock.js):
 *   • a note still loading when another starts never plays when its load lands (late load);
 *   • tapping that loading note again takes the turn back: it plays when it lands, the other does not;
 *   • a note whose start is still in flight when another takes over ends paused, showing Play;
 *   • a note that paused, ended or unloaded is left alone, and an unload never restarts a paused note.
 */
import React from 'react';
import { View } from 'react-native';
import { act, render, within } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
// The real player, with taps delivered straight to onPress (as in VoiceNotePlayer.test).
jest.mock('../../HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) =>
      ReactActual.createElement('HapticPressableHost', props, children),
  };
});

import VoiceNotePlayer from '../VoiceNotePlayer';
import { registerVoicePlayback, type VoicePlaybackEvents, type VoicePlaybackHandle, type VoicePlaybackPort } from '../voicePlaybackPort';
import { resetExpoAudioForTests } from '../../../services/voiceAudio';

const A = 'https://signed.example/a.m4a';
const B = 'https://signed.example/b.m4a';
const nameOf = (url: string) => (url === A ? 'A' : 'B');

interface Clip {
  handle: jest.Mocked<VoicePlaybackHandle>;
  events: VoicePlaybackEvents;
  land: () => void;
  /** Lets a held play() finish (only for a url in `heldPlays`). */
  started: () => void;
}

/** A port with one handle per load; every play / pause / unload goes in `log`, in order. */
function makePort(log: string[], o: { holdLoads?: boolean; heldPlays?: string[] } = {}) {
  const clips: Record<string, Clip[]> = {};
  const port: VoicePlaybackPort = {
    isAvailable: true,
    load: jest.fn(
      (url: string, events: VoicePlaybackEvents) =>
        new Promise<VoicePlaybackHandle>((resolve) => {
          let started = () => undefined as void;
          const handle = {
            play: jest.fn(() => {
              log.push(`play ${nameOf(url)}`);
              return o.heldPlays?.includes(url)
                ? new Promise<void>((done) => (started = () => done()))
                : Promise.resolve();
            }),
            pause: jest.fn(async () => {
              log.push(`pause ${nameOf(url)}`);
            }),
            seek: jest.fn().mockResolvedValue(undefined),
            unload: jest.fn(async () => {
              log.push(`unload ${nameOf(url)}`);
            }),
          } as jest.Mocked<VoicePlaybackHandle>;
          const clip: Clip = { handle, events, land: () => resolve(handle), started: () => started() };
          (clips[url] ??= []).push(clip);
          if (!o.holdLoads) clip.land();
        }),
    ),
  };
  return { port, clips };
}

function Two(p: { a?: VoicePlaybackPort; b?: VoicePlaybackPort; showA?: boolean; showB?: boolean }) {
  return (
    <View>
      {p.showA === false ? null : <VoiceNotePlayer url={A} durationMs={12_000} playback={p.a} testID="note-a" />}
      {p.showB === false ? null : <VoiceNotePlayer url={B} durationMs={20_000} playback={p.b} testID="note-b" />}
    </View>
  );
}

type Screen = Awaited<ReturnType<typeof render>>;
const toggle = (s: Screen, id: string) => within(s.getByTestId(id)).getByTestId('voice-player-toggle');
const label = (s: Screen, id: string) => toggle(s, id).props.accessibilityLabel;
const time = (s: Screen, id: string) =>
  within(s.getByTestId(id)).getByTestId('voice-player-duration', { includeHiddenElements: true }).props.children;
const tap = async (s: Screen, id: string) => {
  await act(async () => {
    toggle(s, id).props.onPress?.();
  });
};
const PLAY_A = 'Play voice note, 0:12';
const PLAY_B = 'Play voice note, 0:20';
const PAUSE = 'Pause voice note';

describe('one voice note plays at a time (BF-1)', () => {
  it('Play A, then Play B: A is paused first and shows Play, its place kept', async () => {
    const log: string[] = [];
    const { port, clips } = makePort(log);
    const s = await render(<Two a={port} b={port} />);
    await tap(s, 'note-a');
    await act(async () => clips[A][0].events.onProgress?.(4_000));
    await tap(s, 'note-b');
    expect(log).toEqual(['play A', 'pause A', 'play B']);
    expect(label(s, 'note-a')).toBe(PLAY_A);
    expect(time(s, 'note-a')).toBe('0:04 / 0:12');
    expect(label(s, 'note-b')).toBe(PAUSE);
    expect(clips[A][0].handle.unload).not.toHaveBeenCalled();
  });

  it('the same when each note has its own port', async () => {
    const log: string[] = [];
    const s = await render(<Two a={makePort(log).port} b={makePort(log).port} />);
    await tap(s, 'note-a');
    await tap(s, 'note-b');
    expect(log).toEqual(['play A', 'pause A', 'play B']);
    expect(label(s, 'note-a')).toBe(PLAY_A);
    expect(label(s, 'note-b')).toBe(PAUSE);
  });

  it('A plays on from its place when tapped again, and B pauses first', async () => {
    const log: string[] = [];
    const { port } = makePort(log);
    const s = await render(<Two a={port} b={port} />);
    await tap(s, 'note-a');
    await tap(s, 'note-b');
    await tap(s, 'note-a');
    expect(log).toEqual(['play A', 'pause A', 'play B', 'pause B', 'play A']);
    expect(port.load).toHaveBeenCalledTimes(2); // A was kept, not loaded again
    expect(label(s, 'note-a')).toBe(PAUSE);
    expect(label(s, 'note-b')).toBe(PLAY_B);
  });

  it('B while A is still loading: B plays, and A never plays when its load lands (late load)', async () => {
    const log: string[] = [];
    const { port, clips } = makePort(log, { holdLoads: true });
    const s = await render(<Two a={port} b={port} />);
    await tap(s, 'note-a');
    expect(within(s.getByTestId('note-a')).queryByTestId('voice-player-loading')).toBeTruthy();
    await tap(s, 'note-b');
    // A's spinner gives way to Play the moment B takes over.
    expect(within(s.getByTestId('note-a')).queryByTestId('voice-player-loading')).toBeNull();
    expect(label(s, 'note-a')).toBe(PLAY_A);
    await act(async () => clips[B][0].land());
    await act(async () => clips[A][0].land());
    expect(log).toEqual(['play B']);
    expect(within(s.getByTestId('note-a')).queryByTestId('voice-player-loading')).toBeNull();
    expect(label(s, 'note-a')).toBe(PLAY_A);
    expect(label(s, 'note-b')).toBe(PAUSE);
    // The clip that landed late is kept: tapping A plays it without a second load.
    await tap(s, 'note-a');
    expect(log).toEqual(['play B', 'pause B', 'play A']);
    expect(port.load).toHaveBeenCalledTimes(2);
  });

  it('tapping the loading note again takes the turn back: it plays when it lands, the other does not', async () => {
    const log: string[] = [];
    const { port, clips } = makePort(log, { holdLoads: true });
    const s = await render(<Two a={port} b={port} />);
    await tap(s, 'note-a');
    await tap(s, 'note-b');
    expect(toggle(s, 'note-a').props.disabled).toBe(false); // A can be tapped again while its load runs
    await tap(s, 'note-a');
    await act(async () => clips[A][0].land());
    await act(async () => clips[B][0].land());
    expect(log).toEqual(['play A']);
    expect(port.load).toHaveBeenCalledTimes(2);
    expect(label(s, 'note-a')).toBe(PAUSE);
    expect(label(s, 'note-b')).toBe(PLAY_B);
  });

  it('a note whose start is still in flight when B starts ends paused, showing Play', async () => {
    const log: string[] = [];
    const { port, clips } = makePort(log, { heldPlays: [A] });
    const s = await render(<Two a={port} b={port} />);
    await tap(s, 'note-a');
    await tap(s, 'note-b');
    await act(async () => clips[A][0].started());
    expect(log[log.length - 1]).toBe('pause A');
    expect(log.filter((l) => l === 'play B')).toHaveLength(1);
    expect(label(s, 'note-a')).toBe(PLAY_A);
    expect(label(s, 'note-b')).toBe(PAUSE);
  });

  it('a note that was paused or ended is left alone when the next one starts', async () => {
    const log: string[] = [];
    const { port, clips } = makePort(log);
    const s = await render(<Two a={port} b={port} />);
    await tap(s, 'note-a');
    await tap(s, 'note-a'); // the listener's own pause
    await tap(s, 'note-b');
    await act(async () => clips[B][0].events.onEnd?.());
    await tap(s, 'note-a');
    expect(log).toEqual(['play A', 'pause A', 'play B', 'play A']);
    expect(label(s, 'note-a')).toBe(PAUSE);
    expect(label(s, 'note-b')).toBe(PLAY_B);
  });

  it('unload: the note that left gives its turn back, and it never restarts a paused note', async () => {
    const log: string[] = [];
    const { port } = makePort(log);
    const s = await render(<Two a={port} b={port} />);
    await tap(s, 'note-a');
    await tap(s, 'note-b');
    await s.rerender(<Two a={port} b={port} showB={false} />); // B scrolls away while it plays
    expect(log).toEqual(['play A', 'pause A', 'play B', 'unload B']);
    expect(label(s, 'note-a')).toBe(PLAY_A);
    await s.rerender(<Two a={port} b={port} />);
    await tap(s, 'note-b'); // a fresh B: nothing reaches A's paused clip again, nor B's old one
    expect(log).toEqual(['play A', 'pause A', 'play B', 'unload B', 'play B']);
  });
});

describe('one voice note plays at a time on the expo-audio adapter (BF-1)', () => {
  interface FakePlayer {
    source: { uri: string };
    calls: string[];
  }
  const mock: { state: { players: FakePlayer[] }; reset(): void } = jest.requireMock('expo-audio').__mock;

  beforeEach(() => {
    mock.reset();
    resetExpoAudioForTests();
    registerVoicePlayback(null);
  });

  it('Play A, then Play B: the first native player is paused before the second plays', async () => {
    const s = await render(<Two />);
    await tap(s, 'note-a');
    await tap(s, 'note-b');
    const [a, b] = mock.state.players;
    expect(a.source).toEqual({ uri: A });
    expect(a.calls).toEqual(['play', 'pause']);
    expect(b.calls).toEqual(['play']);
    expect(label(s, 'note-a')).toBe(PLAY_A);
    expect(label(s, 'note-b')).toBe(PAUSE);
  });
});
