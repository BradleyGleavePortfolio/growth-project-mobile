/**
 * R1 (Roman status binding) — importRunStatusAdapter unit tests. Every
 * `useImportRunStatus` view and every `DecodedRunStatus.status` branch maps
 * to the Roman P2 props this adapter is allowed to produce, per the module's
 * honesty rules (R1_GRANT.md). Pure function: no rendering, no mocks needed.
 */
import { mapImportRunStatusToJourneyView } from '../importRunStatusAdapter';
import type { ImportRunStatus } from '../../../../hooks/useImportRunStatus';
import type { DecodedRunStatus } from '../../../../types/importRunStatus';

const INTENT = 'intent-1';

function reading(over: Partial<DecodedRunStatus> = {}): DecodedRunStatus {
  return {
    intentId: INTENT,
    status: 'running',
    mode: 'server',
    phase: null,
    reasonCode: null,
    claimedStatus: null,
    completedAt: null,
    startedAt: null,
    ...over,
  };
}

function run(over: Partial<ImportRunStatus>): ImportRunStatus {
  return {
    view: 'disabled',
    stale: false,
    readAt: null,
    isRefreshing: false,
    refresh: jest.fn(),
    ...over,
  };
}

describe('mapImportRunStatusToJourneyView — no-reading views', () => {
  it('disabled → none (not even unavailable)', () => {
    expect(mapImportRunStatusToJourneyView(run({ view: 'disabled' }))).toEqual({ kind: 'none' });
  });

  it.each(['loading', 'error'] as const)('%s (no reading yet) → progress, unavailable freshness', (view) => {
    const result = mapImportRunStatusToJourneyView(run({ view }));
    expect(result).toEqual({
      kind: 'progress',
      props: { observation: { freshness: 'unavailable' }, stop: 'notRequested', sourceCoverage: 'unknown', observedAt: undefined },
    });
  });

  it.each(['notFound', 'unreadable'] as const)('%s → result, unavailable', (view) => {
    const result = mapImportRunStatusToJourneyView(run({ view }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'unavailable', observedAt: undefined } });
  });

  it('readAt is carried through as observedAt (epochMs, en-US, UTC) whenever present', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'notFound', readAt: 1700000000000 }));
    expect(result).toEqual({
      kind: 'result',
      props: { outcome: 'unavailable', observedAt: { epochMs: 1700000000000, locale: 'en-US', timeZone: 'UTC' } },
    });
  });
});

describe('mapImportRunStatusToJourneyView — running', () => {
  it.each([
    ['discovering', 'finding'],
    ['transferring', 'transferring'],
    ['reconciling', 'checking'],
  ] as const)('recognised phase %s → progress, current freshness, phase %s', (serverPhase, viewPhase) => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ phase: serverPhase }) }));
    expect(result).toEqual({
      kind: 'progress',
      props: { observation: { freshness: 'current', phase: viewPhase }, stop: 'notRequested', sourceCoverage: 'unknown', observedAt: undefined },
    });
  });

  it('null phase (not known) while running → stale freshness, no lastObservedPhase, never a guessed phase', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ phase: null }) }));
    expect(result).toEqual({
      kind: 'progress',
      props: { observation: { freshness: 'stale' }, stop: 'notRequested', sourceCoverage: 'unknown', observedAt: undefined },
    });
  });

  it('unrecognised phase string while running → stale freshness, no lastObservedPhase', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ phase: 'unknown' }) }));
    expect(result).toEqual({
      kind: 'progress',
      props: { observation: { freshness: 'stale' }, stop: 'notRequested', sourceCoverage: 'unknown', observedAt: undefined },
    });
  });

  it('a stale refresh while running keeps the last-observed phase but never claims current', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', stale: true, reading: reading({ phase: 'transferring' }) }));
    expect(result).toEqual({
      kind: 'progress',
      props: { observation: { freshness: 'stale', lastObservedPhase: 'transferring' }, stop: 'notRequested', sourceCoverage: 'unknown', observedAt: undefined },
    });
  });
});

describe('mapImportRunStatusToJourneyView — legacy terminals are never shown as proven', () => {
  it.each(['success', 'partial', 'failed'] as const)('legacy mode, status %s → result, unavailable (never complete)', (status) => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status, mode: 'legacy' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'unavailable', observedAt: undefined } });
  });
});

describe('mapImportRunStatusToJourneyView — server terminals', () => {
  it('complete → serverVerdict, complete: the server settled it, shown as the authority it is (parity with ImportRunVerdictCard)', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'complete' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'serverVerdict', authority: 'server', status: 'complete', observedAt: undefined } });
  });

  it('complete never carries a reason, even if one happened to be present on the reading', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'complete', reasonCode: 'revoked' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'serverVerdict', authority: 'server', status: 'complete', observedAt: undefined } });
  });

  it.each([
    ['revoked', 'denied'],
    ['cancelled_by_coach', 'changed'],
    ['unresolved_family', 'scopeUnknown'],
    ['unresolved_identities', 'scopeUnknown'],
    ['relationship_unverified', 'scopeUnknown'],
    ['coverage_basis_unknown', 'scopeUnknown'],
    ['reconciliation_not_performed', 'unknown'],
    ['deadline_exceeded', 'unknown'],
    ['transfer_failed', 'unknown'],
  ] as const)('partial with reason_code %s → serverVerdict, partial, reason %s', (code, reason) => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'partial', reasonCode: code }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'serverVerdict', authority: 'server', status: 'partial', reason, observedAt: undefined } });
  });

  it('partial with a null reason_code → serverVerdict, partial, reason unknown (never a raw null)', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'partial', reasonCode: null }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'serverVerdict', authority: 'server', status: 'partial', reason: 'unknown', observedAt: undefined } });
  });

  it('partial with an unrecognised reason_code → serverVerdict, partial, reason unknown', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'partial', reasonCode: 'unknown' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'serverVerdict', authority: 'server', status: 'partial', reason: 'unknown', observedAt: undefined } });
  });

  it('failed → result, failed', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'failed' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'failed', observedAt: undefined } });
  });

  it('cancelled → result, cancelled', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'cancelled' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'cancelled', observedAt: undefined } });
  });

  it('timed_out → result, timedOut', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'timed_out' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'timedOut', observedAt: undefined } });
  });

  it('unknown status → result, unavailable', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'unknown' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'unavailable', observedAt: undefined } });
  });
});

describe('mapImportRunStatusToJourneyView — blocked, every reason code', () => {
  it.each([
    ['revoked', 'denied'],
    ['cancelled_by_coach', 'changed'],
    ['unresolved_family', 'scopeUnknown'],
    ['unresolved_identities', 'scopeUnknown'],
    ['relationship_unverified', 'scopeUnknown'],
    ['coverage_basis_unknown', 'scopeUnknown'],
    ['reconciliation_not_performed', 'unknown'],
    ['deadline_exceeded', 'unknown'],
    ['transfer_failed', 'unknown'],
  ] as const)('reason_code %s → blocked reason %s', (code, localReason) => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'blocked', reasonCode: code }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'blocked', reason: localReason, observedAt: undefined } });
  });

  it('null reason_code (not known) → blocked reason unknown, never a fabricated cause', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'blocked', reasonCode: null }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'blocked', reason: 'unknown', observedAt: undefined } });
  });

  it('unrecognised reason_code → blocked reason unknown, never a raw server string', () => {
    const result = mapImportRunStatusToJourneyView(run({ view: 'reading', reading: reading({ status: 'blocked', reasonCode: 'unknown' }) }));
    expect(result).toEqual({ kind: 'result', props: { outcome: 'blocked', reason: 'unknown', observedAt: undefined } });
  });
});
