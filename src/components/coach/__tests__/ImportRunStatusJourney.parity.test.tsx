/**
 * R1 (Roman status binding) — parity guard. Class-A finding closure: the
 * Roman surface (`ImportRunStatusJourney` / `importRunStatusAdapter`) must
 * never show LESS truth than `ImportRunVerdictCard` showed on
 * `main@01dd8a3c` for the same server reading. The card's pure
 * `verdictLines(reading)` is the informativeness reference; for every
 * `DecodedRunStatus.status` this test asserts the Roman adapter's outcome is
 * at least as informative — in particular that a card verdict which names a
 * real, non-generic status (`success: true`, or any terminal other than the
 * unrecognised placeholder) is never collapsed to the Roman `unavailable`
 * outcome, which would be a genuine loss of shown truth.
 *
 * Legacy-mode terminals are the one documented exception (mirrors the card's
 * own `legacyNote`: an unarbitrated extension claim, never proven) — both
 * surfaces intentionally decline to present it as a settled result, so
 * "no less truth" does not require legacy parity beyond what the card itself
 * already flags as unverified.
 */
import { verdictLines } from '../ImportRunVerdictCard';
import { mapImportRunStatusToJourneyView } from '../../../screens/coach/import-journey/importRunStatusAdapter';
import type { DecodedRunStatus, RunReasonCode } from '../../../types/importRunStatus';
import type { ImportRunStatus } from '../../../hooks/useImportRunStatus';

function reading(over: Partial<DecodedRunStatus> = {}): DecodedRunStatus {
  return {
    intentId: 'intent-1', status: 'running', mode: 'server', phase: null,
    reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null,
    ...over,
  };
}
function run(reading_: DecodedRunStatus): ImportRunStatus {
  return { view: 'reading', reading: reading_, stale: false, readAt: null, isRefreshing: false, refresh: jest.fn() };
}

const REASON_CODES: RunReasonCode[] = [
  'reconciliation_not_performed', 'cancelled_by_coach', 'deadline_exceeded', 'transfer_failed',
  'unresolved_family', 'revoked', 'unresolved_identities', 'relationship_unverified', 'coverage_basis_unknown',
];

describe('Roman surface parity with ImportRunVerdictCard — server mode', () => {
  it('server complete: the card names it a success; the Roman surface must not collapse it to unavailable', () => {
    const r = reading({ status: 'complete', mode: 'server' });
    const card = verdictLines(r);
    expect(card.success).toBe(true); // reference: the card shows a real, positive verdict here
    const roman = mapImportRunStatusToJourneyView(run(r));
    expect(roman).toEqual({ kind: 'result', props: { outcome: 'serverVerdict', authority: 'server', status: 'complete', observedAt: undefined } });
    expect(roman.kind === 'result' && roman.props.outcome).not.toBe('unavailable');
  });

  it.each(REASON_CODES)('server partial, reason_code %s: the card shows a named reason; the Roman surface must not collapse to unavailable', (code) => {
    const r = reading({ status: 'partial', mode: 'server', reasonCode: code });
    const card = verdictLines(r);
    expect(card.title).toBe('Import partly finished'); // reference: the card names the real status, not a generic fallback
    expect(card.reason?.text).not.toBe('Not recognised by this app version');
    const roman = mapImportRunStatusToJourneyView(run(r));
    expect(roman.kind).toBe('result');
    expect(roman.kind === 'result' && roman.props.outcome).toBe('serverVerdict');
    expect(roman.kind === 'result' && roman.props.outcome).not.toBe('unavailable');
  });

  it.each(['blocked', 'failed', 'cancelled', 'timed_out'] as const)('server %s: both surfaces already name the real status (regression guard)', (status) => {
    const r = reading({ status, mode: 'server' });
    const card = verdictLines(r);
    expect(card.title).not.toBe('Import status not recognised');
    const roman = mapImportRunStatusToJourneyView(run(r));
    expect(roman.kind === 'result' && roman.props.outcome).not.toBe('unavailable');
  });
});

describe('Roman surface parity with ImportRunVerdictCard — legacy mode (documented exception)', () => {
  it.each(['success', 'partial', 'failed'] as const)('legacy %s: the card flags it unarbitrated (legacyNote); the Roman surface honestly declines the same way', (status) => {
    const r = reading({ status, mode: 'legacy' });
    const card = verdictLines(r);
    expect(card.legacyNote).toBe(true); // reference: the card itself never treats this as proven
    const roman = mapImportRunStatusToJourneyView(run(r));
    expect(roman).toEqual({ kind: 'result', props: { outcome: 'unavailable', observedAt: undefined } });
  });
});

describe('Roman surface parity with ImportRunVerdictCard — unknown status', () => {
  it('unknown: the card itself falls back to its own unrecognised placeholder; unavailable is not a regression here', () => {
    const r = reading({ status: 'unknown' });
    const card = verdictLines(r);
    expect(card.title).toBe('Import status not recognised');
    const roman = mapImportRunStatusToJourneyView(run(r));
    expect(roman).toEqual({ kind: 'result', props: { outcome: 'unavailable', observedAt: undefined } });
  });
});
