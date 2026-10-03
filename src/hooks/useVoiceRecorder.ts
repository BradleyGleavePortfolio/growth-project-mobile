/**
 * useVoiceRecorder — the v3-3 recording state machine for the community
 * voice-note composer. Wraps a VoiceRecorderPort (injectable for tests; at
 * runtime the native expo-audio recorder from useNativeVoiceRecorder, B-314-2)
 * and exposes a small, explicit state machine:
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
  type MicPermissionStatus,
  type VoiceRecorderPort,
  type VoiceRecordingResult,
} from './voiceRecorderPort';
import { reportVoiceAudioCleanup, useNativeVoiceRecorder } from '../services/voiceAudio';
import { captureError } from '../services/sentry';
import { newRequestId, shortReference } from '../utils/correlation';

/**
 * What failed when status === 'error' (B-314-7): the composer turns it into
 * specific copy with a working next step and the short reference.
 *  - permission_check: the microphone permission could not be read or asked;
 *  - start: the microphone could not start recording;
 *  - stop: the recording could not be finished and saved.
 */
export type VoiceRecorderErrorKind = 'permission_check' | 'start' | 'stop';

export interface VoiceRecorderError {
  kind: VoiceRecorderErrorKind;
  /** Short reference shown to the member; the Sentry report carries it. */
  reference: string;
}

export type VoiceRecorderStatus =
  | 'unavailable'
  | 'idle'
  | 'denied'
  | 'recording'
  | 'stopping'
  | 'recorded'
  | 'error';

export interface UseVoiceRecorderOptions {
  /** Inject a port for tests; defaults to the native expo-audio recorder. */
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
  /** Set when status === 'error': what failed + a reported reference. */
  error: VoiceRecorderError | null;
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
  // Called on every render (stable hook order: the native implementation is
  // fixed per process), even when a test injects its own recorder.
  const native = useNativeVoiceRecorder();
  const recorder = options.recorder ?? resolveVoiceRecorder(native);
  const maxDurationMs = options.maxDurationMs ?? RECORDER_MAX_DURATION_MS;

  const [status, setStatus] = useState<VoiceRecorderStatus>(
    recorder.isAvailable ? 'idle' : 'unavailable',
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState<VoiceRecordingResult | null>(null);
  const [mustOpenSettings, setMustOpenSettings] = useState(false);
  const [error, setError] = useState<VoiceRecorderError | null>(null);

  // Interval + start-time refs live outside render so the ticker is stable.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  // Guards a double-stop race when the auto-stop timer and a manual stop collide.
  const stoppingRef = useRef(false);
  // B-314-7: one start in flight at a time, fenced by a generation. Unmount
  // (or a cancel/reset) bumps the generation, so a permission prompt, audio
  // mode switch or prepare that finishes afterwards is retired: the capture
  // it began is cancelled and no ticker or state update happens.
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  const fail = useCallback((kind: VoiceRecorderErrorKind, err: unknown) => {
    const reference = newRequestId();
    captureError(err, { area: 'community.voice', reason: `recorder_${kind}`, reference });
    if (!mountedRef.current) return;
    setError({ kind, reference: shortReference(reference) ?? reference.slice(0, 8) });
    setStatus('error');
  }, []);

  // Always clear the interval on unmount so a backgrounded composer never
  // leaks, and release the microphone if the composer closes mid-recording
  // or while a start is still in flight.
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      const wasCapturing = startedAtRef.current !== null || startingRef.current;
      clearTick();
      if (wasCapturing) {
        void recorderRef.current.cancel().catch(reportVoiceAudioCleanup('recorder_unmount_cancel'));
      }
    };
  }, [clearTick]);

  const finalize = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    clearTick();
    setStatus('stopping');
    try {
      const result = await recorder.stop();
      if (!mountedRef.current) return;
      const clampedMs = Math.min(result.durationMs, maxDurationMs);
      setRecording({ ...result, durationMs: clampedMs });
      setElapsedMs(clampedMs);
      setStatus('recorded');
    } catch (err) {
      fail('stop', err);
    } finally {
      stoppingRef.current = false;
    }
  }, [clearTick, fail, maxDurationMs, recorder]);

  const beginTicker = useCallback(() => {
    if (tickRef.current !== null) clearInterval(tickRef.current);
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
    // Single flight: a second tap while a start (or a recording) is under
    // way is ignored, so two native captures can never be begun.
    if (startingRef.current || startedAtRef.current !== null) return;
    startingRef.current = true;
    const generation = ++generationRef.current;
    const retired = () => !mountedRef.current || generation !== generationRef.current;
    try {
      let perm: MicPermissionStatus;
      try {
        perm = await recorder.getPermissionStatus();
        if (perm === 'undetermined' && !retired()) {
          perm = await recorder.requestPermission();
        }
      } catch (err) {
        if (!retired()) fail('permission_check', err);
        return;
      }
      if (retired()) return;
      if (perm !== 'granted') {
        // A denial after an explicit prompt usually means the OS won't prompt
        // again — route to Settings rather than offer a no-op retry.
        setMustOpenSettings(true);
        setStatus('denied');
        return;
      }
      try {
        await recorder.start();
      } catch (err) {
        if (!retired()) fail('start', err);
        return;
      }
      if (retired()) {
        // The composer closed (or was reset) while the microphone was
        // starting: release the capture this call began.
        void recorder.cancel().catch(reportVoiceAudioCleanup('recorder_late_start_cancel'));
        return;
      }
      setRecording(null);
      setError(null);
      setMustOpenSettings(false);
      setStatus('recording');
      beginTicker();
    } finally {
      startingRef.current = false;
    }
  }, [beginTicker, fail, recorder]);

  const stop = useCallback(async () => {
    if (status !== 'recording') return;
    await finalize();
  }, [finalize, status]);

  const cancel = useCallback(async () => {
    generationRef.current += 1;
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
    generationRef.current += 1;
    clearTick();
    setError(null);
    setRecording(null);
    setElapsedMs(0);
    setMustOpenSettings(false);
    stoppingRef.current = false;
    setStatus(recorder.isAvailable ? 'idle' : 'unavailable');
  }, [clearTick, recorder.isAvailable]);

  const retryPermission = useCallback(async () => {
    let perm: MicPermissionStatus;
    try {
      perm = await recorder.requestPermission();
    } catch (err) {
      fail('permission_check', err);
      return;
    }
    if (!mountedRef.current) return;
    if (perm === 'granted') {
      setMustOpenSettings(false);
      setStatus('idle');
    } else {
      // Still denied — the composer surfaces the Settings deep-link.
      setMustOpenSettings(true);
      setStatus('denied');
    }
  }, [fail, recorder]);

  return {
    status,
    elapsedMs,
    maxDurationMs,
    recording,
    canRetryPermission: status === 'denied',
    mustOpenSettings,
    isAvailable: recorder.isAvailable,
    error,
    start,
    stop,
    cancel,
    reset,
    retryPermission,
  };
}
