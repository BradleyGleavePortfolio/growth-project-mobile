/**
 * extensionPairApi — typed mobile client for the coach-callable endpoints of
 * the extension-import pairing contract, consumer-frozen (S7-2′) at
 * `2.0.0-c1-s1.1` / backend `a0ea1bea` (see src/types/extensionImport.ts and
 * the fixture under src/types/__fixtures__/). Mobile calls ONLY the bearer-
 * authenticated setup routes: `pair/init`, `pair/status`, `pair/current`.
 * `pair/redeem` is UNAUTHENTICATED and exchanges the code for coach-bound
 * tokens — it is an extension-only route and this module deliberately has no
 * method for it. `pair/session` and every `scout/*` route are not wired here.
 *
 * Paths are relative to the axios `baseURL`, which already carries the backend
 * `/api` global prefix (see src/config/env.ts), so the wire paths resolve to
 * `/api/extension/pair/init`, `/api/extension/pair/status` and
 * `/api/extension/pair/current`.
 *
 * This module is a thin transport seam only: it never inspects, logs, or stores
 * the pairing code, the setup nonce, or any token. Every secret-adjacent value
 * travels in the POST BODY (never a path or query string, which would leak into
 * proxy logs / history / APM) — error classification and retry policy live in
 * the useExtensionPairing hook.
 */
import api from '../services/api';
import type {
  PairCurrentRequest,
  PairCurrentResponse,
  PairInitRequest,
  PairInitResponse,
  PairStatusRequest,
  PairStatusResponse,
} from '../types/extensionImport';

const PAIR_INIT_PATH = '/extension/pair/init';
const PAIR_STATUS_PATH = '/extension/pair/status';
const PAIR_CURRENT_PATH = '/extension/pair/current';

export const extensionPairApi = {
  /**
   * Mint a 6-digit pairing code bound to the coach + chosen source platform.
   *
   * `idempotencyKey` is Rule 19: the caller mints it once per coach intent and
   * replays the same value on every retry. The current backend does not read
   * the header; it is sent for correlation and forward compatibility.
   *
   * `setupNonce` is the C1 `setup_nonce` (uuid) — the client-saved recovery key
   * the caller persists BEFORE the first attempt and replays on a same-intent
   * retry, so the server can hand back the coach's own attempt instead of
   * minting a second one. It authorises nothing. The contract answers a nonce
   * reused for another platform with 409 `setup_nonce_conflict` and a nonce
   * whose challenge is gone with 410 `setup_challenge_unavailable`; both
   * propagate to the caller untouched.
   */
  init: (chosenPlatform: string, idempotencyKey: string, setupNonce: string) => {
    const body: PairInitRequest = { chosen_platform: chosenPlatform, setup_nonce: setupNonce };
    return api.post<PairInitResponse>(PAIR_INIT_PATH, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },

  /** Poll the lifecycle of a code the caller minted. Body-only (never a query). */
  status: (code: string) => {
    const body: PairStatusRequest = { code };
    return api.post<PairStatusResponse>(PAIR_STATUS_PATH, body);
  },

  /**
   * Read the coach's owned setup. With a saved `setupNonce` the server returns
   * that exact owned attempt; with none it returns the current setup. Setup
   * correlation only: the response never carries a code or token and never
   * means accepted Start or import completion. Decode the reply through
   * `decodePairCurrentResponse` (fails closed to `'unknown'`), never cast it.
   */
  current: (setupNonce?: string) => {
    const body: PairCurrentRequest = setupNonce ? { setup_nonce: setupNonce } : {};
    return api.post<PairCurrentResponse>(PAIR_CURRENT_PATH, body);
  },
};
