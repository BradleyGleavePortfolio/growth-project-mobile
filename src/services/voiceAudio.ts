/**
 * voiceAudio — the real native recorder and player behind the voice-note
 * ports (B-314-2), built on expo-audio (Expo SDK 56, `~56.0.12`).
 *
 * The ports (src/hooks/voiceRecorderPort.ts, src/components/community/
 * voicePlaybackPort.ts) stay the seam the UI depends on. This module is what
 * production resolves by default:
 *   - `useNativeVoiceRecorder()` wraps expo-audio's `useAudioRecorder` in a
 *     VoiceRecorderPort (permission, start, stop with duration / bytes / MIME /
 *     metering peaks, cancel). `useVoiceRecorder` calls it on every render.
 *   - `nativeVoicePlayback()` returns a VoicePlaybackPort over
 *     `createAudioPlayer` (play, pause, seek, unload, progress / end / error).
 *
 * expo-audio is loaded lazily inside try/catch: its entry module calls
 * `requireNativeModule('ExpoAudio')`, which throws on a binary built before
 * the dependency was added. Then both functions return null and the ports
 * fall back to their honest "not available on this build" adapters, instead of
 * crashing the community screens. The missing module is reported to Sentry
 * once so a stale binary is visible.
 *
 * Recording format: AAC in an MPEG-4 container (.m4a, `audio/mp4`), mono,
 * 44.1 kHz, 64 kbps. That is inside the server allowlist (audio/mp4) and about
 * 2.4 MB for the 5 minute maximum, far under the 25 MB cap.
 */
import { Platform } from 'react-native';
import { useMemo } from 'react';
import type * as ExpoAudioModule from 'expo-audio';
import type {
  AudioPlayer,
  AudioRecorder,
  AudioStatus,
  PermissionResponse,
  RecordingOptions,
} from 'expo-audio';
import { captureError } from './sentry';
import type {
  MicPermissionStatus,
  VoiceRecorderPort,
  VoiceRecordingResult,
} from '../hooks/voiceRecorderPort';
import type {
  VoicePlaybackEvents,
  VoicePlaybackHandle,
  VoicePlaybackPort,
} from '../components/community/voicePlaybackPort';
import type { VoiceNoteMimeType } from '../api/communityVoiceApi';

type ExpoAudio = typeof ExpoAudioModule;

let loaded: ExpoAudio | null | undefined;

/**
 * The expo-audio module, or null when this binary has no ExpoAudio native
 * module. Resolved once and cached, so the answer is stable for the process
 * (which keeps the recorder hook's hook order stable).
 */
export function loadExpoAudio(): ExpoAudio | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: ExpoAudio = require('expo-audio');
    loaded = mod;
  } catch (err) {
    loaded = null;
    captureError(err, { area: 'community.voice', reason: 'expo_audio_native_module_missing' });
  }
  return loaded;
}

/** Test seam: forget the cached module so a test can load a different mock. */
export function resetExpoAudioForTests(): void {
  loaded = undefined;
  recorderImpl = null;
  playback = undefined;
}

/**
 * Report a failed best-effort native call (audio mode switch, rewind, player
 * or recorder release) to Sentry. These never block the member, but a pattern
 * of them on a device family is worth seeing.
 */
export function reportVoiceAudioCleanup(step: string): (err: unknown) => void {
  return (err: unknown) => captureError(err, { area: 'community.voice', step });
}

/** Thrown when the native recorder finished without a file to send. */
export class VoiceRecordingFileMissingError extends Error {
  constructor() {
    super('the recorder stopped without producing a file');
    this.name = 'VoiceRecordingFileMissingError';
    Object.setPrototypeOf(this, VoiceRecordingFileMissingError.prototype);
  }
}

/** Thrown (or passed to onError) when the native player reports a failure. */
export class VoicePlaybackNativeError extends Error {
  constructor(detail: string) {
    super(`voice playback failed: ${detail}`);
    this.name = 'VoicePlaybackNativeError';
    Object.setPrototypeOf(this, VoicePlaybackNativeError.prototype);
  }
}

// ─── Recorder ───────────────────────────────────────────────────────────────

/** Metering is sampled this often while recording (waveform resolution). */
export const METER_INTERVAL_MS = 100;
/** The waveform keeps at most this many peaks (evenly downsampled). */
export const MAX_PEAKS = 64;
/** dBFS floor treated as silence when normalising metering to [0,1]. */
const METER_FLOOR_DB = -60;

export function recordingOptions(audio: ExpoAudio): RecordingOptions {
  return {
    ...audio.RecordingPresets.HIGH_QUALITY,
    extension: '.m4a',
    numberOfChannels: 1,
    sampleRate: 44100,
    bitRate: 64000,
    isMeteringEnabled: true,
  };
}

/** The MIME type of what `recordingOptions` produces on this platform. */
export function recordingMimeType(): VoiceNoteMimeType {
  return Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
}

/** dBFS (about -160..0) to a [0,1] amplitude for the waveform. */
export function normaliseMetering(db: number): number {
  if (!Number.isFinite(db)) return 0;
  if (db <= METER_FLOOR_DB) return 0;
  if (db >= 0) return 1;
  return Math.round(((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 1000) / 1000;
}

/** Evenly downsample to at most `max` points (keeps the loudest in each bucket). */
export function downsamplePeaks(peaks: number[], max: number = MAX_PEAKS): number[] {
  if (peaks.length <= max) return peaks.slice();
  const out: number[] = [];
  const size = peaks.length / max;
  for (let i = 0; i < max; i += 1) {
    const from = Math.floor(i * size);
    const to = Math.max(from + 1, Math.floor((i + 1) * size));
    let loudest = 0;
    for (let j = from; j < to; j += 1) loudest = Math.max(loudest, peaks[j]);
    out.push(loudest);
  }
  return out;
}

function toMicStatus(p: PermissionResponse): MicPermissionStatus {
  if (p.granted) return 'granted';
  // Android reports 'denied' after one refusal but can still show the prompt;
  // only a permanent refusal (canAskAgain false) must send people to Settings.
  if (p.status === 'undetermined' || p.canAskAgain) return 'undetermined';
  return 'denied';
}

/** Size of the recorded file in bytes, read from the file itself. */
async function fileBytes(uri: string): Promise<number> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return blob.size;
}

/**
 * A VoiceRecorderPort over one expo-audio AudioRecorder. Exported for tests;
 * production gets it through `useNativeVoiceRecorder`.
 */
export function createExpoRecorderPort(audio: ExpoAudio, recorder: AudioRecorder): VoiceRecorderPort {
  let meter: ReturnType<typeof setInterval> | null = null;
  let startedAt: number | null = null;
  let lastDurationMs = 0;
  let peaks: number[] = [];

  const stopMeter = () => {
    if (meter !== null) clearInterval(meter);
    meter = null;
  };
  const sample = () => {
    const s = recorder.getStatus();
    if (s.durationMillis > 0) lastDurationMs = s.durationMillis;
    if (typeof s.metering === 'number') peaks.push(normaliseMetering(s.metering));
  };
  // Recording mode routes iOS output to the earpiece; put it back for playback.
  // Best-effort: a failed mode switch must not lose the recording.
  const restorePlaybackMode = () =>
    audio
      .setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
      .catch(reportVoiceAudioCleanup('restore_playback_mode'));

  return {
    isAvailable: true,
    async getPermissionStatus() {
      return toMicStatus(await audio.getRecordingPermissionsAsync());
    },
    async requestPermission() {
      const p = await audio.requestRecordingPermissionsAsync();
      return p.granted ? 'granted' : 'denied';
    },
    async start() {
      // B-314-7: if switching into recording mode, preparing or starting
      // fails, put the session back into playback mode before rethrowing, so
      // later voice notes do not play from the iOS earpiece.
      try {
        await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch (err) {
        await restorePlaybackMode();
        throw err;
      }
      startedAt = Date.now();
      lastDurationMs = 0;
      peaks = [];
      stopMeter();
      meter = setInterval(sample, METER_INTERVAL_MS);
    },
    async stop(): Promise<VoiceRecordingResult> {
      sample();
      stopMeter();
      const wallMs = startedAt === null ? 0 : Date.now() - startedAt;
      startedAt = null;
      try {
        await recorder.stop();
      } finally {
        // B-314-7: restored whether or not the native stop succeeded.
        await restorePlaybackMode();
      }
      const uri = recorder.uri;
      if (!uri) throw new VoiceRecordingFileMissingError();
      const bytes = await fileBytes(uri);
      return {
        uri,
        durationMs: Math.round(lastDurationMs > 0 ? lastDurationMs : wallMs),
        bytes,
        mimeType: recordingMimeType(),
        peaks: downsamplePeaks(peaks),
      };
    },
    async cancel() {
      stopMeter();
      startedAt = null;
      peaks = [];
      try {
        if (recorder.isRecording) await recorder.stop();
      } finally {
        await restorePlaybackMode();
      }
    },
  };
}

function makeExpoRecorderHook(audio: ExpoAudio): () => VoiceRecorderPort {
  return function useExpoRecorderPort(): VoiceRecorderPort {
    const options = useMemo(() => recordingOptions(audio), []);
    const recorder = audio.useAudioRecorder(options);
    return useMemo(() => createExpoRecorderPort(audio, recorder), [recorder]);
  };
}

const noNativeRecorder = (): VoiceRecorderPort | null => null;

let recorderImpl: (() => VoiceRecorderPort | null) | null = null;

/**
 * The native recorder for this render, or null on a binary without
 * expo-audio. The implementation is chosen once per process (the module is
 * either there or not), so the hooks it calls run in the same order on every
 * render.
 */
export function useNativeVoiceRecorder(): VoiceRecorderPort | null {
  if (recorderImpl === null) {
    const audio = loadExpoAudio();
    recorderImpl = audio ? makeExpoRecorderHook(audio) : noNativeRecorder;
  }
  return recorderImpl();
}

// ─── Player ─────────────────────────────────────────────────────────────────

/** Progress events arrive this often while playing. */
export const PLAYBACK_UPDATE_INTERVAL_MS = 250;

function statusError(s: AudioStatus): string | null {
  // AudioStatus carries an untyped `error` on load / transport failures, and
  // iOS also reports playbackState 'failed'.
  if ('error' in s && typeof s.error === 'string' && s.error.length > 0) return s.error;
  if (s.playbackState === 'failed') return 'playbackState failed';
  return null;
}

/** A VoicePlaybackPort over expo-audio's createAudioPlayer. */
export function createExpoPlaybackPort(audio: ExpoAudio): VoicePlaybackPort {
  return {
    isAvailable: true,
    async load(url: string, events: VoicePlaybackEvents): Promise<VoicePlaybackHandle> {
      // Best-effort: without it a silenced iPhone plays nothing, but the
      // player itself still works.
      await audio
        .setAudioModeAsync({ playsInSilentMode: true })
        .catch(reportVoiceAudioCleanup('playback_mode'));
      const player: AudioPlayer = audio.createAudioPlayer(
        { uri: url },
        { updateInterval: PLAYBACK_UPDATE_INTERVAL_MS },
      );
      let failed = false;
      const sub = player.addListener('playbackStatusUpdate', (s: AudioStatus) => {
        const error = statusError(s);
        if (error) {
          if (!failed) events.onError?.(new VoicePlaybackNativeError(error));
          failed = true;
          return;
        }
        if (s.didJustFinish) {
          // Rewind so the next Play starts from the beginning.
          player.pause();
          void player.seekTo(0).catch(reportVoiceAudioCleanup('rewind'));
          events.onEnd?.();
          return;
        }
        events.onProgress?.(Math.round(s.currentTime * 1000));
      });
      let released = false;
      return {
        async play() {
          player.play();
        },
        async pause() {
          player.pause();
        },
        async seek(positionMs: number) {
          await player.seekTo(positionMs / 1000);
        },
        async unload() {
          if (released) return;
          released = true;
          sub.remove();
          player.remove();
        },
      };
    },
  };
}

let playback: VoicePlaybackPort | null | undefined;

/** The native playback port, or null on a binary without expo-audio. */
export function nativeVoicePlayback(): VoicePlaybackPort | null {
  if (playback === undefined) {
    const audio = loadExpoAudio();
    playback = audio ? createExpoPlaybackPort(audio) : null;
  }
  return playback;
}
