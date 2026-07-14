/**
 * Frozen typed boundary for the v0.3 browser-extension import flow. Mirrors the
 * backend OpenAPI slice frozen in growth-project-backend PR #504; these shapes
 * are the single source of truth the mobile client codes against, not invented.
 *
 * Mobile-callable: POST /api/extension/pair/init, POST /api/extension/pair/status.
 * Extension-only (never mobile-readable): pair/redeem, scout/ingest,
 * scout/progress, scout/ingest/complete. There is NO mobile-readable import
 * progress endpoint, so the UI never claims live progress or completion.
 */

export interface PairInitRequest {
  chosen_platform: string;
}

/** `expires_at` is server-authoritative ISO-8601; derive any countdown from it. */
export interface PairInitResponse {
  pairing_code: string;
  expires_at: string;
}

export interface PairStatusRequest {
  code: string;
}

/**
 * Both `status` and `terminal_status` are CLOSED enums in the backend contract,
 * constrained per direction: pair `status` is a server-derived RESPONSE field
 * (OpenAPI `enum` + `PAIR_STATUSES` TS union — no `@IsIn`, nothing inbound to
 * validate); scout `terminal_status` is an INBOUND field (OpenAPI `enum` +
 * `SCOUT_TERMINAL_STATUSES` const union + class-validator `@IsIn`). Mobile still
 * keeps the raw string on the wire and decodes defensively rather than
 * blind-casting: a recognised value maps to its lifecycle member; anything else
 * — a future/renamed/garbled/malformed value — resolves to `'unknown'`, never an
 * asserted member. Forward-compatible version-skew defense, not a claim the
 * contract is open: `'unknown'` NEVER reads as paired, complete, or success.
 */
export type PairStatus = 'pending' | 'paired' | 'expired';
export type DecodedPairStatus = PairStatus | 'unknown';

export interface PairStatusResponse {
  status: string; // raw wire value — decode via decodePairStatus, never cast
}

export function decodePairStatus(raw: string): DecodedPairStatus {
  return raw === 'pending' || raw === 'paired' || raw === 'expired' ? raw : 'unknown';
}

/** Terminal state the extension settles to; mobile cannot read it today. */
export type ImportTerminalStatus = 'success' | 'partial' | 'failed';
export type DecodedTerminalStatus = ImportTerminalStatus | 'unknown';

export function decodeTerminalStatus(raw: string): DecodedTerminalStatus {
  return raw === 'success' || raw === 'partial' || raw === 'failed' ? raw : 'unknown';
}

/** `message` is a string for domain errors, string[] for validation failures. */
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
  // ── Supported now (every member here is constructed and rendered) ────────
  | { phase: 'intro' }
  | { phase: 'customUrlEntry'; url: string; valid: boolean }
  | { phase: 'openingLogin'; platformId: string; loginUrl: string }
  | { phase: 'awaitingExtension'; platformId: string }
  | { phase: 'failed'; message: string }
  // ── Deferred vocabulary (constructed in PR-M2; see decision record) ──────
  | { phase: 'pairing'; pairingCode: string; expiresAt: string }
  | { phase: 'paired' }
  | { phase: 'learning' }
  | { phase: 'importing' }
  | { phase: 'partial'; summary?: string }
  | { phase: 'complete' }
  | { phase: 'cancelled' };

/** Phases this PR is allowed to render — the honest, contract-backed subset. */
export const SUPPORTED_IMPORT_PHASES = [
  'intro',
  'customUrlEntry',
  'openingLogin',
  'awaitingExtension',
  'failed',
] as const satisfies readonly ImportFlowState['phase'][];
