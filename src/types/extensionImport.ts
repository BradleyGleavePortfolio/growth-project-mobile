/**
 * Frozen typed boundary for the v0.3 browser-extension import flow. Mirrors the
 * backend OpenAPI pair surface, consumer-frozen (S7-2′) at contract version
 * `2.0.0-c1-s1.1`, backend commit `a0ea1bea92ba830d5ffb712a3dcb26e7be0a0992`,
 * artifact `docs/contracts/importer-openapi.json`. The mechanically extracted
 * pair-surface subset lives in `./__fixtures__/c1PairSurface.a0ea1bea.json`
 * with the recorded source sha; the consumer contract test decodes it through
 * the functions below. These shapes are the single source of truth the mobile
 * client codes against, not invented.
 *
 * S11-C addendum (UX-03/04, D-S11-5): `PairCurrentResponse` (returned by both
 * pair/current and pair/session) now MAY carry an optional `readiness` block,
 * mirrored from backend PR #560 head `7fdcbc044dba1747d0db2f2750ced951f3b6b752`
 * (same artifact path, schemas `PairReadiness` / `PairSessionResult.readiness`).
 * That later slice is pinned separately in
 * `./__fixtures__/s11cPairSurface.7fdcbc04.json` — see decodeReadiness below
 * and the `S11-C readiness` describe block in the contract test.
 *
 * Mobile-callable (bearer): POST /api/extension/pair/init, pair/status,
 * pair/current, pair/session. Extension-only (never mobile-callable):
 * pair/redeem (UNAUTHENTICATED; exchanges the code for coach-bound tokens),
 * scout/ingest, scout/progress, scout/ingest/complete. There is NO
 * mobile-readable import progress endpoint, so the UI never claims live
 * progress or completion.
 *
 * `import_intent_id` is server-issued SETUP CORRELATION only — never
 * authorization, eligibility, accepted Start, connection, or result state.
 * `setup_nonce` is a client-saved recovery key for an owned attempt; it
 * authorises nothing. Neither the pairing code nor the nonce may ever enter a
 * URL, log, analytics event, or telemetry payload.
 */

export interface PairInitRequest {
  chosen_platform: string;
  /** Optional saved setup nonce (uuid): recover this owned attempt on retry. */
  setup_nonce?: string;
}

/** `expires_at` is server-authoritative ISO-8601; derive any countdown from it. */
export interface PairInitResponse {
  pairing_code: string;
  expires_at: string;
  /** Server-issued setup correlation. Absent on legacy unbound rows. */
  import_intent_id?: string;
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
  /** Server-issued setup correlation when bound. Absent on legacy rows. */
  import_intent_id?: string;
}

export function decodePairStatus(raw: string): DecodedPairStatus {
  return raw === 'pending' || raw === 'paired' || raw === 'expired' ? raw : 'unknown';
}

/**
 * `import_intent_id` as it appears on the wire (uuid string, optional). Any
 * absent, empty, or non-string value decodes to null — a correlation handle is
 * either the server's exact string or nothing, never a coerced placeholder.
 */
export function decodeImportIntentId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** POST /api/extension/pair/current body. Empty reads the current owned setup. */
export interface PairCurrentRequest {
  setup_nonce?: string;
}

/** POST /api/extension/pair/session body (owned durable setup by server id). */
export interface PairSessionRequest {
  import_intent_id: string;
}

/**
 * S11-C (D-S11-5) advisory setup-to-run readiness, raw wire shape mirroring
 * backend `PairReadiness` (backend PR #560, `7fdcbc044dba1747d0db2f2750ced951f3b6b752`,
 * `docs/contracts/importer-openapi.json` schema `PairReadiness`; service/DTO at
 * the same commit: src/extension-pair/extension-pair.{dto,service}.ts). Present
 * only inside `PairCurrentResponse.readiness` on `pair/session` and
 * `pair/current` — `pair/status` never carries it. Decode via
 * decodeReadiness, never cast: any malformed/unrecognised value must decode to
 * `undefined` (not known), never coerced into a lifecycle member.
 *
 * D-S11-5 honesty rules (binding on every consumer of the decoded value):
 *   - `run` absent (the whole block absent) means NOT KNOWN — never rendered
 *     as "no"/"not ready"/zero.
 *   - `source_declared: true` may read "declaration received"; NEVER "source
 *     authorized", "source ready", "connected", or "verified". Real source
 *     authorization stays unknown (owner-reserved verifier).
 *   - `run: 'terminal'` carries no detail here; terminal status/reasons stay
 *     on the existing import status read (GET /api/scout/import/status) —
 *     this block never invents them.
 *   - `declared_platforms` is a COUNT only (null when run is 'none'); never a
 *     platform name.
 */
export const READINESS_RUN_STATES = ['none', 'open', 'terminal'] as const;
export type ReadinessRunState = (typeof READINESS_RUN_STATES)[number];

export interface PairReadiness {
  run: string; // raw wire value — decode via decodeReadiness, never cast
  source_declared: boolean;
  declared_platforms: number | null;
}

/**
 * Decoded readiness the UI is allowed to render. `run` is narrowed to the
 * closed enum; `declaredPlatforms` is a bare count. There is no `unknown`
 * member on `run` here — an unrecognised/malformed block decodes to
 * `undefined` at the `decodeReadiness` boundary instead, so a caller that has
 * a `DecodedReadiness` at all is holding a genuinely known reading.
 */
export interface DecodedReadiness {
  run: ReadinessRunState;
  sourceDeclared: boolean;
  declaredPlatforms: number | null;
}

/**
 * Strict parse of the optional `readiness` wire block. Fails closed to
 * `undefined` (not `false`/`0`/a fabricated member) for: an absent block, a
 * non-object, a `run` outside the closed enum, a non-boolean
 * `source_declared`, or a `declared_platforms` that is not `null` and not a
 * finite number. A `declared_platforms` of `null` is preserved verbatim (it is
 * only ever null when `run` is `'none'` per contract, but this decoder does
 * not enforce that cross-field rule — an inconsistent-but-well-typed payload
 * still decodes; the render layer only ever displays the count, never asserts
 * the invariant itself).
 */
export function decodeReadiness(raw: unknown): DecodedReadiness | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>;
  const run = v.run;
  if (typeof run !== 'string' || !(READINESS_RUN_STATES as readonly string[]).includes(run)) {
    return undefined;
  }
  if (typeof v.source_declared !== 'boolean') return undefined;
  const declared = v.declared_platforms;
  if (declared !== null && (typeof declared !== 'number' || !Number.isFinite(declared))) {
    return undefined;
  }
  return {
    run: run as ReadinessRunState,
    sourceDeclared: v.source_declared,
    declaredPlatforms: declared,
  };
}

/**
 * Wire shape of the backend `PairSessionResult`, returned by BOTH
 * pair/current and pair/session. Setup only: it never carries a code or a
 * token and never means accepted Start or import completion. Decode via
 * decodePairCurrentResponse, never cast. `readiness` is OPTIONAL (S11-C,
 * D-S11-5): absent means not known, never "no" — see decodeReadiness above.
 */
export interface PairCurrentResponse {
  import_intent_id: string;
  status: string; // raw wire value — decode via decodePairStatus
  chosen_platform: string;
  readiness?: PairReadiness;
}
export type PairSessionResponse = PairCurrentResponse;

/**
 * Decoded owned-setup reading. `status` fails closed to `'unknown'` — for an
 * unrecognised enum value AND for a payload that is not the contracted shape
 * (missing/empty required field, wrong type, non-object). `'unknown'` never
 * reads as paired. `importIntentId` and `chosenPlatform` are correlation /
 * display inputs only, never eligibility or connection truth. `readiness` is
 * `undefined` whenever the server omitted the block OR sent something
 * decodeReadiness could not parse — both read as NOT KNOWN (S11-C, D-S11-5),
 * never as a negative/zero reading.
 */
export interface DecodedPairCurrent {
  status: DecodedPairStatus;
  importIntentId: string | null;
  chosenPlatform: string | null;
  readiness?: DecodedReadiness;
}

export const UNKNOWN_PAIR_CURRENT: Readonly<DecodedPairCurrent> = Object.freeze({
  status: 'unknown' as const,
  importIntentId: null,
  chosenPlatform: null,
});

export function decodePairCurrentResponse(raw: unknown): DecodedPairCurrent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return UNKNOWN_PAIR_CURRENT;
  const v = raw as Record<string, unknown>;
  const importIntentId = decodeImportIntentId(v.import_intent_id);
  const chosenPlatform =
    typeof v.chosen_platform === 'string' && v.chosen_platform.length > 0 ? v.chosen_platform : null;
  if (importIntentId === null || chosenPlatform === null || typeof v.status !== 'string') {
    // Every field is `required` in the contract; a partial payload is not an
    // owned setup we can reason about, so the whole reading fails closed.
    return UNKNOWN_PAIR_CURRENT;
  }
  // readiness is OPTIONAL on the wire and decoded independently of the rest of
  // this payload's validity: a malformed/absent block never discards an
  // otherwise-valid setup reading, and a valid block is never attached to a
  // reading this function is about to reject above.
  const readiness = decodeReadiness(v.readiness);
  return {
    status: decodePairStatus(v.status),
    importIntentId,
    chosenPlatform,
    ...(readiness ? { readiness } : {}),
  };
}

/**
 * Domain `code` discriminants the pair/init contract pins on its error
 * envelopes: 400 `code_mint_failed` (optional — a ValidationPipe 400 carries
 * no code), 409 `setup_nonce_conflict` (required), 410
 * `setup_challenge_unavailable` (required). Anything else — including an
 * absent code — decodes to `'unknown'` and is handled as a generic failure.
 */
export const PAIR_INIT_ERROR_CODES = [
  'code_mint_failed',
  'setup_nonce_conflict',
  'setup_challenge_unavailable',
] as const;
export type PairInitErrorCode = (typeof PAIR_INIT_ERROR_CODES)[number];
export type DecodedPairInitErrorCode = PairInitErrorCode | 'unknown';

export function decodePairInitErrorCode(raw: unknown): DecodedPairInitErrorCode {
  return typeof raw === 'string' && (PAIR_INIT_ERROR_CODES as readonly string[]).includes(raw)
    ? (raw as PairInitErrorCode)
    : 'unknown';
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
