/**
 * useExtensionPairing — the live pairing state machine for the v0.3 extension
 * import (PR-M2). It mints a pairing code (POST /extension/pair/init) and polls
 * its lifecycle (POST /extension/pair/status) to the `paired`/`expired` terminal
 * with bounded exponential backoff, then hands off to the browser extension.
 *
 * Honest-by-contract boundaries (see docs/importer/MOBILE_IMPORT_DECISION.md):
 *   • The backend exposes NO mobile-readable import-progress contract, so this
 *     hook NEVER reports importing/partial/complete or any page/entity count.
 *     `paired` is the truthful terminal for mobile: the autonomous crawl then
 *     runs inside the extension. Progress mirroring is a documented follow-up.
 *   • Expiry is SERVER-authoritative: the only expiry signal is the /status
 *     terminal returning `expired`. The client never reads its own wall clock,
 *     so there is no local countdown, no local expiry timer, and no
 *     client-derived TTL (Rule 16 — never trust the client clock).
 *   • There is NO server cancel endpoint, so `cancel()` is a LOCAL abandon: it
 *     stops polling, discards any in-flight mint/poll result, and drops the
 *     code — it never fabricates a server cancel or aborts the HTTP request.
 *   • Unknown/garbled `status` values fail closed: they are treated as a
 *     non-terminal wait and NEVER promoted to `paired`.
 *
 * Resilience: polling backs off (2s → 15s), pauses when the app backgrounds and
 * resumes on foreground, tolerates transient poll errors up to a cap before
 * surfacing a retryable failure, settles to `expired` only when the server
 * /status contract says so, and tears down every timer on unmount. A
 * single-flight guard prevents duplicate mint intents. No token or code is ever
 * logged, stored, or emitted in telemetry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { AxiosError } from 'axios';
import { extensionPairApi } from '../api/extensionPairApi';
import { decodePairStatus } from '../types/extensionImport';
import { featureFlags } from '../config/featureFlags';
import { track } from '../analytics/posthog.service';
import { AnalyticsEvents } from '../analytics/events';

export type PairingStatus =
  | 'idle'
  | 'minting'
  | 'waiting'
  | 'paired'
  | 'expired'
  | 'authExpired'
  | 'unavailable'
  | 'failed'
  | 'cancelled';

export interface PairingState {
  status: PairingStatus;
  /** 6-digit code shown to the coach to read into the extension. Never logged. */
  code: string | null;
}

export interface UseExtensionPairing extends PairingState {
  /** Mint a fresh code and begin polling. No-op while an intent is in flight. */
  start: () => void;
  /** Re-mint after a terminal/failed state (alias of start). */
  retry: () => void;
  /**
   * Local abandon: stop polling, discard any in-flight mint/poll result, and
   * drop the code. No server cancel exists; this never aborts the HTTP request.
   */
  cancel: () => void;
}

const POLL_BASE_MS = 2000;
const POLL_MAX_MS = 15000;
const POLL_BACKOFF = 1.5;
const MAX_POLL_FAILURES = 5;

type FailReason = 'auth' | 'unavailable' | 'network';

function axiosStatus(err: unknown): number | undefined {
  return err instanceof AxiosError ? err.response?.status : undefined;
}

/**
 * @param platformSlug lowercase source-platform slug (`chosen_platform`).
 * @param enabled network is only ever touched when the caller passes a truthy,
 *   flag-gated value. Defaults to the runtime kill switch so the hook fails
 *   closed (stays idle, no network) whenever the import feature is OFF.
 */
export function useExtensionPairing(
  platformSlug: string | null,
  enabled: boolean = featureFlags.extensionImport,
): UseExtensionPairing {
  const [state, setState] = useState<PairingState>({ status: 'idle', code: null });

  const mountedRef = useRef(true);
  const statusRef = useRef<PairingStatus>('idle');
  const codeRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(POLL_BASE_MS);
  const failureCountRef = useRef(0);
  const mintInFlightRef = useRef(false);
  const pausedRef = useRef(false);
  const platformRef = useRef(platformSlug);
  platformRef.current = platformSlug;

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  /** Move to a codeless terminal/reset status and tear down timers. */
  const go = useCallback(
    (next: PairingStatus) => {
      clearTimers();
      codeRef.current = null;
      statusRef.current = next;
      if (mountedRef.current) setState({ status: next, code: null });
    },
    [clearTimers],
  );

  const emitFailed = useCallback((reason: FailReason) => {
    track(AnalyticsEvents.IMPORT_PAIRING_FAILED, { platform: platformRef.current, reason });
  }, []);

  const doPoll = useCallback(async () => {
    if (!mountedRef.current || pausedRef.current) return;
    if (statusRef.current !== 'waiting') return;
    const code = codeRef.current;
    if (!code) return;
    try {
      const res = await extensionPairApi.status(code);
      if (!mountedRef.current || statusRef.current !== 'waiting') return;
      const decoded = decodePairStatus(res.data?.status ?? '');
      if (decoded === 'paired') {
        go('paired');
        track(AnalyticsEvents.IMPORT_PAIRED, { platform: platformRef.current });
        return;
      }
      if (decoded === 'expired') {
        go('expired');
        track(AnalyticsEvents.IMPORT_PAIRING_EXPIRED, { platform: platformRef.current });
        return;
      }
      // 'pending' or (fail-closed) 'unknown' → keep waiting, back off, never promote.
      failureCountRef.current = 0;
      pollDelayRef.current = Math.min(pollDelayRef.current * POLL_BACKOFF, POLL_MAX_MS);
      pollTimerRef.current = setTimeout(doPoll, pollDelayRef.current);
    } catch (err) {
      if (!mountedRef.current || statusRef.current !== 'waiting') return;
      const s = axiosStatus(err);
      if (s === 401 || s === 403) {
        go('authExpired');
        emitFailed('auth');
        return;
      }
      if (s === 404) {
        go('unavailable');
        emitFailed('unavailable');
        return;
      }
      failureCountRef.current += 1;
      if (failureCountRef.current >= MAX_POLL_FAILURES) {
        go('failed');
        emitFailed('network');
        return;
      }
      pollDelayRef.current = Math.min(pollDelayRef.current * POLL_BACKOFF, POLL_MAX_MS);
      pollTimerRef.current = setTimeout(doPoll, pollDelayRef.current);
    }
  }, [go, emitFailed]);

  const start = useCallback(async () => {
    if (!enabled) return; // fail closed: no network path when the feature is OFF
    const slug = platformRef.current;
    if (!slug) return;
    if (mintInFlightRef.current) return; // single-flight
    if (statusRef.current === 'minting' || statusRef.current === 'waiting') return; // no duplicate intent
    mintInFlightRef.current = true;
    go('minting');
    track(AnalyticsEvents.IMPORT_PAIRING_STARTED, { platform: slug });
    try {
      const res = await extensionPairApi.init(slug);
      // `go('minting')` set the ref, but TS narrowed it from the guard above; read fresh.
      // cancelled/unmounted mid-mint → discard this late result (no HTTP abort).
      if (!mountedRef.current || (statusRef.current as PairingStatus) !== 'minting') return;
      const code = res.data?.pairing_code ?? null;
      if (!code) {
        go('failed');
        emitFailed('network');
        return;
      }
      codeRef.current = code;
      pollDelayRef.current = POLL_BASE_MS;
      failureCountRef.current = 0;
      statusRef.current = 'waiting';
      setState({ status: 'waiting', code });
      track(AnalyticsEvents.IMPORT_PAIRING_CODE_READY, { platform: slug });
      pollTimerRef.current = setTimeout(doPoll, POLL_BASE_MS);
    } catch (err) {
      // cancelled/unmounted mid-mint → discard this late result (no HTTP abort).
      if (!mountedRef.current || (statusRef.current as PairingStatus) !== 'minting') return;
      const s = axiosStatus(err);
      if (s === 401 || s === 403) {
        go('authExpired');
        emitFailed('auth');
      } else if (s === 404) {
        go('unavailable');
        emitFailed('unavailable');
      } else {
        go('failed');
        emitFailed('network');
      }
    } finally {
      mintInFlightRef.current = false;
    }
  }, [enabled, go, doPoll, emitFailed]);

  const cancel = useCallback(() => {
    const wasActive = statusRef.current === 'minting' || statusRef.current === 'waiting';
    go('cancelled');
    if (wasActive) track(AnalyticsEvents.IMPORT_PAIRING_CANCELLED, { platform: platformRef.current });
  }, [go]);

  // Pause polling in the background; resume on foreground. Expiry is decided by
  // the server /status contract on the next poll, never by a client clock.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        pausedRef.current = false;
        if (statusRef.current === 'waiting') {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          pollTimerRef.current = setTimeout(doPoll, 0);
        }
      } else {
        pausedRef.current = true;
        clearTimers();
      }
    });
    return () => sub.remove();
  }, [doPoll, clearTimers]);

  // Teardown on unmount: cancel every in-flight timer, block late setState.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  return { ...state, start, retry: start, cancel };
}
