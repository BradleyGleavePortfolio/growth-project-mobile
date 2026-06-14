/**
 * voiceRecorderPort — the capability port the v3-3 voice-note recorder hook
 * depends on, plus the safe default adapter resolved at module load.
 *
 * WHY A PORT (and not a direct native call):
 *   The mobile app does not currently bundle a native audio-capture module
 *   (expo-av / expo-audio are not in package.json — only expo-video for
 *   playback). The v3-3 surface ships behind `featureFlags.communityVoiceNotes`
 *   (default OFF) precisely so the UI + upload pipeline can land before the
 *   native recorder is wired. To keep the surface (a) fully type-checked, (b)
 *   deterministically testable without a native module, and (c) gracefully
 *   degrading at runtime, the recorder hook depends on this PORT interface
 *   rather than a concrete recorder. `resolveVoiceRecorder()` returns the real
 *   adapter when a host registers one (via `registerVoiceRecorder`) and an
 *   honest "unavailable" adapter otherwise — never a fake that pretends to
 *   record. The composer reads `recorder.isAvailable` and renders a calm
 *   "voice recording isn't available on this build" state instead of a dead
 *   record button (DESIGN_INTELLIGENCE: no dead controls; honest capability).
 *
 * This mirrors the repo posture for capability-gated surfaces (e.g. the
 * bloodwork flag stays off "until backend storage … is live"): scaffolding is
 * shippable and dark, never a stub that lies about what it can do.
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
 * The capability the recorder hook needs. A host app provides a concrete
 * adapter once a native recorder is wired; until then `unavailableRecorder` is
 * resolved and `isAvailable` is false.
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
 * Register the concrete recorder adapter (called by a host once a native
 * recorder is bundled). Passing null reverts to the unavailable adapter.
 */
export function registerVoiceRecorder(port: VoiceRecorderPort | null): void {
  registered = port;
}

/** Resolve the active recorder — the registered adapter or the safe default. */
export function resolveVoiceRecorder(): VoiceRecorderPort {
  return registered ?? unavailableRecorder;
}

/** Re-exported so the hook and composer share one cap without re-importing the API. */
export const RECORDER_MAX_DURATION_MS = MAX_VOICE_DURATION_MS;
