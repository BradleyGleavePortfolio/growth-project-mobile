/**
 * importRunStatusAdapter — R1 (Roman status binding). The ONE pure mapping
 * from the authoritative server reading (`useImportRunStatus`, S12-B3) to the
 * Roman P2 view props (`ImportProgressViewProps` / `ImportResultViewProps`).
 *
 * This file imports ONLY types from `../../../types/importRunStatus` and
 * `../../../hooks/useImportRunStatus` — never the hook itself, never a
 * network/storage/analytics module. It is a pure function: same input always
 * produces the same output, no side effects, no timers, no inference beyond
 * what the server field already states (mission invariant — NORTH_STAR.md
 * "Verifies the result and reports the truth").
 *
 * Honesty rules this mapping is pinned to (R1_GRANT.md):
 *   - stale or unavailable stays honest: no reading, an error, a 404, an
 *     undecodable body, or an unrecognised status/mode all map to the P2
 *     views' own "not known" / "unavailable" presentation — never a guess.
 *   - `complete` is shown ONLY when the server says complete, and `partial`
 *     only when the server says partial. The server's own verdict IS the
 *     authority (S9 reconciliation settles `complete` before the server ever
 *     emits it) — `ImportRunVerdictCard` shows exactly this on main today, so
 *     this Roman binding must never regress the coach to a lesser
 *     `unavailable` for the same read. Because this hook's reading carries no
 *     native write summary (verified client count, relationships, readback —
 *     `useImportRunStatus` decodes only status, mode, phase, reason code and
 *     timestamps, src/types/importRunStatus.ts), `ImportResultView`'s
 *     native-proof-gated `complete`/`verifiedSubset` outcomes are still never
 *     used here (manufacturing a native summary would be exactly the
 *     inference the grant forbids). Instead this adapter emits the view's
 *     separate `serverVerdict` outcome (`authority:'server'`), which renders
 *     the same complete/partial headline and body `ImportRunVerdictCard` uses
 *     today, with no counts (this adapter never had any to show, so it never
 *     invents them — parity with the card, not new proof).
 *   - `partial` / `blocked` / `failed` are shown with the server's reasons:
 *     `failed` already carries its own P2 copy; `blocked` and `partial`
 *     (via `serverVerdict`) are the two P2 outcomes with a reason slot, so a
 *     `reason_code` that maps to a recognised local reason is surfaced
 *     through it. An unrecognised or absent reason code maps to the local
 *     `unknown` reason — never a raw server string (P2_README "no raw
 *     exceptions, arbitrary scope prose"). `complete` never carries a reason
 *     (a settled complete has none to show, matching the card).
 *   - A legacy-mode terminal (`mode: 'legacy'`) is the extension's own report,
 *     reflected verbatim by the server, never arbitrated — it NEVER reads as
 *     `complete` here, matching the honesty rule in importRunStatus.ts.
 */
import type { ImportRunStatus } from '../../../hooks/useImportRunStatus';
import type { RunPhase, RunReasonCode } from '../../../types/importRunStatus';
import type { ImportObservedAt } from './importJourneyCopy';
import type { ImportProgressPhase, ImportProgressViewProps } from './ImportProgressView';

/** `ImportProgressView` only recognises these three; a future server phase not in this map renders as "not known" (no phaseKey), never a guess. */
const PHASE_MAP: Record<RunPhase, ImportProgressPhase> = {
  discovering: 'finding',
  transferring: 'transferring',
  reconciling: 'checking',
};

/** `ImportResultView`'s one reason-bearing outcome (`blocked`) only accepts these four local keys. */
type BlockedReason = 'denied' | 'scopeUnknown' | 'changed' | 'unknown';
const BLOCKED_REASON_MAP: Record<RunReasonCode, BlockedReason> = {
  revoked: 'denied',
  cancelled_by_coach: 'changed',
  unresolved_family: 'scopeUnknown',
  unresolved_identities: 'scopeUnknown',
  relationship_unverified: 'scopeUnknown',
  coverage_basis_unknown: 'scopeUnknown',
  reconciliation_not_performed: 'unknown',
  deadline_exceeded: 'unknown',
  transfer_failed: 'unknown',
};

/**
 * The display-only slice of `ImportResultViewProps` this adapter can ever
 * produce. `verifiedSubset` / `transferOnly` / `provenZero` and the
 * native-proof-gated `complete` all require proof (native summary, source
 * coverage, checked-source counts) this hook's reading never carries, so
 * this adapter never emits them (see the module doc). A server `complete` or
 * `partial` verdict is instead carried through `serverVerdict`
 * (`authority:'server'`) — the result type says so, rather than a wider type
 * this function could not honestly fill in.
 */
export type AdapterResultProps =
  | { outcome: 'unconfirmed' | 'interrupted' | 'failed' | 'timedOut' | 'cancelled' | 'unavailable'; observedAt?: ImportObservedAt }
  | { outcome: 'blocked'; reason: 'denied' | 'scopeUnknown' | 'changed' | 'unknown'; observedAt?: ImportObservedAt }
  | { outcome: 'serverVerdict'; authority: 'server'; status: 'complete' | 'partial'; reason?: 'denied' | 'scopeUnknown' | 'changed' | 'unknown'; observedAt?: ImportObservedAt };

export type ImportJourneyStatusView =
  | { kind: 'none' }
  | { kind: 'progress'; props: Pick<ImportProgressViewProps, 'observation' | 'stop' | 'sourceCoverage' | 'observedAt'> }
  | { kind: 'result'; props: AdapterResultProps };

/**
 * Map one `useImportRunStatus` reading to the Roman P2 view that should be
 * shown, with the view's own display-only fields filled in. The caller
 * supplies host wiring (navigation callback, action objects, focus) — this
 * function never invents an action or a capability.
 *
 * `{ kind: 'none' }` covers `disabled`: the hook itself is off (no flag, no
 * coach, no intent), so there is nothing to show — not even "unavailable".
 */
export function mapImportRunStatusToJourneyView(run: ImportRunStatus): ImportJourneyStatusView {
  if (run.view === 'disabled') return { kind: 'none' };

  const observedAt = run.readAt != null ? { epochMs: run.readAt, locale: 'en-US', timeZone: 'UTC' } : undefined;

  if (run.view === 'loading' || run.view === 'error') {
    // No reading has ever been decoded yet, or the transport failed outright:
    // nothing is proven, so this is the progress screen's own "not known"
    // presentation, never a guessed phase.
    return { kind: 'progress', props: { observation: { freshness: 'unavailable' }, stop: 'notRequested', sourceCoverage: 'unknown', observedAt } };
  }
  if (run.view === 'notFound' || run.view === 'unreadable') {
    // A 404 ("not known yet") or an undecodable body: the result screen's
    // honest unavailable state, never a failure claim the server did not make.
    return { kind: 'result', props: { outcome: 'unavailable', observedAt } };
  }

  // run.view === 'reading' from here.
  const reading = run.reading!;
  const stale = run.stale;

  if (reading.status === 'running') {
    const phase = reading.phase && reading.phase !== 'unknown' ? PHASE_MAP[reading.phase] : undefined;
    // `current` freshness REQUIRES a recognised phase (ImportProgressViewProps'
    // type). The server says the run is open, but a null/unrecognised phase is
    // "not known" for the open step itself, so this reads as `stale` with no
    // lastObservedPhase (renders progress.statusUnknown) rather than guessing
    // a phase the server did not send.
    const observation: ImportProgressViewProps['observation'] =
      !stale && phase ? { freshness: 'current', phase } : { freshness: 'stale', ...(phase ? { lastObservedPhase: phase } : {}) };
    return {
      kind: 'progress',
      props: { observation, stop: 'notRequested', sourceCoverage: 'unknown', observedAt },
    };
  }

  // Legacy terminals are the extension's own claim, reflected verbatim, never
  // arbitrated by the server — never shown as a proven result here.
  if (reading.mode === 'legacy') return { kind: 'result', props: { outcome: 'unavailable', observedAt } };

  switch (reading.status) {
    case 'complete':
      // The server settled complete (S9 reconciliation) — its verdict is the
      // authority. No reason to show: a settled complete has none, matching
      // ImportRunVerdictCard.
      return { kind: 'result', props: { outcome: 'serverVerdict', authority: 'server', status: 'complete', observedAt } };
    case 'partial': {
      // Partial is shown with the server's own reason, mapped to the same
      // local reason keys `blocked` uses — never a raw server string.
      const code = reading.reasonCode;
      const reason = code && code !== 'unknown' ? BLOCKED_REASON_MAP[code] : 'unknown';
      return { kind: 'result', props: { outcome: 'serverVerdict', authority: 'server', status: 'partial', reason, observedAt } };
    }
    case 'blocked': {
      const code = reading.reasonCode;
      const reason = code && code !== 'unknown' ? BLOCKED_REASON_MAP[code] : 'unknown';
      return { kind: 'result', props: { outcome: 'blocked', reason, observedAt } };
    }
    case 'failed':
      return { kind: 'result', props: { outcome: 'failed', observedAt } };
    case 'cancelled':
      return { kind: 'result', props: { outcome: 'cancelled', observedAt } };
    case 'timed_out':
      return { kind: 'result', props: { outcome: 'timedOut', observedAt } };
    case 'unknown':
    default:
      return { kind: 'result', props: { outcome: 'unavailable', observedAt } };
  }
}
