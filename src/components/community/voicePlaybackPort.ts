/**
 * voicePlaybackPort — the audio-playback capability the v3-3 VoiceNotePlayer
 * depends on, plus the honest "unavailable" adapter.
 *
 * Production plays through expo-audio (src/services/voiceAudio.ts, B-314-2):
 * `resolveVoicePlayback()` returns a registered adapter (hosts, tests), else
 * the native expo-audio player, else `unavailablePlayback` — the last only on
 * a binary built before expo-audio was added, where the player renders a
 * disabled control with an honest "playback isn't available on this build"
 * label rather than a dead play button.
 */
import { nativeVoicePlayback } from '../../services/voiceAudio';

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

/** Register an adapter that overrides the native player (hosts, tests). Null reverts. */
export function registerVoicePlayback(port: VoicePlaybackPort | null): void {
  registered = port;
}

/** Resolve the active playback port: registered, else native, else unavailable. */
export function resolveVoicePlayback(): VoicePlaybackPort {
  return registered ?? nativeVoicePlayback() ?? unavailablePlayback;
}

/**
 * BF-1 (LS-871X on m#871): one voice note plays at a time, across every port
 * and screen (Hall, note detail, coach report queue, the record sheet's
 * listen-back). A player takes the turn as it starts; the note that had it is
 * stopped: paused with its place kept, or, if still loading, told not to play
 * when its load lands. Pause, end, error and unload give the turn back, and
 * nothing ever hands it on, so an unload or a late load never restarts a
 * paused note.
 */
export interface VoicePlaybackTurn {
  /** Called when another note takes the turn. Resolves once this one is quiet. */
  stop(): Promise<void>;
}

let turn: VoicePlaybackTurn | null = null;

/** Take the turn; resolves once the note that had it has stopped (at once if none). */
export function takeVoicePlaybackTurn(next: VoicePlaybackTurn): Promise<void> {
  const previous = turn;
  turn = next;
  if (!previous || previous === next) return Promise.resolve();
  return previous.stop().catch(() => undefined);
}

/** True while this note holds the turn. */
export function hasVoicePlaybackTurn(holder: VoicePlaybackTurn): boolean {
  return turn === holder;
}

/** Give the turn back (pause, end, error, unload). A no-op if another note has it. */
export function endVoicePlaybackTurn(holder: VoicePlaybackTurn): void {
  if (turn === holder) turn = null;
}
