/**
 * R1 (Roman status binding) — ImportRunStatusJourney: wires the real
 * useImportRunStatus(intentId) reading through the one pure adapter into the
 * Roman P2 progress/result views. Roman on and Roman off both render the same
 * status (only the portrait / first-person completion copy differs) — the
 * flag never changes which view or outcome is shown. `disabled` renders
 * nothing, matching the retired ImportRunVerdictCard's `view === 'disabled'`
 * behaviour.
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
}));

const flags: { romanChat: boolean } = { romanChat: false };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return flags;
  },
}));

import ImportRunStatusJourney from '../ImportRunStatusJourney';

beforeEach(() => {
  flags.romanChat = false;
  mockGoBack.mockClear();
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

  it('server complete → the result view shows complete, matching the server verdict authority (no regression from ImportRunVerdictCard)', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: '2026-01-01T00:00:00Z', startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.getByRole('header')).toHaveTextContent('Your records are ready');
    expect(v.getByText('The imported records have been checked in TGP and are ready to use.')).toBeTruthy();
  });

  it('server partial with a reason → the result view shows partial with the mapped reason (no regression from ImportRunVerdictCard)', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'partial', mode: 'server', phase: null, reasonCode: 'unresolved_identities', claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.getByRole('header')).toHaveTextContent('Some records are ready');
    expect(v.getByText('The source account could not be confirmed. Check the selected tab before continuing.')).toBeTruthy();
  });

  it('server complete never shows counts — no native proof is invented to accompany the server word', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'complete', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.queryByText(/client record/)).toBeNull();
    expect(v.queryByText(/record receipt/)).toBeNull();
  });

  it('blocked with a recognised reason code → the result view surfaces the mapped reason', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'blocked', mode: 'server', phase: null, reasonCode: 'revoked', claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.getByRole('header')).toHaveTextContent('Import needs attention');
    expect(v.getByText('Access was not granted. Allow access to the selected source to continue.')).toBeTruthy();
  });

  it('failed → the result view shows the failed outcome, identically whether Roman is on or off', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'failed', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    flags.romanChat = false;
    const off = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(off.getByRole('header')).toHaveTextContent('Import did not complete');
    await off.unmount();
    await cleanup();
    flags.romanChat = true;
    const on = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(on.getByRole('header')).toHaveTextContent('Import did not complete');
    await on.unmount();
  });

  it('Back / Return to coaching call real navigation.goBack — no fabricated no-op', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'failed', mode: 'server', phase: null, reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    await fireEvent.press(v.getByRole('button', { name: 'Back' }));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(v.getByRole('button', { name: 'Return to coaching' }));
    expect(mockGoBack).toHaveBeenCalledTimes(2);
  });

  it('never mounts a Stop/Check/Details action — no wiring beyond what already existed', async () => {
    mockRunState = { view: 'reading', reading: { intentId: 'intent-1', status: 'running', mode: 'server', phase: 'discovering', reasonCode: null, claimedStatus: null, completedAt: null, startedAt: null } };
    const v = await render(<ImportRunStatusJourney importIntentId="intent-1" />);
    expect(v.queryByRole('button', { name: 'Stop import' })).toBeNull();
    expect(v.queryByRole('button', { name: 'Check current result' })).toBeNull();
    expect(v.queryByRole('button', { name: 'View transfer details' })).toBeNull();
  });
});
