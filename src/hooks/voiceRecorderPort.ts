/**
 * voiceRecorderPort — the capability port the v3-3 voice-note recorder hook
 * depends on, plus the honest "unavailable" adapter.
 *
 * The real recorder is expo-audio (src/services/voiceAudio.ts, B-314-2):
 * `useVoiceRecorder` passes `useNativeVoiceRecorder()` to
 * `resolveVoiceRecorder()` on every render, so production records with the
 * native module by default. The port stays the seam because (a) tests inject
 * a scripted recorder, (b) a host can still register one, and (c) a binary
 * built before expo-audio was added has no native module: then the native
 * recorder is null and the composer shows the calm "voice recording isn't
 * available on this build" state instead of a dead record button
 * (DESIGN_INTELLIGENCE: no dead controls; honest capability).
 */
import {
  MAX_VOICE_DURATION_MS,
  type VoiceNoteMimeType,
} from '../api/communityVoiceApi';

/** Permission posture for the microphone, mirrored from the native layer. */
export type MicPermissionStatus = 'undetermined' | 'granted' | 'denied';

/** A finished recording the hook hands to the upload pipeline. */
export interface VoiceRecordingResult {
  /** Local file URI (file://…) or object URL of the captured audio. */
  uri: string;
  /** Captured duration in ms — clamped to MAX_VOICE_DURATION_MS by the hook. */
  durationMs: number;
  /** Encoded byte size of the recording. */
  bytes: number;
  /** The recording's MIME type (must be in the server allowlist). */
  mimeType: VoiceNoteMimeType;
  /**
   * Normalised amplitude samples in [0,1] captured during recording, for the
   * client-side waveform visualization. May be empty when the adapter does not
   * expose metering; the waveform component degrades to a flat baseline.
   */
  peaks: number[];
}

/**
 * The capability the recorder hook needs. The expo-audio adapter implements
 * it; `unavailableRecorder` (isAvailable false) is resolved only when this
 * binary has no native audio module.
 */
export interface VoiceRecorderPort {
  /** False on builds without a bundled native recorder. */
  readonly isAvailable: boolean;
  /** Query the current mic-permission status without prompting. */
  getPermissionStatus(): Promise<MicPermissionStatus>;
  /** Prompt for mic permission; resolves to the resulting status. */
  requestPermission(): Promise<MicPermissionStatus>;
  /** Begin capture. Rejects if permission is not granted or already recording. */
  start(): Promise<void>;
  /**
   * Stop capture and resolve the finished recording. Rejects if not recording.
   */
  stop(): Promise<VoiceRecordingResult>;
  /** Abort capture and discard any partial recording (best-effort). */
  cancel(): Promise<void>;
}

/** Thrown by the unavailable adapter so callers fail loudly in dev, not silently. */
export class VoiceRecorderUnavailableError extends Error {
  constructor() {
    super('voice recording is not available on this build');
    this.name = 'VoiceRecorderUnavailableError';
    Object.setPrototypeOf(this, VoiceRecorderUnavailableError.prototype);
  }
}

/**
 * The honest default: reports unavailable, never grants permission, and rejects
 * any capture call. The composer checks `isAvailable` first and never reaches
 * start/stop, so these rejections are a defensive backstop, not a normal path.
 */
export const unavailableRecorder: VoiceRecorderPort = {
  isAvailable: false,
  async getPermissionStatus() {
    return 'undetermined';
  },
  async requestPermission() {
    return 'denied';
  },
  async start() {
    throw new VoiceRecorderUnavailableError();
  },
  async stop() {
    throw new VoiceRecorderUnavailableError();
  },
  async cancel() {
    // No-op: nothing to discard when there is no recorder.
  },
};

let registered: VoiceRecorderPort | null = null;

/**
 * Register a recorder adapter that overrides the native one (hosts and
 * tests). Passing null reverts to the native recorder.
 */
export function registerVoiceRecorder(port: VoiceRecorderPort | null): void {
  registered = port;
}

/**
 * Resolve the active recorder: a registered adapter, else the native recorder
 * the caller got from `useNativeVoiceRecorder()`, else the honest unavailable
 * adapter (a binary without the ExpoAudio native module).
 */
export function resolveVoiceRecorder(native: VoiceRecorderPort | null = null): VoiceRecorderPort {
  return registered ?? native ?? unavailableRecorder;
}

/** Re-exported so the hook and composer share one cap without re-importing the API. */
export const RECORDER_MAX_DURATION_MS = MAX_VOICE_DURATION_MS;
