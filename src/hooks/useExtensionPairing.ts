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
 *     stops polling, discards any in-flight mint/poll result, drops the code and
 *     erases the durable mirror — it never fabricates a server cancel or aborts
 *     the HTTP request. Until the backend exposes a revoke route the server-side
 *     session simply runs to its own expiry; mobile never claims otherwise.
 *
 * Durability (M5-C): this flow REQUIRES the coach to leave the app for a browser,
 * so an OS kill mid-pairing used to drop the code and strand a live server-side
 * session. The minted session is now mirrored to user-scoped storage (see
 * storage/importPairingMirror.ts) and rehydrated on relaunch. Rehydration is not
 * a claim the session is still live (Rule 18): it re-enters `waiting` and polls
 * immediately, and the server /status contract remains the sole authority.
 * Because the mirror is user-scoped and `useCurrentUser()` resolves the coach
 * identity ASYNCHRONOUSLY (its first render is always `null`), hydration waits
 * for a resolved user id and every `start()` that arrives before then is
 * deferred, never dropped and never allowed to mint blind: a blind mint would
 * server-expire a still-live session the coach may already be typing into the
 * extension. Inside CoachNavigator the cached user is always present (the
 * navigator mounts only after RootNavigator read it), so the wait is bounded by
 * one storage read. ImportDataScreen performs the matching screen-level peek so
 * the panel that hosts this hook is mounted again after a process restart.
 * S6 R3: that wait is now BOUNDED. If the identity has never resolved on this
 * mount within IDENTITY_WAIT_MS of a deferred start(), the hook settles to
 * `identityUnavailable` — a retryable, honest terminal ("we could not confirm
 * your account") instead of an indefinite "preparing" spinner; no mint and no
 * storage write happen on that path. The
 * persisted `expires_at` is provenance only and is never compared to a client
 * clock (Rule 16). The idempotency key minted before the first /pair/init is
 * persisted with it and replayed on retry (Rule 19). NOTE: the current backend
 * does not read `Idempotency-Key` on /pair/init; the "one live session per
 * coach" outcome is guaranteed server-side by /pair/init expiring any prior
 * live code for the coach (single-active-code invariant). The header is sent
 * for correlation/forward compatibility, not as the dedupe mechanism.
 *   • Unknown/garbled `status` values fail closed: they are treated as a
 *     non-terminal wait and NEVER promoted to `paired`.
 *
 * Resilience: polling backs off (2s → 15s), pauses when the app backgrounds and
 * resumes on foreground, tolerates transient poll errors up to a cap before
 * surfacing a retryable failure, settles to `expired` only when the server
 * /status contract says so, and tears down every timer on unmount. Single-flight
 * guards prevent both duplicate mint intents and concurrent /status polls (a
 * foreground resume mid-poll never issues a second request). No token or code is
 * ever logged, stored, or emitted in telemetry.
 *
 * C1 setup correlation (UX-03b; contract `2.0.0-c1-s1.1` @ backend `a0ea1bea`,
 * consumer-frozen pair surface — see types/extensionImport.ts):
 *   • A `setup_nonce` (uuid) is minted alongside the Rule 19 key, PERSISTED to
 *     the mirror BEFORE /pair/init is sent (a pre-init record with `code: null`),
 *     and replayed on a same-intent retry — including after a process death
 *     between the request and its reply (E01). It lets the server hand back the
 *     coach's OWN attempt instead of minting a second one; it authorises nothing.
 *   • 409 `setup_nonce_conflict` (nonce already used for another platform):
 *     the nonce is DISCARDED and the state is `failed` with `reason: 'conflict'`;
 *     the remedy is "Get a new code" (a retry is a genuinely new intent).
 *   • 410 `setup_challenge_unavailable` (challenge gone): expired-class state
 *     `expired` with `reason: 'challengeUnavailable'` and the copy "Your code is
 *     no longer valid; your setup is kept" — the server's durable setup survives
 *     challenge expiry; nothing here claims what the extension did.
 *   • `import_intent_id` from init/status replies is captured into
 *     `importIntentId` as CORRELATION ONLY (support, `pair/session` lookup). It
 *     never drives eligibility, `paired`, Start, connection, or result state.
 *   • Mobile never calls `pair/redeem`; there is no revocation or disconnect
 *     endpoint and no such claim is made. Code and nonce never enter a URL,
 *     log, analytics, or telemetry payload.
 *   The public return shape is additive: `importIntentId` and `reason` are new
 *   optional members; every pre-existing member and status is unchanged.
 *
 * S11-C readiness (UX-03/04; contract addendum at backend PR #560, head
 * `7fdcbc044dba1747d0db2f2750ced951f3b6b752`, D-S11-5 - see
 * types/extensionImport.ts decodeReadiness):
 *   - pair/status carries NO readiness block; pair/current and pair/session do.
 *     Once THIS attempt's poll settles to `paired`, the hook fires exactly one
 *     pair/current read (single-flight, epoch-guarded against a later
 *     transition away from `paired`) purely to populate the advisory
 *     `readiness` field. It never gates, delays, or retries the `paired`
 *     transition itself - that remains decided solely by pair/status.
 *   - `readiness` is `undefined` (not known) until that read resolves with a
 *     well-formed block, and stays undefined forever if the read fails, the
 *     block is malformed, or the server omits it - the exact same "omit, never
 *     fabricate" contract the backend's own readReadiness applies. A read
 *     failure here is silently absorbed; it is not surfaced as a hook failure
 *     state, matching the block's advisory (not authoritative) status.
 *   - Every transition OFF `paired` (expired, cancelled, a fresh retry, sign-
 *     out) clears the stored readiness and invalidates any in-flight fetch, so
 *     a late response can never attach a stale reading to a new session.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { AxiosError } from 'axios';
import { extensionPairApi } from '../api/extensionPairApi';
import {
  decodeImportIntentId,
  decodePairCurrentResponse,
  decodePairInitErrorCode,
  decodePairStatus,
  type DecodedReadiness,
} from '../types/extensionImport';
import { featureFlags } from '../config/featureFlags';
import { track } from '../analytics/posthog.service';
import { AnalyticsEvents } from '../analytics/events';
import { useCurrentUser } from './useCurrentUser';
import { generateIdempotencyKey } from '../utils/idempotency';
import { extractRequestId } from '../utils/correlation';
import { logger } from '../utils/logger';
import {
  IMPORT_PAIRING_MIRROR_VERSION,
  clearImportPairingMirror,
  readImportPairingMirror,
  writeImportPairingMirror,
} from '../storage/importPairingMirror';

export type PairingStatus =
  | 'idle'
  | 'minting'
  | 'waiting'
  | 'paired'
  | 'expired'
  | 'authExpired'
  | 'unavailable'
  | 'failed'
  | 'cancelled'
  /** Coach identity never resolved within the bounded wait; nothing was minted. */
  | 'identityUnavailable';

/**
 * Contract-named cause of the CURRENT `failed` / `expired` state, when the C1
 * pair/init contract supplied one. Null for every other transition. Presentation
 * may map it to copy (see PAIRING_REASON_COPY); it is never a server truth claim.
 */
export type PairingReason = 'conflict' | 'challengeUnavailable';

/** Fact → remedy copy for each contract-named reason (A11Y-07 pattern). */
export const PAIRING_REASON_COPY: Readonly<Record<PairingReason, { message: string; remedy: string }>> =
  Object.freeze({
    conflict: Object.freeze({
      message: 'This setup was started for a different platform, so it can’t be reused here.',
      remedy: 'Get a new code',
    }),
    challengeUnavailable: Object.freeze({
      message: 'Your code is no longer valid; your setup is kept',
      remedy: 'Get a new code',
    }),
  });

export interface PairingState {
  status: PairingStatus;
  /** 6-digit code shown to the coach to read into the extension. Never logged. */
  code: string | null;
  /**
   * Server correlation id for the request that produced the CURRENT failure
   * state, when the backend supplied one (M5-D). Null on success and whenever
   * the server sent nothing — a reference support cannot look up is worse than
   * none. Showing it is not a diagnosis (Rule 18).
   */
  supportReference: string | null;
  /**
   * Server `import_intent_id` for the CURRENT intent, when the init/status
   * reply carried one. CORRELATION ONLY (support, `pair/session`): never read
   * as eligibility, connection, Start, or result truth. Optional so existing
   * panel doubles that predate it stay type-compatible.
   */
  importIntentId?: string | null;
  /** Contract-named cause of the current failed/expired state, if any. */
  reason?: PairingReason | null;
  /**
   * S11-C (D-S11-5, UX-03/04) advisory setup-to-run readiness, read via
   * pair/current once this intent settles to `paired` (pair/status carries no
   * readiness block). `undefined` means NOT KNOWN — the read has not
   * completed yet, the server omitted the block, or the block failed to
   * decode — and is never rendered as a negative/zero reading. This read is
   * advisory only: it never demotes `paired`, never blocks the checklist, and
   * a failure is silently absorbed (stays undefined) rather than surfaced as
   * an error state, exactly like the server's own read failure (`readReadiness`
   * omits the block rather than failing the setup response).
   */
  readiness?: DecodedReadiness;
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
/**
 * Upper bound on waiting for the FIRST identity resolution on a mount before a
 * deferred start() is surfaced as `identityUnavailable`. Generous relative to
 * one AsyncStorage read (tens of ms) so it only fires when hydration truly
 * failed, never during normal boot.
 */
export const IDENTITY_WAIT_MS = 8000;

type FailReason = 'auth' | 'unavailable' | 'network' | 'identity' | 'conflict';

function axiosStatus(err: unknown): number | undefined {
  return err instanceof AxiosError ? err.response?.status : undefined;
}

/** Domain `code` from a C1 error envelope body, or undefined. Never the message. */
function axiosErrorCode(err: unknown): unknown {
  if (!(err instanceof AxiosError)) return undefined;
  const data: unknown = err.response?.data;
  return data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
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
  const [state, setState] = useState<PairingState>({
    status: 'idle',
    code: null,
    supportReference: null,
    importIntentId: null,
    reason: null,
  });

  const mountedRef = useRef(true);
  const statusRef = useRef<PairingStatus>('idle');
  const codeRef = useRef<string | null>(null);
  /**
   * S11-C readiness for the CURRENT paired intent (undefined = not known).
   * Populated only after a successful pair/current read following `paired`;
   * never written by the mint/poll path itself (pair/status carries none).
   */
  const readinessRef = useRef<DecodedReadiness | undefined>(undefined);
  /** Single-flight guard + staleness token for the readiness fetch. */
  const readinessEpochRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(POLL_BASE_MS);
  const failureCountRef = useRef(0);
  const mintInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const pausedRef = useRef(false);
  const platformRef = useRef(platformSlug);
  platformRef.current = platformSlug;

  const userId = useCurrentUser()?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  /** Rule 19 key for the CURRENT coach intent; replayed across retries of it. */
  const idempotencyKeyRef = useRef<string | null>(null);
  /** C1 `setup_nonce` for the CURRENT intent; persisted pre-init, replayed on retry. */
  const setupNonceRef = useRef<string | null>(null);
  /** Server `import_intent_id` for the CURRENT intent. Correlation only. */
  const importIntentIdRef = useRef<string | null>(null);
  /**
   * False until the durable mirror has been consulted for a RESOLVED coach id.
   * Stays false while the identity is still unknown, so `start()` defers.
   */
  const hydratedRef = useRef(false);
  /** A start() that arrived before hydration finished, deferred not dropped. */
  const pendingStartRef = useRef(false);
  /** Bounded wait for the first identity resolution (S6 R3). */
  const identityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True once a resolved coach id has been seen on this mount. */
  const identityEverResolvedRef = useRef(false);
  const startRef = useRef<(() => void) | null>(null);
  /**
   * Coach id the CURRENT in-memory session (code, key, poll) belongs to. In
   * the shipped tree RootNavigator swaps the whole coach tree on logout/login,
   * so a mounted hook only ever sees its owner go A→null in the sign-out
   * window; the guard below makes the same-mount A→B case safe as well rather
   * than relying on that structure.
   */
  const ownerRef = useRef<string | null>(null);
  /**
   * Monotonic id of the latest /pair/init attempt. Every settle path of an
   * attempt (success, catch, finally) acts only if it is still the CURRENT
   * attempt; owner equality alone is not enough (cancel→retry by the same
   * coach, or A→B→A, yields the same owner with a newer attempt outstanding).
   */
  const mintEpochRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const clearIdentityTimer = useCallback(() => {
    if (identityTimerRef.current) clearTimeout(identityTimerRef.current);
    identityTimerRef.current = null;
  }, []);

  /** Publish a state snapshot; `importIntentId` always mirrors the current intent's ref. */
  const emit = useCallback(
    (
      status: PairingStatus,
      code: string | null,
      supportReference: string | null = null,
      reason: PairingReason | null = null,
    ) => {
      setState({
        status,
        code,
        supportReference,
        importIntentId: importIntentIdRef.current,
        reason,
        ...(readinessRef.current ? { readiness: readinessRef.current } : {}),
      });
    },
    [],
  );

  /**
   * Move to a codeless terminal/reset status and tear down timers.
   * `supportReference` is the server's correlation id for the request that
   * caused this transition, when it gave one; every non-error transition clears
   * it so a stale reference can never be attached to a later failure.
   */
  const go = useCallback(
    (next: PairingStatus, supportReference: string | null = null, reason: PairingReason | null = null) => {
      clearTimers();
      // Ending this session frees the poll single-flight guard so the next
      // session can poll; a still-outstanding poll from the old session is
      // discarded by its code check (below) and cannot re-stomp the guard.
      pollInFlightRef.current = false;
      // Likewise a mint still outstanding no longer counts as an in-flight
      // intent: its attempt id is stale and every one of its settle paths
      // discards itself, so the next start() must not be blocked by it.
      mintInFlightRef.current = false;
      codeRef.current = null;
      // No status reached here still owns a code, so the durable mirror is stale
      // by definition — EXCEPT 'minting': start() immediately overwrites the
      // record with this intent's pre-init (nonce) record, and a same-intent
      // retry must not lose the nonce it is about to replay.
      const uid = userIdRef.current;
      if (uid && next !== 'minting') void clearImportPairingMirror(uid);
      // Readiness is advisory data for the CURRENT paired intent only; every
      // transition away from (or never having reached) `paired` invalidates it
      // and bumps the epoch so a still-outstanding fetch discards its result
      // rather than attaching a stale reading to a new/terminal session.
      if (next !== 'paired') {
        readinessRef.current = undefined;
        readinessEpochRef.current += 1;
      }
      // Retire the Rule 19 key AND the setup nonce on every outcome EXCEPT a
      // transient 'failed' (and the 'minting' transition): a retry after a lost
      // response is the SAME coach intent and must replay the same key + nonce,
      // whereas a retry after paired/expired/cancelled/auth/unavailable is a
      // genuinely new intent. (A 409 conflict discards them explicitly.)
      if (next !== 'failed' && next !== 'minting') {
        idempotencyKeyRef.current = null;
        setupNonceRef.current = null;
      }
      // A new intent has no correlation id yet; every other transition keeps
      // the current intent's id for support (it is never UI truth).
      if (next === 'minting') importIntentIdRef.current = null;
      statusRef.current = next;
      if (mountedRef.current) emit(next, null, supportReference, reason);
    },
    [clearTimers, emit],
  );

  const emitFailed = useCallback((reason: FailReason) => {
    track(AnalyticsEvents.IMPORT_PAIRING_FAILED, { platform: platformRef.current, reason });
  }, []);

  /**
   * S11-C (D-S11-5, UX-03/04): read advisory readiness for the just-paired
   * intent via pair/current (pair/status carries no readiness block). Fires
   * once per `paired` transition, single-flight, and is PURELY ADDITIVE: a
   * malformed payload, a transport error, or a superseded epoch (unmounted,
   * moved off `paired`, or a newer paired transition already running) all
   * leave `readiness` at its prior (unknown) value and never touch `status`,
   * `code`, or any other field — exactly like the server's own read failure,
   * which omits the block rather than failing the setup response.
   */
  const fetchReadiness = useCallback(async () => {
    const epoch = readinessEpochRef.current;
    // No setup_nonce to replay here: `go('paired')` (called just before this
    // function, in doPoll) already retired it, and the just-paired setup IS
    // this coach's current setup — the same "empty body reads the current
    // setup" semantics pair/current documents for its normal (non-recovery)
    // caller. There is nothing to recover; this is not the E01 nonce-replay
    // path start()/the mirror use.
    try {
      const res = await extensionPairApi.current();
      if (!mountedRef.current || statusRef.current !== 'paired' || readinessEpochRef.current !== epoch) {
        return;
      }
      const decoded = decodePairCurrentResponse(res.data);
      if (decoded.readiness) {
        readinessRef.current = decoded.readiness;
        emit('paired', null, null, null);
      }
    } catch {
      // Advisory read only — never surfaces as a failure state or retries on a
      // timer; the next paired transition (a fresh mint/redeem) tries again.
    }
  }, [emit]);

  const doPoll = useCallback(async () => {
    if (!mountedRef.current || pausedRef.current) return;
    if (statusRef.current !== 'waiting') return;
    // Single-flight: a /status request is already outstanding. A foreground
    // resume (or any re-entry) while one poll is in flight must NOT fire a
    // second concurrent request; the outstanding poll reschedules the next one.
    if (pollInFlightRef.current) return;
    const code = codeRef.current;
    if (!code) return;
    pollInFlightRef.current = true;
    try {
      const res = await extensionPairApi.status(code);
      // Discard a late/stale result: unmounted, session moved off 'waiting', or
      // the code was abandoned/re-minted (cancel→retry) while this poll was out.
      if (!mountedRef.current || statusRef.current !== 'waiting' || codeRef.current !== code) return;
      // Correlation only: remember the server's setup id when it names one.
      // It never influences which branch below is taken.
      const intent = decodeImportIntentId(res.data?.import_intent_id);
      if (intent) importIntentIdRef.current = intent;
      const decoded = decodePairStatus(res.data?.status ?? '');
      if (decoded === 'paired') {
        go('paired');
        track(AnalyticsEvents.IMPORT_PAIRED, { platform: platformRef.current });
        void fetchReadiness();
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
      if (!mountedRef.current || statusRef.current !== 'waiting' || codeRef.current !== code) return;
      const s = axiosStatus(err);
      const ref = extractRequestId(err);
      if (s === 401 || s === 403) {
        go('authExpired', ref);
        emitFailed('auth');
        return;
      }
      if (s === 404) {
        go('unavailable', ref);
        emitFailed('unavailable');
        return;
      }
      failureCountRef.current += 1;
      if (failureCountRef.current >= MAX_POLL_FAILURES) {
        go('failed', ref);
        emitFailed('network');
        return;
      }
      pollDelayRef.current = Math.min(pollDelayRef.current * POLL_BACKOFF, POLL_MAX_MS);
      pollTimerRef.current = setTimeout(doPoll, pollDelayRef.current);
    } finally {
      // Release only if this invocation still owns the live session; a superseded
      // (stale) poll must not clear a guard a fresh session's poll now holds.
      if (codeRef.current === code) pollInFlightRef.current = false;
    }
  }, [go, emitFailed, fetchReadiness]);

  const start = useCallback(async () => {
    if (!enabled) return; // fail closed: no network path when the feature is OFF
    const slug = platformRef.current;
    if (!slug) return;
    if (mintInFlightRef.current) return; // single-flight
    if (statusRef.current === 'minting' || statusRef.current === 'waiting') return; // no duplicate intent
    // Minting before the mirror has been read would supersede (server-side
    // expire) a still-live session the coach may already be typing into the
    // extension. Defer until hydrated so we resume it instead; never drop.
    if (!hydratedRef.current) {
      pendingStartRef.current = true;
      // A retry from the bounded-wait terminal is a visible new wait, not a
      // silent no-op: return to idle so the panel shows it and the timer below
      // may settle it again.
      if (statusRef.current === 'identityUnavailable') {
        statusRef.current = 'idle';
        emit('idle', null);
      }
      // Bounded wait: only while the identity has NEVER resolved on this mount
      // (cold start / failed hydration). The A→null sign-out window is a
      // different case: RootNavigator tears the coach tree down, so no timer.
      if (!identityEverResolvedRef.current && !identityTimerRef.current) {
        identityTimerRef.current = setTimeout(() => {
          identityTimerRef.current = null;
          if (!mountedRef.current) return;
          if (identityEverResolvedRef.current || !pendingStartRef.current) return;
          if (statusRef.current !== 'idle') return;
          pendingStartRef.current = false;
          statusRef.current = 'identityUnavailable';
          emit('identityUnavailable', null);
          emitFailed('identity');
        }, IDENTITY_WAIT_MS);
      }
      return;
    }
    let key = idempotencyKeyRef.current;
    let nonce = setupNonceRef.current;
    if (!key || !nonce) {
      try {
        key = key ?? generateIdempotencyKey();
        nonce = nonce ?? generateIdempotencyKey();
      } catch (err) {
        // No CSPRNG means no safe retry key or nonce; minting anyway risks a
        // duplicate session, so fail visibly instead (Rule 19 has no soft
        // fallback). Never log the values themselves.
        logger.warn('[useExtensionPairing] idempotency key unavailable', err);
        go('failed');
        emitFailed('network');
        return;
      }
      idempotencyKeyRef.current = key;
      setupNonceRef.current = nonce;
    }
    // The mint belongs to the coach signed in NOW; a response that lands after
    // the identity changed is discarded, never mirrored under the new coach.
    const owner = userIdRef.current;
    const attempt = ++mintEpochRef.current;
    // True once this attempt has been superseded: unmounted, cancelled/ended
    // (status left 'minting'), a newer attempt started (cancel→retry, A→B→A),
    // or the identity changed before the retire effect ran. Read fresh each
    // time — TS narrowed statusRef from the guard above, hence the cast.
    const stale = () =>
      !mountedRef.current ||
      (statusRef.current as PairingStatus) !== 'minting' ||
      mintEpochRef.current !== attempt ||
      userIdRef.current !== owner;
    go('minting'); // also releases any superseded attempt's in-flight flag
    mintInFlightRef.current = true;
    track(AnalyticsEvents.IMPORT_PAIRING_STARTED, { platform: slug });
    try {
      // Persist the nonce BEFORE the request (E01): if the OS kills the app
      // between /pair/init and its reply, the relaunch finds this pre-init
      // record and replays the same nonce, so the server can hand back the
      // coach's own attempt instead of a blind second mint. A write failure is
      // logged and the flow continues — degraded durability, not a dead flow;
      // the stale record it could not overwrite is cleared so an OLD code
      // cannot be restored under this new intent.
      const uid = owner;
      if (uid) {
        try {
          await writeImportPairingMirror({
            version: IMPORT_PAIRING_MIRROR_VERSION,
            userId: uid,
            platformId: slug,
            code: null,
            expiresAt: null,
            idempotencyKey: key,
            setupNonce: nonce,
          });
        } catch (err) {
          logger.warn('[useExtensionPairing] pre-init mirror write failed', err);
          void clearImportPairingMirror(uid);
        }
        if (stale()) {
          if (userIdRef.current !== owner) void clearImportPairingMirror(uid);
          return;
        }
      }
      const res = await extensionPairApi.init(slug, key, nonce);
      // Late result of a superseded attempt → discard (no HTTP abort). If the
      // coach changed meanwhile, the pre-init record THIS attempt wrote is
      // removed too (same rule as the post-write branch below): nothing this
      // attempt put on disk survives an owner change.
      if (stale()) {
        if (uid && userIdRef.current !== owner) void clearImportPairingMirror(uid);
        return;
      }
      const code = res.data?.pairing_code ?? null;
      if (!code) {
        go('failed');
        emitFailed('network');
        return;
      }
      // Server setup correlation, when issued. Captured only; never drives state.
      const intent = decodeImportIntentId(res.data?.import_intent_id);
      importIntentIdRef.current = intent;
      // Persist BEFORE showing the code: the coach's next action is to leave the
      // app, so a code on screen that is not on disk is exactly the state that
      // an OS kill turns into an orphaned server-side session. A write failure
      // is logged and the flow continues — degraded durability, not a dead flow.
      if (uid) {
        try {
          await writeImportPairingMirror({
            version: IMPORT_PAIRING_MIRROR_VERSION,
            userId: uid,
            platformId: slug,
            code,
            // Stored verbatim for provenance/support only; never clock-compared.
            expiresAt: res.data?.expires_at ?? '',
            idempotencyKey: key,
            setupNonce: nonce,
            ...(intent ? { importIntentId: intent } : {}),
          });
        } catch (err) {
          logger.warn('[useExtensionPairing] mirror write failed', err);
        }
        if (stale()) {
          // The write above may have landed AFTER the coach signed out — i.e.
          // after signOut() swept `import_pairing_session:<owner>` — leaving a
          // live code on disk for a coach who is gone. Remove what we wrote.
          // Bounded residual: a process death between the write and this clear
          // leaves a user-scoped, payload-checked, server-expiring record that
          // only that same coach could ever read back.
          if (userIdRef.current !== owner) void clearImportPairingMirror(uid);
          return;
        }
      }
      codeRef.current = code;
      pollDelayRef.current = POLL_BASE_MS;
      failureCountRef.current = 0;
      statusRef.current = 'waiting';
      emit('waiting', code);
      track(AnalyticsEvents.IMPORT_PAIRING_CODE_READY, { platform: slug });
      pollTimerRef.current = setTimeout(doPoll, POLL_BASE_MS);
    } catch (err) {
      // Rejection of a superseded attempt → discard; in particular an old
      // owner's 401 must never end (or clear the mirror of) a newer session.
      if (stale()) return;
      const s = axiosStatus(err);
      const ref = extractRequestId(err);
      const domainCode = decodePairInitErrorCode(axiosErrorCode(err));
      if (s === 401 || s === 403) {
        go('authExpired', ref);
        emitFailed('auth');
      } else if (s === 404) {
        go('unavailable', ref);
        emitFailed('unavailable');
      } else if (s === 409 && domainCode === 'setup_nonce_conflict') {
        // The nonce names an attempt the server already bound to ANOTHER
        // platform ("no mutation"). Discard it — and the Rule 19 key with it —
        // so the coach's retry is a genuinely new intent ("Get a new code").
        setupNonceRef.current = null;
        idempotencyKeyRef.current = null;
        go('failed', ref, 'conflict');
        emitFailed('conflict');
      } else if (s === 410 && domainCode === 'setup_challenge_unavailable') {
        // The challenge behind this nonce is gone. Expired-class: the code is no
        // longer valid; the server keeps the durable setup. `go('expired')`
        // retires key + nonce, so the retry mints a fresh challenge rather than
        // replaying a nonce the server just refused.
        go('expired', ref, 'challengeUnavailable');
        track(AnalyticsEvents.IMPORT_PAIRING_EXPIRED, { platform: slug });
      } else {
        // Includes 400 `code_mint_failed`, a 409/410 without its contracted
        // code, 429 and transport faults: generic retryable failure, same intent.
        go('failed', ref);
        emitFailed('network');
      }
    } finally {
      // Release only if this attempt still holds the guard; a superseded
      // attempt must not free a guard a newer attempt now holds.
      if (mintEpochRef.current === attempt) mintInFlightRef.current = false;
    }
  }, [enabled, go, doPoll, emit, emitFailed]);

  startRef.current = start;

  /**
   * Rehydrate a session that survived a process death. Runs once the coach id
   * is RESOLVED (not on first render, where `useCurrentUser()` is always null),
   * and before any mint is allowed through. Finding a record says only "we asked
   * for this and never saw it finish" — so we re-enter `waiting` and poll at
   * once, letting the server /status contract decide what the session actually
   * is. A record minted for a DIFFERENT platform than this mount's is not
   * shown under the wrong platform: it is discarded, and the mint that follows
   * supersedes it server-side (single-active-code invariant). A start() that
   * raced this read is replayed here rather than lost.
   */
  useEffect(() => {
    if (ownerRef.current !== userId) {
      // Identity changed on this mount (A→null on sign-out, or A→B). Whatever
      // session is in memory belongs to the previous owner: retire it locally
      // — no storage write, the old owner's record is theirs (sign-out wipes
      // it) — and re-hydrate for the new identity. Any /pair/init or /status
      // still outstanding is discarded by the status/code checks it lands on.
      // The coach is still on the awaiting screen, so a session that was live
      // is carried forward as a pending intent for the new owner.
      const hadLive = statusRef.current === 'minting' || statusRef.current === 'waiting';
      if (ownerRef.current !== null && (hadLive || hydratedRef.current)) {
        clearTimers();
        pollInFlightRef.current = false;
        // A mint still outstanding for the old owner no longer counts as this
        // owner's in-flight intent (its result is discarded above); the
        // 'minting' status check remains the duplicate-intent guard.
        mintInFlightRef.current = false;
        codeRef.current = null;
        idempotencyKeyRef.current = null;
        setupNonceRef.current = null;
        importIntentIdRef.current = null;
        statusRef.current = 'idle';
        emit('idle', null);
        if (hadLive) pendingStartRef.current = true;
      }
      hydratedRef.current = false;
      ownerRef.current = userId;
    }
    if (!userId) return; // identity unknown: stay unhydrated, start() keeps deferring
    identityEverResolvedRef.current = true;
    clearIdentityTimer();
    // A bounded wait that already gave up is superseded by the identity
    // arriving: return to idle so the deferred intent below can proceed.
    if (statusRef.current === 'identityUnavailable') {
      statusRef.current = 'idle';
      emit('idle', null);
      pendingStartRef.current = true;
    }
    let abandoned = false;
    void (async () => {
      const restored = enabled ? await readImportPairingMirror(userId) : null;
      if (abandoned || !mountedRef.current) return;
      if (restored && statusRef.current === 'idle') {
        const slug = platformRef.current;
        if (restored.platformId === slug) {
          hydratedRef.current = true;
          idempotencyKeyRef.current = restored.idempotencyKey;
          setupNonceRef.current = restored.setupNonce;
          importIntentIdRef.current = restored.importIntentId ?? null;
          if (restored.code === null) {
            // Pre-init record (E01): /pair/init never replied before the kill.
            // There is nothing to show and nothing to poll; the key + nonce are
            // now in memory, so the start() that follows (the panel's mount
            // start, or one that raced this read) REPLAYS the same intent
            // instead of minting blind. No restored event: no code was restored.
            if (pendingStartRef.current) {
              pendingStartRef.current = false;
              startRef.current?.();
            }
            return;
          }
          codeRef.current = restored.code;
          pollDelayRef.current = POLL_BASE_MS;
          failureCountRef.current = 0;
          statusRef.current = 'waiting';
          emit('waiting', restored.code);
          track(AnalyticsEvents.IMPORT_PAIRING_RESTORED, { platform: restored.platformId });
          pollTimerRef.current = setTimeout(doPoll, 0);
          return;
        }
        // Minted for another platform: never show it under this one. With a slug
        // present the mint below supersedes it, so drop the record — AWAITED, so
        // the clear can never land after (and erase) the new session's write;
        // with no slug nothing will mint (start() refuses), so leave it on disk.
        if (slug !== null) {
          try {
            await clearImportPairingMirror(userId);
          } catch (err) {
            logger.warn('[useExtensionPairing] stale mirror clear failed', err);
          }
          if (abandoned || !mountedRef.current) return;
        }
      }
      hydratedRef.current = true;
      if (pendingStartRef.current) {
        pendingStartRef.current = false;
        startRef.current?.();
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [enabled, doPoll, clearTimers, clearIdentityTimer, emit, userId]);

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
      clearIdentityTimer();
    };
  }, [clearTimers, clearIdentityTimer]);

  return { ...state, start, retry: start, cancel };
}
