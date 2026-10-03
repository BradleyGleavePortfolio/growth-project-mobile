/**
 * S12-B3 (M-bind) — typed, fail-closed boundary for the two server reads the
 * coach's phone uses to show an import run's verdict:
 *
 *   - GET /api/scout/import/status?intent_id=…  (schema `ScoutImportStatusResult`)
 *   - GET /api/scout/reconstruct/roster?intent_id=… (schema `ScoutRosterResult`,
 *     mounted only behind EXPO_PUBLIC_FF_IMPORT_REVIEW, default OFF)
 *
 * Source of truth: backend `docs/contracts/importer-openapi.json` at the landed
 * integration/importer commit 54be96f1 (contract version `2.0.0-c1-s2.0`,
 * artifact sha256 889d25c6…, byte-identical to the 7fdcbc04 artifact the S11-C
 * readiness fixture pins). The two path items and their schema closure are
 * projected mechanically into `./__fixtures__/s12b3ScoutStatusSurface.54be96f1.json`
 * and the contract test asserts every closed enum below equals the fixture's.
 *
 * Honesty rules (mission invariant 6; S12 L141):
 *   - Every rendered value comes from a server field. Nothing is inferred.
 *   - A null / absent / malformed value is NOT KNOWN — never 0, never "no".
 *   - An enum value this app does not recognise decodes to the explicit
 *     `'unknown'` member (never a crash, never a success).
 *   - `claimed_status` is the extension's claim — INPUT to the server arbiter,
 *     never the verdict — so it is decoded for completeness but never shown.
 *   - A legacy-mode terminal is the extension's own report reflected verbatim
 *     (the server did not arbitrate it); the UI must say so.
 */

/** `ScoutImportStatusResult.status` (backend SCOUT_READ_STATUSES). */
export const RUN_READ_STATUSES = [
  'running',
  'success',
  'partial',
  'failed',
  'complete',
  'blocked',
  'cancelled',
  'timed_out',
] as const;
export type RunReadStatus = (typeof RUN_READ_STATUSES)[number];

/** Legacy rows only ever project these three terminals (the extension's claim). */
export const LEGACY_TERMINAL_STATUSES = ['success', 'partial', 'failed'] as const;
/** Server rows never project `success` (backend CQ-18). */
export const SERVER_TERMINAL_STATUSES = [
  'complete',
  'partial',
  'blocked',
  'failed',
  'cancelled',
  'timed_out',
] as const;

export const RUN_MODES = ['legacy', 'server'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const RUN_PHASES = ['discovering', 'transferring', 'reconciling'] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/**
 * Reason codes this app recognises from the frozen contract at 54be96f1. Append-only,
 * in the backend's own order (src/scout/lifecycle/reason-codes.ts `RUN_REASON_CODES`).
 */
export const CONTRACT_RUN_REASON_CODES = [
  'reconciliation_not_performed',
  'cancelled_by_coach',
  'deadline_exceeded',
  'transfer_failed',
  'unresolved_family',
  'revoked',
  'unresolved_identities',
  'relationship_unverified',
  'coverage_basis_unknown',
] as const;

/**
 * Reason codes the backend is ADDING, recognised here ahead of the contract artifact so a
 * newer server never reads as "not recognised" for them. Backend lane S15a appends
 * `no_usable_result`: a server run that produced zero usable native/preserved results
 * settles `failed` (never `partial`) with this reason. Same closed-enum style: an exact
 * literal, appended after the contract members; any other unrecognised string still
 * decodes to `'unknown'`. When the backend artifact carrying it lands, re-pin the fixture
 * and fold these into `CONTRACT_RUN_REASON_CODES` (the contract test enforces this list
 * stays disjoint from the pinned fixture, so a re-pin makes that test fail until folded).
 */
export const PENDING_RUN_REASON_CODES = ['no_usable_result'] as const;

export const RUN_REASON_CODES = [...CONTRACT_RUN_REASON_CODES, ...PENDING_RUN_REASON_CODES] as const;
export type RunReasonCode = (typeof RUN_REASON_CODES)[number];

export const CLAIMED_STATUSES = ['success', 'partial', 'failed'] as const;
export type ClaimedStatus = (typeof CLAIMED_STATUSES)[number];

/** Nullable closed enum, decoded: a member, `null` (server says not known), or `'unknown'` (unrecognised). */
export type Decoded<T extends string> = T | null | 'unknown';

/**
 * The verdict the UI may render. `status: 'unknown'` covers an unrecognised
 * status, an unrecognised mode, and a status the server's own projection rules
 * can never emit for that mode (a server `success`; a legacy
 * `complete|blocked|cancelled|timed_out`) — every one of those reads as
 * "status not recognised", never as success.
 */
export interface DecodedRunStatus {
  intentId: string;
  status: RunReadStatus | 'unknown';
  mode: RunMode | 'unknown';
  phase: Decoded<RunPhase>;
  reasonCode: Decoded<RunReasonCode>;
  /** Extension's stored claim — decoded, NEVER rendered as the verdict. */
  claimedStatus: Decoded<ClaimedStatus>;
  /** ISO-8601 string exactly as the server sent it, or null when absent/invalid. */
  completedAt: string | null;
  startedAt: string | null;
}

export function isTerminal(status: DecodedRunStatus['status']): boolean {
  return status !== 'running' && status !== 'unknown';
}

function decodeEnum<T extends string>(raw: unknown, members: readonly T[]): Decoded<T> {
  if (raw === null || raw === undefined) return null;
  return typeof raw === 'string' && (members as readonly string[]).includes(raw) ? (raw as T) : 'unknown';
}

/** A date-time string the server sent, kept verbatim only when it parses; anything else is not known. */
export function decodeIsoTime(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

/**
 * Decode a 200 body of GET /api/scout/import/status for the intent the caller
 * asked about. Returns `undefined` (the whole reading is unknown) when the body
 * is not an object, lacks a string `intent_id`, or names a DIFFERENT intent than
 * the one requested (a mismatched reading is discarded, never attached).
 * Otherwise every field is decoded independently and fails closed on its own.
 */
export function decodeRunStatus(raw: unknown, requestedIntentId: string): DecodedRunStatus | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>;
  if (typeof v.intent_id !== 'string' || v.intent_id.length === 0) return undefined;
  if (v.intent_id !== requestedIntentId) return undefined;

  const mode = decodeEnum(v.mode, RUN_MODES);
  const rawStatus = decodeEnum(v.status, RUN_READ_STATUSES);
  let status: DecodedRunStatus['status'] = rawStatus === null ? 'unknown' : rawStatus;
  if (mode === null || mode === 'unknown') {
    // Legacy and server terminals mean different things (claim vs verdict);
    // without a known mode the verdict cannot be read honestly.
    status = 'unknown';
  } else if (status !== 'unknown' && status !== 'running') {
    const allowed: readonly string[] = mode === 'server' ? SERVER_TERMINAL_STATUSES : LEGACY_TERMINAL_STATUSES;
    if (!allowed.includes(status)) status = 'unknown';
  }

  const reasonCode = decodeEnum(v.reason_code, RUN_REASON_CODES);
  // `no_usable_result` is only ever written with a server `failed` terminal (S15a: zero
  // usable results settles failed, never partial). Any other pairing is a reading the
  // server's own rules cannot produce — e.g. "partly finished" + "nothing usable" — so
  // the verdict is not recognised rather than shown as a contradiction.
  if (reasonCode === 'no_usable_result' && !(mode === 'server' && status === 'failed')) {
    status = 'unknown';
  }

  return {
    intentId: v.intent_id,
    status,
    mode: mode === null ? 'unknown' : mode,
    phase: decodeEnum(v.phase, RUN_PHASES),
    reasonCode,
    claimedStatus: decodeEnum(v.claimed_status, CLAIMED_STATUSES),
    completedAt: decodeIsoTime(v.completed_at),
    startedAt: decodeIsoTime(v.started_at),
  };
}

// ── GET /api/scout/reconstruct/roster ────────────────────────────────────────

/** Prisma `PersonState` as emitted in `ScoutRosterPersonDto.state`. */
export const ROSTER_PERSON_STATES = ['InvitePending', 'Invited', 'Claimed', 'Suspended', 'Deleted'] as const;
export type RosterPersonState = (typeof ROSTER_PERSON_STATES)[number];

/**
 * One roster row the UI may render. PII-minimal by construction: the decoder
 * keeps only the opaque id, the display name and the state. Source platform
 * and source record id are provenance, never shown to the coach here.
 */
export interface DecodedRosterPerson {
  id: string;
  displayName: string | null;
  state: RosterPersonState | 'unknown';
}

/**
 * Ledger-derived accounting; `undefined` as a whole when any of the four
 * roster-family counts is not a non-negative integer. `staged` counts ONLY the
 * intent's rows the source registry classifies to the roster (clients) family.
 *
 * `unclassified` (S11-E, additive): the intent's staged rows no source spec
 * classifies to any family; never folded into `staged`. Decoded on its own:
 * a non-negative integer, or `null` when absent (older server) or malformed —
 * never defaulted to 0, and a bad value never voids the other four counts.
 */
export interface DecodedRosterAccounting {
  staged: number;
  reconstructed: number;
  skipped: number;
  failed: number;
  unclassified: number | null;
}

export interface DecodedRosterPage {
  intentId: string;
  accounting?: DecodedRosterAccounting;
  persons: DecodedRosterPerson[];
  nextCursor: string | null;
  hasMore: boolean;
  /** `true` / `false` exactly as sent; `null` when absent or not a boolean (not known). */
  rosterBridgePending: boolean | null;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function decodeAccounting(raw: unknown): DecodedRosterAccounting | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const a = raw as Record<string, unknown>;
  if (!isCount(a.staged) || !isCount(a.reconstructed) || !isCount(a.skipped) || !isCount(a.failed)) {
    return undefined;
  }
  return {
    staged: a.staged,
    reconstructed: a.reconstructed,
    skipped: a.skipped,
    failed: a.failed,
    unclassified: isCount(a.unclassified) ? a.unclassified : null,
  };
}

/**
 * Decode one roster page for the requested intent. `undefined` (the page is
 * unknown) when the body is not an object, names another intent, or `persons`
 * / `page` are structurally missing. A person row without a string id is
 * dropped (it cannot be keyed); an unrecognised state decodes to `'unknown'`.
 */
export function decodeRosterPage(raw: unknown, requestedIntentId: string): DecodedRosterPage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>;
  if (v.intent_id !== requestedIntentId) return undefined;
  if (!Array.isArray(v.persons)) return undefined;
  const page = v.page;
  if (!page || typeof page !== 'object' || Array.isArray(page)) return undefined;
  const p = page as Record<string, unknown>;

  const persons: DecodedRosterPerson[] = [];
  for (const row of v.persons) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.length === 0) continue;
    const state = decodeEnum(r.state, ROSTER_PERSON_STATES);
    persons.push({
      id: r.id,
      displayName: typeof r.display_name === 'string' && r.display_name.trim().length > 0 ? r.display_name : null,
      state: state === null ? 'unknown' : state,
    });
  }
  const nextCursor = typeof p.next_cursor === 'string' && p.next_cursor.length > 0 ? p.next_cursor : null;
  const accounting = decodeAccounting(v.accounting);
  return {
    intentId: requestedIntentId,
    ...(accounting ? { accounting } : {}),
    persons,
    nextCursor,
    // Never follow a cursor the server did not send, whatever has_more says.
    hasMore: p.has_more === true && nextCursor !== null,
    rosterBridgePending: typeof v.roster_bridge_pending === 'boolean' ? v.roster_bridge_pending : null,
  };
}
