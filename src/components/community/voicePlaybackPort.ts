/**
 * voicePlaybackPort — the audio-playback capability the v3-3 VoiceNotePlayer
 * depends on, plus the safe default adapter resolved at module load.
 *
 * WHY A PORT (same rationale as voiceRecorderPort): the app bundles no audio
 * playback module today (expo-video covers video; there is no audio player), so
 * the surface ships behind `featureFlags.communityVoiceNotes` (default OFF).
 * The player depends on this PORT so it (a) type-checks, (b) is testable
 * without a native module, and (c) degrades to a disabled control with an
 * honest "playback isn't available on this build" label rather than a dead
 * play button. A host registers a real adapter once audio playback is wired.
 */

export interface VoicePlaybackHandle {
  /** Resume / start playback from the current position. */
  play(): Promise<void>;
  /** Pause without discarding the loaded clip. */
  pause(): Promise<void>;
  /** Seek to an absolute position in ms. */
  seek(positionMs: number): Promise<void>;
  /** Release the underlying resource. */
  unload(): Promise<void>;
}

export interface VoicePlaybackEvents {
  /** Position tick (ms) while playing. */
  onProgress?: (positionMs: number) => void;
  /** Fired once when the clip finishes. */
  onEnd?: () => void;
  /** Fired on a load/transport error. */
  onError?: (err: unknown) => void;
}

export interface VoicePlaybackPort {
  /** False on builds without a bundled audio player. */
  readonly isAvailable: boolean;
  /** Load a (signed) audio URL and return a handle, wiring the events. */
  load(url: string, events: VoicePlaybackEvents): Promise<VoicePlaybackHandle>;
}

export class VoicePlaybackUnavailableError extends Error {
  constructor() {
    super('voice playback is not available on this build');
    this.name = 'VoicePlaybackUnavailableError';
    Object.setPrototypeOf(this, VoicePlaybackUnavailableError.prototype);
  }
}

/** The honest default: reports unavailable and rejects any load. */
export const unavailablePlayback: VoicePlaybackPort = {
  isAvailable: false,
  async load() {
    throw new VoicePlaybackUnavailableError();
  },
};

let registered: VoicePlaybackPort | null = null;

/** Register the concrete playback adapter (host wiring). Null reverts to default. */
export function registerVoicePlayback(port: VoicePlaybackPort | null): void {
  registered = port;
}

/** Resolve the active playback port — the registered adapter or safe default. */
export function resolveVoicePlayback(): VoicePlaybackPort {
  return registered ?? unavailablePlayback;
}
