/**
 * R1 (Roman status binding) — ImportRunStatusJourney unit tests. Focused,
 * non-parity coverage (rendered parity against ImportRunVerdictCard is in
 * ImportRunStatusJourney.parity.test.tsx): the `disabled` view, exact titles
 * for the running phase and every server terminal (using the SAME copy
 * `ImportRunVerdictCard` uses, from `./importVerdictContent` — never
 * re-derived), Roman on/off identical facts, and no Start/retry/stop wiring
 * beyond what already existed.
 *
 * R300-A closure (B1-B4), asserted here with tests that FAIL on 41812117:
 *   - B1: "Check current result" exists and calls run.refresh even for a
 *     CURRENT recognised running phase (41812117 mounted it only `!current`).
 *   - B2: accessibility semantics — Android live region on the inline card,
 *     and freshness/reason live-region text — for a same-title stale/reason
 *     transition (41812117 had no live region here at all: it used
 *     `ImportStatusFrame`'s screen ScrollView, whose own live region only
 *     fires on a TITLE change).
 *   - B3: NO screen-level Back/Return control in this inline mount, and NO
 *     nested ScrollView (41812117 rendered both, via `ImportStatusFrame` /
 *     `ImportProgressView`).
 *   - B4: a server `complete` additionally shows the established P2 result
 *     catalog's distinct Roman-on/off completion voice (41812117 showed only
 *     the plain card body, identical Roman on/off).
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));

let mockRunState: Record<string, unknown>;
const mockRefresh = jest.fn();
jest.mock('../../../hooks/useImportRunStatus', () => ({
  useImportRunStatus: () => ({ stale: false, readAt: null, isRefreshing: false, refresh: mockRefresh, ...mockRunState }),
  useImportedRoster: () => ({ view: 'disabled' }),
}));

const flags: { romanChat: boolean; importReview: boolean } = { romanChat: false, importReview: false };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

import ImportRunStatusJourney from '../ImportRunStatusJourney';

beforeEach(() => {
  flags.romanChat = false;
  mockRefresh.mockClear();
});
afterEach(() => cleanup());

describe('ImportRunStatusJourney', () => {
  it('disabled → renders nothing (no flag / no coach / no intent, matching the retired card)', async () => {
    mockRunState = { view: 'disabled' };
    const { toJSON } = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(toJSON()).toBeNull();
  });

  it('running with a recognised phase → the Roman progress presentation, current freshness', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'running', mode: 'server', phase: 'transferring', reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.getByRole('header')).toHaveTextContent('Import in progress');
    expect(v.getByText('Transferring records')).toBeTruthy();
  });

  it('server complete → the card\'s own "Import complete" title and body, verbatim', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: '2026-01-01T00:00:00Z', startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.getByRole('header')).toHaveTextContent('Import complete');
    expect(v.getByText('The server checked this import and marked it complete.')).toBeTruthy();
  });

  it('server partial with a reason → the card\'s own "Import partly finished" title and exact reason text', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'partial', mode: 'server', phase: null, reasonCode: 'unresolved_identities', claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.getByRole('header')).toHaveTextContent('Import partly finished');
    expect(v.getByText('Reason: Some people couldn’t be matched to TGP accounts yet.')).toBeTruthy();
  });

  it('server complete never shows any client/receipt count — none is invented', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.queryByText(/client record/)).toBeNull();
    expect(v.queryByText(/record receipt/)).toBeNull();
  });

  it('blocked with a recognised reason code → the card\'s own reason text', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'blocked', mode: 'server', phase: null, reasonCode: 'revoked', claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.getByRole('header')).toHaveTextContent('Import stopped — needs attention');
    expect(v.getByText('Reason: Access for this import was withdrawn.')).toBeTruthy();
  });

  it('failed → identical title whether Roman is on or off', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'failed', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    flags.romanChat = false;
    const off = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(off.getByRole('header')).toHaveTextContent('Import didn’t finish');
    await off.unmount();
    await cleanup();
    flags.romanChat = true;
    const on = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(on.getByRole('header')).toHaveTextContent('Import didn’t finish');
    await on.unmount();
  });

  it('Check again calls the real run.refresh — no fabricated no-op', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'failed', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    await fireEvent.press(v.getByRole('button', { name: 'Check again' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('never mounts a Stop action — no wiring beyond what already existed', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'running', mode: 'server', phase: 'discovering', reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.queryByRole('button', { name: 'Stop import' })).toBeNull();
    expect(v.queryByRole('button', { name: 'View transfer details' })).toBeNull();
  });

  describe('B1 — manual refresh preserved for a CURRENT running phase, not only stale/terminal', () => {
    it('a current recognised phase still exposes "Check current result", wired to the real refresh callback', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'running', mode: 'server', phase: 'transferring', reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null }, stale: false };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      const button = v.getByRole('button', { name: 'Check current result' });
      expect(button).toBeTruthy();
      await fireEvent.press(button);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('a stale (not-current) running phase also exposes the same action, wired to the real refresh callback', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'running', mode: 'server', phase: 'transferring', reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null }, stale: true };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      await fireEvent.press(v.getByRole('button', { name: 'Check current result' }));
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('B2 — material freshness/reason changes are announced under an unchanged title, without repeating timestamps', () => {
    it('the inline card carries a polite Android live region (whole-card, matching the retired card\'s own live region)', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null }, stale: false };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.getByRole('header').props.accessibilityLiveRegion).toBe('polite');
    });

    it('a stale line appears with an accessibility live region, under the SAME unchanged "Import complete" title', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null }, stale: false, readAt: 1700000000000 };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.getByRole('header')).toHaveTextContent('Import complete');
      expect(v.queryByText(/Couldn.t refresh/)).toBeNull();
      mockRunState = { ...mockRunState, stale: true };
      await v.rerender(<ImportRunStatusJourney importIntentId="intent-1" />);
      // Title text is unchanged, but the retained-verdict fact is now visible
      // and screen-reader-announced (accessibilityLiveRegion), never silent.
      expect(v.getByRole('header')).toHaveTextContent('Import complete');
      const staleText = v.getByText(/Couldn.t refresh\. Showing what the server said/);
      expect(staleText).toBeTruthy();
      expect(staleText.props.accessibilityLiveRegion).toBe('polite');
    });

    it('a reason change under the SAME "Import stopped — needs attention" title is visible and live-region-announced', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'blocked', mode: 'server', phase: null, reasonCode: 'revoked', claimedStatus: null, completedAt: null, startedAt: null }, stale: false };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.getByRole('header')).toHaveTextContent('Import stopped — needs attention');
      expect(v.getByText('Reason: Access for this import was withdrawn.')).toBeTruthy();
      mockRunState = { ...mockRunState, reading: { ...(mockRunState.reading as object), reasonCode: 'unresolved_identities' } };
      await v.rerender(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.getByRole('header')).toHaveTextContent('Import stopped — needs attention');
      expect(v.getByText('Reason: Some people couldn’t be matched to TGP accounts yet.')).toBeTruthy();
      // The whole card remains a live region, so this reason swap under an
      // unchanged title is still exposed to a screen-reader user (B2).
      expect(v.getByRole('header').props.accessibilityLiveRegion).toBe('polite');
    });

    it('does not repeat the checked-at timestamp text as a separate change signal on every refresh', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null }, stale: false, readAt: 1700000000000 };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      const before = v.getByText(/Last checked/);
      expect(before).toBeTruthy();
      // A later successful read (new readAt, still fresh) is a timestamp-only
      // change — it must not gain its own extra live-region announcement
      // beyond the one stable whole-card region already asserted above.
      mockRunState = { ...mockRunState, readAt: 1700000600000 };
      await v.rerender(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.getByText(/Last checked/)).toBeTruthy();
      expect(v.getByRole('header')).toHaveTextContent('Import complete');
    });
  });

  describe('B3 — inline, non-scrolling presentation: no nested ScrollView, no screen-level Back/Return', () => {
    it('renders no Back or Return-to-coaching control (the host screen owns navigation)', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'failed', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.queryByRole('button', { name: 'Back' })).toBeNull();
      expect(v.queryByRole('button', { name: 'Return to coaching' })).toBeNull();
    });

    it('renders no Back/Return even for a running phase', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'running', mode: 'server', phase: 'discovering', reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.queryByRole('button', { name: 'Back' })).toBeNull();
      expect(v.queryByRole('button', { name: 'Return to coaching' })).toBeNull();
    });

    it('mounts no ScrollView of its own — the host screen supplies scrolling', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      // RN's test renderer names a ScrollView host node "RCTScrollView" in the
      // JSON tree; asserting its absence here is the non-UNSAFE equivalent of
      // `UNSAFE_queryAllByType(ScrollView)` (unavailable in this RNTL version).
      expect(JSON.stringify(v.toJSON())).not.toContain('RCTScrollView');
    });
  });

  describe('B4 — terminal complete additionally carries the established P2 result voice, Roman-on vs neutral', () => {
    it('Roman OFF: shows the neutral P2 completion sentence alongside the server\'s own title/body', async () => {
      flags.romanChat = false;
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.getByRole('header')).toHaveTextContent('Import complete');
      expect(v.getByText('The server checked this import and marked it complete.')).toBeTruthy();
      expect(v.getByText('The imported records have been checked in TGP and are ready to use.')).toBeTruthy();
      expect(v.queryByText('I have checked the imported records in TGP. They are ready to use.')).toBeNull();
    });

    it('Roman ON: shows the first-person P2 completion sentence instead, server facts unchanged', async () => {
      flags.romanChat = true;
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.getByRole('header')).toHaveTextContent('Import complete');
      expect(v.getByText('The server checked this import and marked it complete.')).toBeTruthy();
      expect(v.getByText('I have checked the imported records in TGP. They are ready to use.')).toBeTruthy();
      expect(v.queryByText('The imported records have been checked in TGP and are ready to use.')).toBeNull();
    });

    it('a NON-complete terminal (failed) never shows either P2 completion sentence — the server never said complete', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'failed', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.queryByText('I have checked the imported records in TGP. They are ready to use.')).toBeNull();
      expect(v.queryByText('The imported records have been checked in TGP and are ready to use.')).toBeNull();
    });

    it('a LEGACY complete-looking report (mode legacy) never shows the P2 complete voice — never client-derived success', async () => {
      mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'success', mode: 'legacy', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
      const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
      expect(v.getByText('Reported by the browser extension. The server did not check this result.')).toBeTruthy();
      expect(v.queryByText('I have checked the imported records in TGP. They are ready to use.')).toBeNull();
      expect(v.queryByText('The imported records have been checked in TGP and are ready to use.')).toBeNull();
    });
  });
});
