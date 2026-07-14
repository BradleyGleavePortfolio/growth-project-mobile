/**
 * extensionImport.ts — Frozen typed boundary for the v0.3 browser-extension
 * import flow. Mirrors the backend OpenAPI slice frozen in growth-project-backend
 * PR #504 (`docs/contracts/importer-openapi.json`). These shapes are the single
 * source of truth the mobile client codes against; they are NOT invented.
 *
 * Mobile-callable now (this PR ships the entry funnel; the pair mint/poll UX is
 * wired in the chained follow-up PR-M2 — see docs/importer/MOBILE_IMPORT_DECISION.md):
 *   POST /api/extension/pair/init    → PairInitResponse
 *   POST /api/extension/pair/status  → PairStatusResponse
 *
 * Extension-only (NOT mobile-callable — documented here so mobile never assumes
 * it can read them): /api/extension/pair/redeem, /api/scout/ingest,
 * /api/scout/progress, /api/scout/ingest/complete. There is NO mobile-readable
 * import-progress endpoint, so the mobile UI never claims live import progress
 * or completion from a contract that does not exist.
 */

/** Request to mint a pairing code. `chosen_platform` is a lowercase slug. */
export interface PairInitRequest {
  chosen_platform: string;
}

/**
 * Pairing-code mint response. `expires_at` is a server-authoritative ISO-8601
 * instant — the client MUST derive any countdown from it, never from the local
 * clock (Rule 16).
 */
export interface PairInitResponse {
  pairing_code: string;
  expires_at: string;
}

/** Request to poll a minted pairing code's status. */
export interface PairStatusRequest {
  code: string;
}

/** Server-side lifecycle of a minted pairing code. */
export type PairStatus = 'pending' | 'paired' | 'expired';

export interface PairStatusResponse {
  status: PairStatus;
}

/**
 * Terminal state the EXTENSION settles an import to via
 * POST /api/scout/ingest/complete. Documented for the mobile boundary; mobile
 * cannot read it today (no mobile-facing endpoint).
 */
export type ImportTerminalStatus = 'success' | 'partial' | 'failed';

/**
 * Truthful error envelope shared by the importer routes (backend PR #504).
 * `message` is a string for domain errors, string[] for validation failures.
 */
export interface ImportErrorEnvelope {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  /** Domain failure discriminant (e.g. 'expired', 'already_used', 'locked'). */
  code?: string;
  /** Correlation id echoed from the backend RequestId middleware, when present. */
  request_id?: string;
}

/**
 * Canonical mobile import-flow state model — ONE source of truth for the UI.
 * Only the states this PR can honestly support are constructed today; the
 * remainder are the frozen vocabulary the chained follow-up wires once the
 * live pair mint/poll (and a future mobile progress contract) land. The UI
 * never reports `complete` on a partial, unknown, or stale reading.
 */
export type ImportFlowState =
  // ── Supported now ──────────────────────────────────────────────────────
  | { phase: 'intro' }
  | { phase: 'platformSelected'; platformId: string }
  | { phase: 'customUrlEntry'; url: string; valid: boolean }
  | { phase: 'openingLogin'; platformId: string; loginUrl: string }
  | { phase: 'awaitingExtension'; platformId: string }
  // ── Deferred vocabulary (constructed in PR-M2; see decision record) ──────
  | { phase: 'pairing'; pairingCode: string; expiresAt: string }
  | { phase: 'paired' }
  | { phase: 'learning' }
  | { phase: 'importing' }
  | { phase: 'partial'; summary?: string }
  | { phase: 'complete' }
  | { phase: 'failed'; message: string }
  | { phase: 'cancelled' };

/** Phases this PR is allowed to render — the honest, contract-backed subset. */
export const SUPPORTED_IMPORT_PHASES = [
  'intro',
  'platformSelected',
  'customUrlEntry',
  'openingLogin',
  'awaitingExtension',
] as const satisfies readonly ImportFlowState['phase'][];
