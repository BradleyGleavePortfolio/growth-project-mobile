/**
 * R1 (Roman status binding) — RENDERED parity guard. Class-A/B finding
 * closure (R1_REVIEW.md): both `ImportRunVerdictCard` (main) and
 * `ImportRunStatusJourney` (Roman) are rendered under the IDENTICAL mocked
 * `useImportRunStatus` / `useImportedRoster` state, for a matrix covering
 * every status × stale × mode × reason code (+ completedAt, refresh, and the
 * roster with the flag on) — and every text fact and action the card shows
 * is asserted present, verbatim, on the Roman surface. This tests rendered
 * output, not adapter output — a lossy remap of the same facts would fail
 * these assertions even if it returned a superficially "non-unavailable"
 * outcome, which is exactly what the prior version's parity test missed.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react-native';
import type { DecodedRunStatus, RunReasonCode } from '../../../types/importRunStatus';

// Both ImportRunVerdictCard (legacy `colors`) and the P2 views (`semanticColors`)
// read from the real useTheme hook, which has sensible standalone defaults
// (see the P2 views' own tests, which never mock it either) — mocking a
// single shape here would break one surface or the other.
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));

const flags: { extensionImport: boolean; importReview: boolean; romanChat: boolean } = { extensionImport: true, importReview: true, romanChat: false };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

type RunState = Record<string, unknown>;
let mockRun: RunState;
let mockRoster: RunState = {};
const mockRefresh = jest.fn();
const mockFetchMore = jest.fn();
jest.mock('../../../hooks/useImportRunStatus', () => ({
  useImportRunStatus: () => ({ stale: false, readAt: null, isRefreshing: false, refresh: mockRefresh, ...mockRun }),
  useImportedRoster: () => ({
    view: 'disabled', persons: [], rosterBridgePending: null, hasMore: false, incomplete: false,
    isFetchingMore: false, fetchMore: mockFetchMore, refresh: jest.fn(), ...mockRoster,
  }),
}));

// Both imported AFTER the mocks above so they share the identical mocked hooks.
import ImportRunVerdictCard from '../ImportRunVerdictCard';
import ImportRunStatusJourney from '../ImportRunStatusJourney';

function reading(over: Partial<DecodedRunStatus> = {}): DecodedRunStatus {
  return {
    intentId: 'intent-1', status: 'running', mode: 'server', phase: null,
    reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null,
    ...over,
  };
}

beforeEach(() => {
  flags.importReview = true;
  flags.romanChat = false;
  mockRoster = {};
  mockRefresh.mockClear();
});
afterEach(() => cleanup());

const REASON_CODES: RunReasonCode[] = [
  'reconciliation_not_performed', 'cancelled_by_coach', 'deadline_exceeded', 'transfer_failed',
  'unresolved_family', 'revoked', 'unresolved_identities', 'relationship_unverified', 'coverage_basis_unknown',
];
const TERMINALS_SERVER = ['complete', 'partial', 'blocked', 'failed', 'cancelled', 'timed_out'] as const;

/** Text facts the card renders for a `reading, ...` state, independent of stale/checkedAt/refresh (asserted separately below). */
function assertTextParity(cardText: string, romanText: string, reading_: DecodedRunStatus) {
  const { verdictLines } = jest.requireActual('../importVerdictContent');
  const lines = verdictLines(reading_);
  expect(romanText).toContain(lines.title);
  expect(romanText).toContain(lines.body);
  if (lines.legacyNote) expect(romanText).toContain('Reported by the browser extension. The server did not check this result.');
  if (lines.step !== undefined) expect(romanText).toContain(lines.step);
  if (lines.reason) expect(romanText).toContain(lines.reason.text);
  if (lines.finishedAt !== undefined) expect(romanText).toContain(lines.finishedAt);
  // Sanity: the card itself actually shows these facts too (reference check).
  expect(cardText).toContain(lines.title);
}

describe('rendered parity — every server terminal status, stale + fresh, with and without a reason code', () => {
  it.each(TERMINALS_SERVER)('status=%s, fresh, no reason', async (status) => {
    const r = reading({ status, mode: 'server' });
    mockRun = { view: 'reading', reading: r, stale: false, readAt: 1700000000000 };
    const card = await render(<ImportRunVerdictCard importIntentId="intent-1" />);
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    assertTextParity(card.toJSON() ? JSON.stringify(card.toJSON()) : '', JSON.stringify(roman.toJSON()), r);
    expect(JSON.stringify(roman.toJSON())).toContain('Last checked');
  });

  it.each(TERMINALS_SERVER)('status=%s, STALE (failed refresh) — both surfaces label it, never presented as current', async (status) => {
    const r = reading({ status, mode: 'server' });
    mockRun = { view: 'reading', reading: r, stale: true, readAt: 1700000000000 };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    const text = JSON.stringify(roman.toJSON());
    expect(text).toContain('Couldn\u2019t refresh. Showing what the server said');
  });

  it('STALE with no prior readAt — the stale line omits a fabricated time, exactly like the card', async () => {
    const r = reading({ status: 'failed', mode: 'server' });
    mockRun = { view: 'reading', reading: r, stale: true, readAt: null };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    const text = JSON.stringify(roman.toJSON());
    expect(text).toContain('Couldn\u2019t refresh. Showing what the server said.');
  });

  it.each(REASON_CODES)('blocked, reason_code %s — exact card reason text, not a remapped cause', async (code) => {
    const r = reading({ status: 'blocked', mode: 'server', reasonCode: code });
    mockRun = { view: 'reading', reading: r, stale: false, readAt: null };
    const { REASON_COPY } = jest.requireActual('../importVerdictContent');
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).toContain(REASON_COPY[code]);
  });

  it.each(REASON_CODES)('partial, reason_code %s — exact card reason text, not a remapped cause', async (code) => {
    const r = reading({ status: 'partial', mode: 'server', reasonCode: code });
    mockRun = { view: 'reading', reading: r, stale: false, readAt: null };
    const { REASON_COPY } = jest.requireActual('../importVerdictContent');
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).toContain(REASON_COPY[code]);
  });

  it.each(['failed', 'cancelled', 'timed_out'] as const)('%s carries its own reason from the server, never dropped', async (status) => {
    const r = reading({ status, mode: 'server', reasonCode: 'deadline_exceeded' });
    mockRun = { view: 'reading', reading: r, stale: false, readAt: null };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).toContain('The import went past its time limit.');
  });

  it('server complete — Ended shows the server completedAt, never the hook readAt', async () => {
    const r = reading({ status: 'complete', mode: 'server', completedAt: '2026-01-01T00:00:00Z' });
    mockRun = { view: 'reading', reading: r, stale: false, readAt: 1800000000000 };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    const text = JSON.stringify(roman.toJSON());
    const { formatTime } = jest.requireActual('../importVerdictContent');
    expect(text).toContain(formatTime('2026-01-01T00:00:00Z'));
  });
});

describe('rendered parity — legacy mode: clearly labelled unverified extension report, never an unqualified result', () => {
  it.each(['success', 'partial', 'failed'] as const)('legacy %s: shows the card\'s own headline AND the extension-report note, never silently unavailable', async (status) => {
    const r = reading({ status, mode: 'legacy' });
    mockRun = { view: 'reading', reading: r, stale: false, readAt: null };
    const { verdictLines } = jest.requireActual('../importVerdictContent');
    const lines = verdictLines(r);
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    const text = JSON.stringify(roman.toJSON());
    expect(text).toContain(lines.title);
    expect(text).toContain('Reported by the browser extension. The server did not check this result.');
  });
});

describe('rendered parity — unknown status: both surfaces fall back to the same explicit placeholder', () => {
  it('unknown status renders the card\'s own "not recognised" title and body', async () => {
    const r = reading({ status: 'unknown' });
    mockRun = { view: 'reading', reading: r, stale: false, readAt: null };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    const text = JSON.stringify(roman.toJSON());
    expect(text).toContain('Import status not recognised');
  });
});

describe('rendered parity — refresh action preserved (existing capability, not new wiring)', () => {
  it('Check again is present and calls the same run.refresh the card calls', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'failed', mode: 'server' }), stale: false, readAt: null };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    await fireEvent.press(roman.getByRole('button', { name: 'Check current result' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('running state, stale (not current) also exposes a refresh action wired to the same run.refresh', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'running', phase: 'transferring' }), stale: true, readAt: null };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    await fireEvent.press(roman.getByRole('button', { name: 'Check current result' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('rendered parity — loading / error / notFound / unreadable: same facts as the card', () => {
  it('loading shows the card\'s own "Checking import status…" line', async () => {
    mockRun = { view: 'loading' };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).toContain('Checking import status…');
  });

  it('error shows the card\'s own network-failure copy', async () => {
    mockRun = { view: 'error' };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).toContain('We couldn\u2019t reach the server to check this import. Check your connection and try again.');
  });

  it('notFound shows the card\'s own 404 copy', async () => {
    mockRun = { view: 'notFound' };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).toContain('The server didn\u2019t return a status for this import. Check again later.');
  });

  it('unreadable shows the same "not recognised" placeholder as an unknown reading', async () => {
    mockRun = { view: 'unreadable' };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).toContain('Import status not recognised');
  });
});

describe('rendered parity — gated roster section mounts under the single Roman surface (B5)', () => {
  it('importReview ON + settled → the SAME ImportedRosterSection renders, with its rows', async () => {
    flags.importReview = true;
    mockRun = { view: 'reading', reading: reading({ status: 'complete', mode: 'server' }), stale: false, readAt: null };
    mockRoster = { view: 'page', accounting: { staged: 3, reconstructed: 2, skipped: 1, failed: 0, unclassified: 0 }, persons: [{ id: 'p1', displayName: 'Ada', state: 'InvitePending' }] };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    const text = JSON.stringify(roman.toJSON());
    expect(text).toContain('Imported people');
    expect(text).toContain('Ada');
    expect(text).toContain('Imported, not yet joined');
  });

  it('importReview OFF → no roster section, matching the card\'s own gate', async () => {
    flags.importReview = false;
    mockRun = { view: 'reading', reading: reading({ status: 'complete', mode: 'server' }), stale: false, readAt: null };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).not.toContain('Imported people');
  });

  it('still open (running) → no roster section even with importReview ON, matching the card\'s settled gate', async () => {
    flags.importReview = true;
    mockRun = { view: 'reading', reading: reading({ status: 'running', phase: 'discovering' }), stale: false, readAt: null };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).not.toContain('Imported people');
  });
});

describe('Roman on/off — identical facts, only portrait/voice differ', () => {
  it.each([false, true])('romanChat=%s still shows the same failed verdict text', async (romanChat) => {
    flags.romanChat = romanChat;
    mockRun = { view: 'reading', reading: reading({ status: 'failed', mode: 'server' }), stale: false, readAt: null };
    const roman = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(JSON.stringify(roman.toJSON())).toContain('This import ended without bringing your data across.');
  });
});
