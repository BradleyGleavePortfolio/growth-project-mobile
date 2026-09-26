/**
 * S12-B3 ImportRunVerdictCard — server field → UI state, per state:
 *   - every recognised status × mode renders its own copy; unrecognised → the
 *     explicit "not recognised" state (never success);
 *   - success mark ONLY for server `complete`; legacy terminals carry the
 *     "reported by the extension" note and no mark;
 *   - phase only while open, reason only once ended; null/unknown → "Not known
 *     yet", and no "0" is ever rendered for an unknown;
 *   - claimed_status is never rendered;
 *   - stale reading labelled; 404 / error / undecodable → not known yet;
 *   - roster list mounts only behind importReview and only once settled, rows
 *     read "Imported, not yet joined";
 *   - banned-words sweep over every rendered string of every state.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
    },
  }),
}));

const flags = { extensionImport: true, importReview: false };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

type RunState = Record<string, unknown>;
let mockRun: RunState;
let mockRoster: RunState;
const mockRefresh = jest.fn();
const mockFetchMore = jest.fn();
const mockUseRoster = jest.fn();
jest.mock('../../../hooks/useImportRunStatus', () => ({
  useImportRunStatus: () => ({ stale: false, readAt: null, isRefreshing: false, refresh: mockRefresh, ...mockRun }),
  useImportedRoster: (...a: unknown[]) => {
    mockUseRoster(...a);
    return {
      persons: [],
      rosterBridgePending: null,
      hasMore: false,
      incomplete: false,
      isFetchingMore: false,
      fetchMore: mockFetchMore,
      refresh: jest.fn(),
      ...mockRoster,
    };
  },
}));

import ImportRunVerdictCard, {
  LEGACY_NOTE,
  NOT_KNOWN_YET,
  PHASE_COPY,
  REASON_COPY,
  VERDICT_COPY,
  UNKNOWN_VERDICT,
} from '../ImportRunVerdictCard';
import {
  LEGACY_TERMINAL_STATUSES,
  RUN_PHASES,
  RUN_REASON_CODES,
  SERVER_TERMINAL_STATUSES,
  type DecodedRunStatus,
} from '../../../types/importRunStatus';

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

function collectText(node: unknown): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (typeof node !== 'object') return [];
  const n = node as { props?: Record<string, unknown>; children?: unknown[] };
  const own: string[] = [];
  for (const k of ['accessibilityLabel', 'accessibilityHint']) {
    const v = n.props?.[k];
    if (typeof v === 'string') own.push(v);
  }
  return [...own, ...collectText(n.children ?? [])];
}

async function renderCard() {
  const utils = await render(<ImportRunVerdictCard importIntentId={INTENT} />);
  const text = collectText(utils.toJSON()).join(' \u241F ');
  return { ...utils, text };
}

function expectNoBannedWords(text: string): void {
  expect(text).not.toMatch(/\bauthorized\b/i);
  expect(text).not.toMatch(/\bready\b/i);
  expect(text).not.toMatch(/\bconnected\b/i);
  expect(text).not.toMatch(/\bverified\b/i);
  expect(text).not.toMatch(/\brunning\b/i);
}

beforeEach(() => {
  flags.extensionImport = true;
  flags.importReview = false;
  mockRun = { view: 'reading', reading: reading() };
  mockRoster = { view: 'disabled' };
  mockRefresh.mockClear();
  mockFetchMore.mockClear();
  mockUseRoster.mockClear();
});
afterEach(() => cleanup());

describe('ImportRunVerdictCard — non-reading views', () => {
  it('disabled → renders nothing', async () => {
    mockRun = { view: 'disabled' };
    const { toJSON } = await renderCard();
    expect(toJSON()).toBeNull();
  });

  it.each([
    ['notFound', 'verdict-not-found'],
    ['error', 'verdict-error'],
  ])('%s → "not known yet", no verdict, no success mark', async (view, id) => {
    mockRun = { view };
    const { getByTestId, queryByTestId, text } = await renderCard();
    expect(getByTestId(id)).toHaveTextContent(NOT_KNOWN_YET.toLowerCase(), { exact: false });
    expect(queryByTestId('verdict-title')).toBeNull();
    expect(queryByTestId('verdict-icon-success')).toBeNull();
    expect(text).not.toMatch(/\b0\b/);
  });

  it('unreadable body → explicit not-recognised state', async () => {
    mockRun = { view: 'unreadable' };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId('verdict-unknown')).toHaveTextContent(UNKNOWN_VERDICT.title);
    expect(queryByTestId('verdict-icon-success')).toBeNull();
  });

  it('loading → spinner copy only', async () => {
    mockRun = { view: 'loading' };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId('verdict-loading')).toBeTruthy();
    expect(queryByTestId('verdict-title')).toBeNull();
  });
});

describe('ImportRunVerdictCard — open run', () => {
  it.each(RUN_PHASES)('server phase %s → its step copy', async (phase) => {
    mockRun = { view: 'reading', reading: reading({ phase }) };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId('verdict-title')).toHaveTextContent(VERDICT_COPY.running.title);
    expect(getByTestId('verdict-step')).toHaveTextContent(PHASE_COPY[phase], { exact: false });
    expect(queryByTestId('verdict-reason')).toBeNull();
    expect(queryByTestId('verdict-icon-neutral')).toBeTruthy();
  });

  it.each([[null], ['unknown' as const]])('phase %p → "Not known yet", never a guessed step', async (phase) => {
    mockRun = { view: 'reading', reading: reading({ phase }) };
    const { getByTestId } = await renderCard();
    expect(getByTestId('verdict-step')).toHaveTextContent(NOT_KNOWN_YET, { exact: false });
  });

  it('a phase on a terminal reading is never shown', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'failed', phase: 'transferring' }) };
    const { queryByTestId } = await renderCard();
    expect(queryByTestId('verdict-step')).toBeNull();
  });
});

describe('ImportRunVerdictCard — terminal verdicts', () => {
  it.each(SERVER_TERMINAL_STATUSES)('server %s → its own copy; success mark only for complete', async (status) => {
    mockRun = { view: 'reading', reading: reading({ status, reasonCode: 'transfer_failed' }) };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId('verdict-title')).toHaveTextContent(VERDICT_COPY[status].title);
    expect(getByTestId('verdict-body')).toHaveTextContent(VERDICT_COPY[status].body);
    expect(queryByTestId('verdict-icon-success')).toBe(status === 'complete' ? getByTestId('verdict-icon-success') : null);
    expect(queryByTestId('verdict-legacy-note')).toBeNull();
  });

  it.each(LEGACY_TERMINAL_STATUSES)('legacy %s → extension-reported note, never a success mark, no reason', async (status) => {
    mockRun = { view: 'reading', reading: reading({ status, mode: 'legacy' }) };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId('verdict-title')).toHaveTextContent(VERDICT_COPY[status].title);
    expect(getByTestId('verdict-legacy-note')).toHaveTextContent(LEGACY_NOTE);
    expect(queryByTestId('verdict-icon-success')).toBeNull();
    expect(queryByTestId('verdict-reason')).toBeNull();
  });

  it('status unknown → not-recognised copy, no mark', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'unknown', mode: 'unknown' }) };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId('verdict-title')).toHaveTextContent(UNKNOWN_VERDICT.title);
    expect(queryByTestId('verdict-icon-success')).toBeNull();
  });

  it.each(RUN_REASON_CODES)('reason %s → plain-language copy + the server code', async (code) => {
    mockRun = { view: 'reading', reading: reading({ status: 'partial', reasonCode: code }) };
    const { getByTestId } = await renderCard();
    expect(getByTestId('verdict-reason')).toHaveTextContent(REASON_COPY[code], { exact: false });
    expect(getByTestId('verdict-reason-code')).toHaveTextContent(`Reason code: ${code}`);
  });

  it.each([[null], ['unknown' as const]])('reason %p on a non-complete terminal → "Not known yet", no code', async (code) => {
    mockRun = { view: 'reading', reading: reading({ status: 'failed', reasonCode: code }) };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId('verdict-reason')).toHaveTextContent(NOT_KNOWN_YET, { exact: false });
    expect(queryByTestId('verdict-reason-code')).toBeNull();
  });

  it('complete with no reason code shows no reason line', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'complete' }) };
    const { queryByTestId } = await renderCard();
    expect(queryByTestId('verdict-reason')).toBeNull();
  });

  it('null completed_at → "Ended: Not known yet", never a time or 0', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'failed' }) };
    const { getByTestId, text } = await renderCard();
    expect(getByTestId('verdict-finished-at')).toHaveTextContent(NOT_KNOWN_YET, { exact: false });
    expect(text).not.toMatch(/\b0\b/);
  });

  it('claimed_status is never rendered as the verdict', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'failed', claimedStatus: 'success' }) };
    const { getByTestId, queryByTestId, text } = await renderCard();
    expect(getByTestId('verdict-title')).toHaveTextContent(VERDICT_COPY.failed.title);
    expect(queryByTestId('verdict-icon-success')).toBeNull();
    expect(text).not.toMatch(/success/i);
  });
});

describe('ImportRunVerdictCard — stale + refresh', () => {
  it('stale reading is labelled, not presented as current', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'failed' }), stale: true, readAt: Date.UTC(2026, 8, 26, 10) };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId('verdict-stale')).toHaveTextContent('Couldn’t refresh', { exact: false });
    expect(queryByTestId('verdict-checked-at')).toBeNull();
  });

  it('fresh reading shows when it was read', async () => {
    mockRun = { view: 'reading', reading: reading(), readAt: Date.UTC(2026, 8, 26, 10) };
    const { getByTestId } = await renderCard();
    expect(getByTestId('verdict-checked-at')).toHaveTextContent('Last checked', { exact: false });
  });

  it('Check again calls refresh', async () => {
    const { getByTestId } = await renderCard();
    fireEvent.press(getByTestId('verdict-refresh'));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('ImportRunVerdictCard — imported people (behind importReview)', () => {
  it('importReview OFF → no roster section even when settled', async () => {
    mockRun = { view: 'reading', reading: reading({ status: 'complete' }) };
    const { queryByTestId } = await renderCard();
    expect(queryByTestId('import-roster')).toBeNull();
    expect(mockUseRoster).not.toHaveBeenCalled();
  });

  it('importReview ON but still open → no roster section', async () => {
    flags.importReview = true;
    const { queryByTestId } = await renderCard();
    expect(queryByTestId('import-roster')).toBeNull();
    expect(mockUseRoster).not.toHaveBeenCalled();
  });

  it('importReview ON + settled → rows read "Imported, not yet joined"', async () => {
    flags.importReview = true;
    mockRun = { view: 'reading', reading: reading({ status: 'partial', reasonCode: 'unresolved_identities' }) };
    mockRoster = {
      view: 'page',
      persons: [
        { id: 'p1', displayName: 'Jordan Ellis', state: 'InvitePending' },
        { id: 'p2', displayName: null, state: 'unknown' },
      ],
      accounting: { staged: 3, reconstructed: 2, skipped: 1, failed: 0 },
      rosterBridgePending: true,
      hasMore: true,
    };
    const { getByTestId, text } = await renderCard();
    expect(mockUseRoster).toHaveBeenCalledWith(INTENT, true);
    expect(getByTestId('roster-person-p1')).toHaveTextContent('Imported, not yet joined', { exact: false });
    expect(getByTestId('roster-person-p2')).toHaveTextContent('Name not provided', { exact: false });
    expect(getByTestId('roster-person-p2')).toHaveTextContent('joining status not known yet', { exact: false });
    expect(getByTestId('roster-bridge-note')).toHaveTextContent('aren’t in your client list', { exact: false });
    expect(getByTestId('roster-accounting')).toHaveTextContent('Found 3: 2 imported, 1 skipped', { exact: false });
    fireEvent.press(getByTestId('roster-more'));
    expect(mockFetchMore).toHaveBeenCalled();
    expectNoBannedWords(text);
  });

  it('accounting / bridge flag not known → "not known yet", never zeros', async () => {
    flags.importReview = true;
    mockRun = { view: 'reading', reading: reading({ status: 'complete' }) };
    mockRoster = { view: 'page', persons: [], rosterBridgePending: null };
    const { getByTestId, text } = await renderCard();
    expect(getByTestId('roster-accounting')).toHaveTextContent('not known yet', { exact: false });
    expect(getByTestId('roster-bridge-note')).toHaveTextContent('not known yet', { exact: false });
    expect(getByTestId('roster-empty')).toBeTruthy();
    expect(text).not.toMatch(/\b0\b/);
  });

  it.each(['notFound', 'unreadable', 'error'])('roster %s → "not known yet", never an empty list', async (view) => {
    flags.importReview = true;
    mockRun = { view: 'reading', reading: reading({ status: 'complete' }) };
    mockRoster = { view };
    const { getByTestId, queryByTestId } = await renderCard();
    expect(getByTestId(`roster-${view}`)).toHaveTextContent('not known yet', { exact: false });
    expect(queryByTestId('roster-empty')).toBeNull();
  });
});

describe('ImportRunVerdictCard — banned-words sweep over every state', () => {
  const readings: DecodedRunStatus[] = [
    ...RUN_PHASES.map((phase) => reading({ phase })),
    reading({ phase: 'unknown' }),
    ...SERVER_TERMINAL_STATUSES.flatMap((status) =>
      [null, 'unknown' as const, ...RUN_REASON_CODES].map((reasonCode) => reading({ status, reasonCode })),
    ),
    ...LEGACY_TERMINAL_STATUSES.map((status) => reading({ status, mode: 'legacy' })),
    reading({ status: 'unknown', mode: 'unknown' }),
  ];
  it('no authorized/ready/connected/verified/running in any rendered string or a11y label', async () => {
    for (const r of readings) {
      mockRun = { view: 'reading', reading: r, stale: true, readAt: Date.UTC(2026, 8, 26) };
      const { text } = await renderCard();
      expectNoBannedWords(text);
      await cleanup();
    }
    for (const view of ['loading', 'notFound', 'error', 'unreadable']) {
      mockRun = { view };
      const { text } = await renderCard();
      expectNoBannedWords(text);
      await cleanup();
    }
  });
});
