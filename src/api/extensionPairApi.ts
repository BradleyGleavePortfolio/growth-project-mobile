/**
 * extensionPairApi — typed mobile client for the two coach-callable endpoints
 * of the v0.3 extension-import pairing contract (backend OpenAPI slice frozen in
 * growth-project-backend PR #504). These are the ONLY import endpoints a mobile
 * client may call: `pair/redeem` and every `scout/*` route are extension-only
 * writers, and no mobile-readable import-progress contract exists.
 *
 * Paths are relative to the axios `baseURL`, which already carries the backend
 * `/api` global prefix (see src/config/env.ts), so the wire paths resolve to
 * `/api/extension/pair/init` and `/api/extension/pair/status`.
 *
 * This module is a thin transport seam only: it never inspects, logs, or stores
 * the pairing code or any token — error classification and retry policy live in
 * the useExtensionPairing hook.
 */
import api from '../services/api';
import type { PairInitResponse, PairStatusResponse } from '../types/extensionImport';

const PAIR_INIT_PATH = '/extension/pair/init';
const PAIR_STATUS_PATH = '/extension/pair/status';

export const extensionPairApi = {
  /** Mint a 6-digit pairing code bound to the coach + chosen source platform. */
  init: (chosenPlatform: string) =>
    api.post<PairInitResponse>(PAIR_INIT_PATH, { chosen_platform: chosenPlatform }),

  /** Poll the lifecycle of a code the caller minted. Body-only (never a query). */
  status: (code: string) => api.post<PairStatusResponse>(PAIR_STATUS_PATH, { code }),
};
