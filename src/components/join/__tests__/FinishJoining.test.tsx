/**
 * B-PACKAGE-135: JoinPackageHost (beside the client tabs) opens the package
 * screen when an accept point hands over a join, including one handed over
 * before it mounted. FinishJoining (Home) shows "Finish joining <coach>"
 * while a paid join is unpaid, and goes once the account has a coach.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { presentJoinFrom, readPendingJoin, takePresentedJoin, type JoinOutcome } from '../../../lib/joinPackage';
import FinishJoining from '../FinishJoining';
import JoinPackageHost, { JOIN_SHEET_HANDOFF_MS } from '../JoinPackageHost';

let mockUser: { id: string; coach_id?: string } | null = { id: 'u-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../screens/join/JoinPackageScreen', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ join }: { join: { package: { name: string } } }) => <Text testID="join-package-probe">{join.package.name}</Text>,
  };
});

const PAID: JoinOutcome = {
  status: 'checkout_required',
  grant_mode: 'none',
  package: {
    id: 'pkg-1', name: 'Strength coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring',
    interval: 'month', interval_count: 1, recurring_amount_cents: null, recurring_interval: null,
    recurring_interval_count: null, trial_days: 0, is_free: false,
  },
  coach: { id: 'coach-1', first_name: 'Bradley' },
  code: 'GP-BRADLEY',
};

beforeEach(async () => {
  mockUser = { id: 'u-1' };
  takePresentedJoin();
  await AsyncStorage.clear();
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

it('no pending join (older backend, or nothing joined): no row, no package screen', async () => {
  const ui = await render(<><FinishJoining /><JoinPackageHost /></>);
  await flush();
  expect(ui.queryByTestId('finish-joining')).toBeNull();
  expect(ui.queryByTestId('join-package-probe')).toBeNull();
});

it('a join handed over before the tabs mounted opens the package screen on mount', async () => {
  presentJoinFrom({ coach_id: null, already_attached: false, invite_join: PAID });
  const ui = await render(<JoinPackageHost />);
  expect(ui.queryByTestId('join-package-probe')).toBeNull(); // waits for a closing sheet
  const probe = await ui.findByTestId('join-package-probe', {}, { timeout: JOIN_SHEET_HANDOFF_MS * 4 });
  expect(probe.props.children).toBe('Strength coaching');
});

it('after Not now Home offers Finish joining <coach>, which opens the package screen again', async () => {
  presentJoinFrom({ coach_id: null, already_attached: false, join: PAID });
  takePresentedJoin(); // the first showing was closed
  await flush();
  const ui = await render(<><FinishJoining /><JoinPackageHost /></>);
  expect(await ui.findByText('Finish joining Bradley')).toBeTruthy();
  expect(ui.queryByTestId('join-package-probe')).toBeNull();
  fireEvent.press(ui.getByTestId('finish-joining-row'));
  expect(await ui.findByTestId('join-package-probe', {}, { timeout: JOIN_SHEET_HANDOFF_MS * 4 })).toBeTruthy();
});

it('once the account has a coach (the purchase attached it) the row goes and the pending join clears', async () => {
  presentJoinFrom({ coach_id: null, already_attached: false, join: PAID });
  await flush();
  mockUser = { id: 'u-1', coach_id: 'coach-1' };
  const ui = await render(<FinishJoining />);
  await waitFor(async () => expect(await readPendingJoin()).toBeNull());
  expect(ui.queryByTestId('finish-joining')).toBeNull();
});
