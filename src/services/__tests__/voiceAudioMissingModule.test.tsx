/**
 * B-314-2: a binary built before expo-audio was added has no ExpoAudio native
 * module, so the real entry module throws at import. The community screens
 * must not crash: playback and recording resolve the honest "not available on
 * this build" adapters, and the stale binary is reported to Sentry once.
 *
 * Nothing in this file imports expo-audio before the flag is set, so the
 * first require of it throws exactly like requireNativeModule('ExpoAudio').
 */
import { renderHook } from '@testing-library/react-native';

const mockCapture = jest.fn();
jest.mock('../sentry', () => ({
  captureError: (...a: unknown[]) => mockCapture(...a),
}));

beforeAll(() => {
  Object.defineProperty(globalThis, '__expoAudioNativeMissing', {
    configurable: true,
    writable: true,
    value: true,
  });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, '__expoAudioNativeMissing');
});

describe('a binary without the ExpoAudio native module', () => {
  it('falls back to the unavailable adapters and reports the stale binary once', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const playbackPort: typeof import('../../components/community/voicePlaybackPort') = require('../../components/community/voicePlaybackPort');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const recorderHook: typeof import('../../hooks/useVoiceRecorder') = require('../../hooks/useVoiceRecorder');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audio: typeof import('../voiceAudio') = require('../voiceAudio');

    expect(audio.loadExpoAudio()).toBeNull();
    expect(playbackPort.resolveVoicePlayback().isAvailable).toBe(false);
    const { result } = await renderHook(() => recorderHook.useVoiceRecorder());
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.status).toBe('unavailable');

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][1]).toEqual({
      area: 'community.voice',
      reason: 'expo_audio_native_module_missing',
    });
  });
});
