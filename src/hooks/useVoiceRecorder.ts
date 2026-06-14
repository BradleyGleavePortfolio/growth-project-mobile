/**
 * useVoiceRecorder — the v3-3 recording state machine for the community
 * voice-note composer. Wraps a VoiceRecorderPort (injectable for tests; the
 * resolved adapter at runtime) and exposes a small, explicit state machine:
 *
 *   unavailable → (no recorder bundled on this build; calm message, no button)
 *   idle        → ready to record (permission granted or undetermined)
 *   denied      → mic permission denied; carries a REAL recovery affordance
 *                 (re-request, and a flag for the composer to deep-link to
 *                 Settings when the OS will no longer prompt)
 *   recording   → capturing; exposes a live elapsed-ms ticker + the cap
 *   stopping     → finalizing the file
 *   recorded    → a finished VoiceRecordingResult is available to upload
 *   error       → a capture error; recoverable (reset → idle)
 *
 * Permission posture (audit req — mic denial needs a real recovery state):
 *   - start() first checks permission; if undetermined it PROMPTS; if the
 *     prompt is denied the machine enters `denied` (not a silent no-op) and
 *     surfaces `canRetryPermission`. After a denial the next request may not
 *     re-prompt (OS-dependent); `mustOpenSettings` tells the composer to route
 *     the user to system settings rather than show a button that does nothing.
 *   - The elapsed timer auto-stops at RECORDER_MAX_DURATION_MS so a recording
 *     can never exceed the server cap (belt-and-suspenders to the byte check).
 *
 * Fully typed throughout (no unsafe casts): the port is a typed interface and
 * React state is a discriminated union narrowed by `status`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveVoiceRecorder,
  RECORDER_MAX_DURATION_MS,
  type VoiceRecorderPort,
  type VoiceRecordingResult,
} from './voiceRecorderPort';

export type VoiceRecorderStatus =
  | 'unavailable'
  | 'idle'
  | 'denied'
  | 'recording'
  | 'stopping'
  | 'recorded'
  | 'error';

export interface UseVoiceRecorderOptions {
  /** Inject a port for tests; defaults to the resolved runtime adapter. */
  recorder?: VoiceRecorderPort;
  /** Hard cap in ms; defaults to the server max (5 min). */
  maxDurationMs?: number;
}

export interface VoiceRecorderState {
  status: VoiceRecorderStatus;
  /** Live elapsed time while recording / after recording (ms). */
  elapsedMs: number;
  /** The hard cap (ms) so the UI can render a progress ring. */
  maxDurationMs: number;
  /** The finished recording once status === 'recorded'. */
  recording: VoiceRecordingResult | null;
  /** True when the mic permission was denied. */
  canRetryPermission: boolean;
  /**
   * True when a denial means the OS will no longer prompt, so the composer must
   * deep-link to Settings instead of re-requesting in-app.
   */
  mustOpenSettings: boolean;
  /** True when no native recorder is bundled on this build. */
  isAvailable: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Discard a finished/errored recording and return to idle. */
  reset: () => void;
  /** Re-request mic permission after a denial. */
  retryPermission: () => Promise<void>;
}

const TICK_MS = 100;

export function useVoiceRecorder(
  options: UseVoiceRecorderOptions = {},
): VoiceRecorderState {
  const recorder = options.recorder ?? resolveVoiceRecorder();
  const maxDurationMs = options.maxDurationMs ?? RECORDER_MAX_DURATION_MS;

  const [status, setStatus] = useState<VoiceRecorderStatus>(
    recorder.isAvailable ? 'idle' : 'unavailable',
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState<VoiceRecordingResult | null>(null);
  const [mustOpenSettings, setMustOpenSettings] = useState(false);

  // Interval + start-time refs live outside render so the ticker is stable.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  // Guards a double-stop race when the auto-stop timer and a manual stop collide.
  const stoppingRef = useRef(false);

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  // Always clear the interval on unmount so a backgrounded composer never leaks.
  useEffect(() => clearTick, [clearTick]);

  const finalize = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    clearTick();
    setStatus('stopping');
    try {
      const result = await recorder.stop();
      const clampedMs = Math.min(result.durationMs, maxDurationMs);
      setRecording({ ...result, durationMs: clampedMs });
      setElapsedMs(clampedMs);
      setStatus('recorded');
    } catch {
      setStatus('error');
    } finally {
      stoppingRef.current = false;
    }
  }, [clearTick, maxDurationMs, recorder]);

  const beginTicker = useCallback(() => {
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    tickRef.current = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      const next = Date.now() - startedAt;
      if (next >= maxDurationMs) {
        setElapsedMs(maxDurationMs);
        // Auto-stop at the cap — fire-and-forget; finalize guards re-entry.
        void finalize();
        return;
      }
      setElapsedMs(next);
    }, TICK_MS);
  }, [finalize, maxDurationMs]);

  const start = useCallback(async () => {
    if (!recorder.isAvailable) {
      setStatus('unavailable');
      return;
    }
    let perm = await recorder.getPermissionStatus();
    if (perm === 'undetermined') {
      perm = await recorder.requestPermission();
    }
    if (perm !== 'granted') {
      // A denial after an explicit prompt usually means the OS won't prompt
      // again — route to Settings rather than offer a no-op retry.
      setMustOpenSettings(true);
      setStatus('denied');
      return;
    }
    try {
      await recorder.start();
      setRecording(null);
      setMustOpenSettings(false);
      setStatus('recording');
      beginTicker();
    } catch {
      setStatus('error');
    }
  }, [beginTicker, recorder]);

  const stop = useCallback(async () => {
    if (status !== 'recording') return;
    await finalize();
  }, [finalize, status]);

  const cancel = useCallback(async () => {
    clearTick();
    try {
      await recorder.cancel();
    } finally {
      setRecording(null);
      setElapsedMs(0);
      stoppingRef.current = false;
      setStatus(recorder.isAvailable ? 'idle' : 'unavailable');
    }
  }, [clearTick, recorder]);

  const reset = useCallback(() => {
    clearTick();
    setRecording(null);
    setElapsedMs(0);
    setMustOpenSettings(false);
    stoppingRef.current = false;
    setStatus(recorder.isAvailable ? 'idle' : 'unavailable');
  }, [clearTick, recorder.isAvailable]);

  const retryPermission = useCallback(async () => {
    const perm = await recorder.requestPermission();
    if (perm === 'granted') {
      setMustOpenSettings(false);
      setStatus('idle');
    } else {
      // Still denied — the composer surfaces the Settings deep-link.
      setMustOpenSettings(true);
      setStatus('denied');
    }
  }, [recorder]);

  return {
    status,
    elapsedMs,
    maxDurationMs,
    recording,
    canRetryPermission: status === 'denied',
    mustOpenSettings,
    isAvailable: recorder.isAvailable,
    start,
    stop,
    cancel,
    reset,
    retryPermission,
  };
}
