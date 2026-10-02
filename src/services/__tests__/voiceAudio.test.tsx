/**
 * B-314-2: production records and plays through expo-audio by default. These
 * tests use no injected port and no registration: they drive the production
 * resolution (`useVoiceRecorder()` / `resolveVoicePlayback()`) against the
 * expo-audio fake (jest.expoAudioMock.js). The honest fallback on a binary
 * without the ExpoAudio native module is pinned in
 * voiceAudioMissingModule.test.tsx (it needs a module registry where
 * expo-audio was never loaded).
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockCapture = jest.fn();
jest.mock('../sentry', () => ({
  captureError: (...a: unknown[]) => mockCapture(...a),
}));

import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { resolveVoicePlayback } from '../../components/community/voicePlaybackPort';
import { downsamplePeaks, normaliseMetering, resetExpoAudioForTests } from '../voiceAudio';

interface FakePlayer {
  source: { uri: string };
  options: { updateInterval: number };
  calls: string[];
  removed: boolean;
  emit(event: string, payload: Record<string, unknown>): void;
}
interface FakeRecorder {
  options: Record<string, unknown>;
  calls: string[];
  durationMillis: number;
  metering: number;
  isRecording: boolean;
  failPrepare: Error | null;
}
interface MockState {
  players: FakePlayer[];
  recorders: FakeRecorder[];
  audioModes: Array<Record<string, unknown>>;
  permission: { granted: boolean; status: string; canAskAgain: boolean };
  requestedPermission: { granted: boolean; status: string; canAskAgain: boolean } | null;
  permissionRequests: number;
  nextRecordingUri: string;
}
const expoAudio: { __mock: { state: MockState; reset(): void } } = jest.requireMock('expo-audio');
const mock = expoAudio.__mock;

const realFetch = global.fetch;

beforeEach(() => {
  mock.reset();
  resetExpoAudioForTests();
  mockCapture.mockReset();
  // The recorder reads the file size from the recorded file itself.
  Object.defineProperty(global, 'fetch', {
    configurable: true,
    writable: true,
    value: jest.fn(async () => ({ blob: async () => ({ size: 48_000 }) })),
  });
});

afterAll(() => {
  Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: realFetch });
});

describe('voice playback: native expo-audio player by default', () => {
  it('resolves the native player and drives createAudioPlayer', async () => {
    const port = resolveVoicePlayback();
    expect(port.isAvailable).toBe(true);
    const onProgress = jest.fn();
    const onEnd = jest.fn();
    const onError = jest.fn();
    const handle = await port.load('https://signed.example/a.m4a', { onProgress, onEnd, onError });

    expect(mock.state.players).toHaveLength(1);
    const player = mock.state.players[0];
    expect(player.source).toEqual({ uri: 'https://signed.example/a.m4a' });
    expect(player.options.updateInterval).toBe(250);
    expect(mock.state.audioModes).toContainEqual({ playsInSilentMode: true });

    await handle.play();
    await handle.seek(1500);
    await handle.pause();
    expect(player.calls).toEqual(['play', 'seekTo:1.5', 'pause']);

    player.emit('playbackStatusUpdate', { currentTime: 2.25, didJustFinish: false, playbackState: 'playing' });
    expect(onProgress).toHaveBeenLastCalledWith(2250);

    player.emit('playbackStatusUpdate', { currentTime: 5, didJustFinish: true, playbackState: 'ended' });
    expect(onEnd).toHaveBeenCalledTimes(1);
    // Rewound so the next Play starts again from the beginning.
    expect(player.calls).toContain('seekTo:0');

    player.emit('playbackStatusUpdate', { currentTime: 0, didJustFinish: false, playbackState: 'failed', error: 'HTTP 403' });
    player.emit('playbackStatusUpdate', { currentTime: 0, didJustFinish: false, playbackState: 'failed', error: 'HTTP 403' });
    expect(onError).toHaveBeenCalledTimes(1);

    await handle.unload();
    await handle.unload();
    expect(player.removed).toBe(true);
    expect(player.calls.filter((c) => c === 'remove')).toHaveLength(1);
  });
});

describe('voice recording: native expo-audio recorder by default', () => {
  it('records an m4a with real duration, bytes, MIME and metering peaks', async () => {
    const { result } = await renderHook(() => useVoiceRecorder());
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('recording');
    const recorder = mock.state.recorders[mock.state.recorders.length - 1];
    expect(recorder.calls).toEqual(['prepare', 'record']);
    expect(recorder.options).toMatchObject({
      extension: '.m4a',
      numberOfChannels: 1,
      bitRate: 64000,
      isMeteringEnabled: true,
    });
    expect(mock.state.audioModes[0]).toEqual({ allowsRecording: true, playsInSilentMode: true });

    recorder.durationMillis = 4200;
    recorder.metering = -15;
    await act(async () => {
      await result.current.stop();
    });
    await waitFor(() => expect(result.current.status).toBe('recorded'));
    expect(result.current.recording).toMatchObject({
      uri: 'file:///cache/recording-1.m4a',
      durationMs: 4200,
      bytes: 48_000,
      mimeType: 'audio/mp4',
    });
    const peaks = result.current.recording?.peaks ?? [];
    expect(peaks[peaks.length - 1]).toBe(0.75);
    expect(peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('file:///cache/recording-1.m4a');
    // Playback routing restored after recording (iOS earpiece otherwise).
    expect(mock.state.audioModes[mock.state.audioModes.length - 1]).toEqual({
      allowsRecording: false,
      playsInSilentMode: true,
    });
  });

  it('prompts when the OS can still ask, and sends a permanent refusal to Settings', async () => {
    mock.state.permission = { granted: false, status: 'denied', canAskAgain: true };
    mock.state.requestedPermission = { granted: false, status: 'denied', canAskAgain: false };
    const { result } = await renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    expect(mock.state.permissionRequests).toBe(1);
    expect(result.current.status).toBe('denied');
    expect(result.current.mustOpenSettings).toBe(true);
  });

  it('a failed prepare is a recoverable error, not a crash', async () => {
    const { result } = await renderHook(() => useVoiceRecorder());
    const recorder = mock.state.recorders[mock.state.recorders.length - 1];
    recorder.failPrepare = new Error('audio session busy');
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('error');
  });

  it('releases the microphone when the composer unmounts mid-recording', async () => {
    const { result, unmount } = await renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    const recorder = mock.state.recorders[mock.state.recorders.length - 1];
    unmount();
    await waitFor(() => expect(recorder.calls).toContain('stop'));
    expect(recorder.isRecording).toBe(false);
  });
});

describe('B-314-7: the default native adapter restores playback mode and owns late starts', () => {
  const playbackMode = { allowsRecording: false, playsInSilentMode: true };
  const lastMode = () => mock.state.audioModes[mock.state.audioModes.length - 1];

  it('a failed prepare puts the session back into playback mode and reports a coded start error', async () => {
    const { result } = await renderHook(() => useVoiceRecorder());
    const recorder = mock.state.recorders[mock.state.recorders.length - 1];
    recorder.failPrepare = new Error('audio session busy');
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.kind).toBe('start');
    expect(lastMode()).toEqual(playbackMode);
    expect(mockCapture).toHaveBeenCalledWith(
      recorder.failPrepare,
      expect.objectContaining({ reason: 'recorder_start' }),
    );
  });

  it('a failed native stop still restores playback mode', async () => {
    const { result } = await renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    const recorder = mock.state.recorders[mock.state.recorders.length - 1] as FakeRecorder & {
      failStop: Error | null;
    };
    recorder.failStop = new Error('encoder failed');
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.kind).toBe('stop');
    expect(lastMode()).toEqual(playbackMode);
  });

  it('a rejected permission read through expo-audio is a coded error, not an unhandled rejection', async () => {
    const audio: { getRecordingPermissionsAsync: () => Promise<unknown> } =
      jest.requireMock('expo-audio');
    const spy = jest
      .spyOn(audio, 'getRecordingPermissionsAsync')
      .mockRejectedValueOnce(new Error('permission service unavailable'));
    const { result } = await renderHook(() => useVoiceRecorder());
    await act(async () => {
      await expect(result.current.start()).resolves.toBeUndefined();
    });
    spy.mockRestore();
    expect(result.current.status).toBe('error');
    expect(result.current.error?.kind).toBe('permission_check');
  });

  it('unmount while prepare is held: the late capture is stopped and playback mode restored', async () => {
    const { result, unmount } = await renderHook(() => useVoiceRecorder());
    const recorder = mock.state.recorders[mock.state.recorders.length - 1] as FakeRecorder & {
      prepareToRecordAsync: () => Promise<void>;
    };
    let release!: () => void;
    recorder.prepareToRecordAsync = () =>
      new Promise<void>((res) => {
        recorder.calls.push('prepare');
        release = res;
      });
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.start();
    });
    await unmount();
    await act(async () => {
      release();
      await pending;
    });
    await waitFor(() => expect(recorder.calls).toEqual(['prepare', 'record', 'stop']));
    expect(recorder.isRecording).toBe(false);
    expect(lastMode()).toEqual(playbackMode);
  });
});

describe('metering helpers', () => {
  it('normalises dBFS into [0,1]', () => {
    expect(normaliseMetering(-160)).toBe(0);
    expect(normaliseMetering(-60)).toBe(0);
    expect(normaliseMetering(-30)).toBe(0.5);
    expect(normaliseMetering(0)).toBe(1);
    expect(normaliseMetering(Number.NaN)).toBe(0);
  });

  it('downsamples to at most 64 peaks, keeping the loudest per bucket', () => {
    const many = Array.from({ length: 640 }, (_, i) => (i % 10 === 0 ? 1 : 0.1));
    const out = downsamplePeaks(many);
    expect(out).toHaveLength(64);
    expect(out.every((p) => p === 1)).toBe(true);
    expect(downsamplePeaks([0.2, 0.4])).toEqual([0.2, 0.4]);
  });
});
