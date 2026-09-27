/**
 * R1 (Roman status binding) — ImportRunStatusJourney unit tests. Focused,
 * non-parity coverage (rendered parity against ImportRunVerdictCard is in
 * ImportRunStatusJourney.parity.test.tsx): the `disabled` view, exact titles
 * for the running phase and every server terminal (using the SAME copy
 * `ImportRunVerdictCard` uses, from `./importVerdictContent` — never
 * re-derived), Roman on/off identical facts, real navigation wiring, and no
 * Start/retry/stop wiring beyond what already existed.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockGoBack }) }));

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
  mockGoBack.mockClear();
  mockRefresh.mockClear();
});
afterEach(() => cleanup());

describe('ImportRunStatusJourney', () => {
  it('disabled → renders nothing (no flag / no coach / no intent, matching the retired card)', async () => {
    mockRunState = { view: 'disabled' };
    const { toJSON } = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(toJSON()).toBeNull();
  });

  it('running with a recognised phase → the Roman progress view, current freshness', async () => {
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

  it('Back / Return to coaching / Check again call real navigation.goBack and run.refresh — no fabricated no-op', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'failed', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    await fireEvent.press(v.getByRole('button', { name: 'Back' }));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(v.getByRole('button', { name: 'Return to coaching' }));
    expect(mockGoBack).toHaveBeenCalledTimes(2);
    await fireEvent.press(v.getByRole('button', { name: 'Check again' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('never mounts a Stop action — no wiring beyond what already existed', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'running', mode: 'server', phase: 'discovering', reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.queryByRole('button', { name: 'Stop import' })).toBeNull();
    expect(v.queryByRole('button', { name: 'View transfer details' })).toBeNull();
  });
});
