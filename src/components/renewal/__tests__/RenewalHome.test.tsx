/**
 * RENEWAL-M (RENEWAL3; backend #1127 CONTRACT 6328688356): Home's renewal pop-up (M1-M4) and banner (B1-B2) from
 * the entitlement's `renewal` block. Real storage and pop-up rule; the sheet, navigation and network are mocked.
 */
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readRenewal, type Renewal } from '../../../lib/planRenewal';

let mockRenewal: Renewal | undefined;
const mockRefresh = jest.fn(async () => undefined);
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ renewal: mockRenewal, refreshEntitlement: mockRefresh }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', role: 'student' }) }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
const mockPost = jest.fn(async (..._a: unknown[]) => ({ data: {} }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: async () => ({ data: { name: 'Jordan Avery-Blake' } }), post: (...a: unknown[]) => mockPost(...a) } }));
jest.mock('../../../api/clientPaymentsApi', () => ({ clientPaymentsApi: {
  getPurchases: async () => ({ ok: true, data: [{ package_id: 'p-old', created_at: '2026-01-02' }, { package_id: 'p-last', created_at: '2026-07-01' }] }),
  getPackages: async () => ({ ok: true, data: [{ id: 'p-last', name: '12-week strength block' }, { id: 'p-old', name: 'Starter' }] }),
} }));
let mockTap: (() => void) | undefined;
jest.mock('../../../services/pushTapRouter', () => ({ onPlanRenewalTap: (l: () => void) => { mockTap = l; return () => undefined; } }));
jest.mock('../../PackageSelectionSheet', () => (p: { skipSnoozeCheck?: boolean }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID: `package-sheet-${p.skipSnoozeCheck}` }));

const RenewalHome: typeof import('../RenewalHome').default = require('../RenewalHome').default;
const COACH = { id: 'coach-1', first_name: 'Jordan' };
const ended = (step: number | null, extra: Record<string, unknown> = {}) => readRenewal({ renewal: { state: 'ended',
  ended_at: '2026-10-21T10:00:00.000Z', popup_due: step !== null, popup_step: step, banner_due: true, coach: COACH,
  house_coach: { id: 'house-1', first_name: 'Bradley' }, ...extra } });
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const open = async (r: Renewal | undefined) => { mockRenewal = r; const s = await render(<RenewalHome />); await s.findByTestId('renewal-popup'); return s; };

beforeEach(async () => { jest.clearAllMocks(); setOS('android'); await AsyncStorage.clear(); });
afterEach(() => setOS(realOS));

it.each([['no key', undefined], ['none', { state: 'none' }], ['revoked', { state: 'revoked' }]])('%s: nothing on Home', async (_l, r) => {
  mockRenewal = r as Renewal | undefined;
  const s = await render(<RenewalHome />);
  await act(async () => undefined);
  expect(s.toJSON()).toBeNull();
  expect(mockPost).not.toHaveBeenCalled();
});

it.each([[0, 'Your plan ended today'], [1, 'Your plan ended yesterday'], [7, 'Your plan ended a week ago']])(
  'Day %s: pop-up with title, last package, both choices and Skip, acknowledged; once per step', async (step, title) => {
    const s = await open(ended(step));
    expect(s.getByText(title)).toBeTruthy();
    expect(s.getByText('Pick a plan to keep working with Jordan.')).toBeTruthy();
    expect(await s.findByText('12-week strength block')).toBeTruthy();
    expect(s.getAllByText("View Coach Jordan's packages")).toHaveLength(2); // pop-up and banner
    expect(s.getAllByText("Join TGP's Top Rated Coach")).toHaveLength(2);
    expect(mockPost).toHaveBeenCalledWith('/v1/checkout/renewal/popup-ack', { step });
    await s.unmount();
    const again = await render(<RenewalHome />);
    await again.findByTestId('renewal-banner');
    await act(async () => undefined);
    expect(again.queryByTestId('renewal-popup')).toBeNull();
  });

it.each([['no house coach', null], ['the house coach is the coach', COACH]])('%s: only the own-coach choice', async (_l, house) => {
  const s = await open(ended(0, { house_coach: house }));
  expect(s.queryByTestId('renewal-house-coach')).toBeNull();
  expect(s.getAllByTestId('renewal-own-coach')).toHaveLength(2);
});

it('own coach (iOS): the sheet waits until the pop-up has closed', async () => {
  setOS('ios');
  const s = await open(ended(0));
  const dismissed = s.getByTestId('renewal-modal').props.onDismiss as () => void;
  await fireEvent.press(s.getAllByTestId('renewal-own-coach')[0]);
  expect(s.queryByTestId('package-sheet-true')).toBeNull();
  await act(async () => dismissed());
  expect(s.getByTestId('package-sheet-true')).toBeTruthy();
});

it('house coach (Android, at once): opens HouseCoach with the coach the server named', async () => {
  const s = await open(ended(7));
  await fireEvent.press(s.getAllByTestId('renewal-house-coach')[0]);
  expect(s.queryByTestId('renewal-popup')).toBeNull();
  expect(mockNavigate).toHaveBeenCalledWith('HouseCoach', { coach: { id: 'house-1', firstName: 'Bradley' } });
});

it('banner day: "Renew now" with the last package and end date, no pop-up, no ack; own coach opens the sheet', async () => {
  mockRenewal = ended(null);
  const s = await render(<RenewalHome />);
  expect(await s.findByText('Renew now')).toBeTruthy();
  await waitFor(() => expect(s.getByText(/^12-week strength block · ended /)).toBeTruthy());
  expect(s.queryByTestId('renewal-popup')).toBeNull();
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.press(s.getByTestId('renewal-own-coach'));
  expect(s.getByTestId('package-sheet-true')).toBeTruthy();
});

it("Skip closes the pop-up and the banner stays; a plan_renewal tap re-reads the plan and opens it again", async () => {
  const s = await open(ended(1));
  await fireEvent.press(s.getByTestId('renewal-skip'));
  expect(s.queryByTestId('renewal-popup')).toBeNull();
  expect(s.getByTestId('renewal-banner')).toBeTruthy();
  await act(async () => mockTap?.());
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  mockRenewal = ended(1); // the re-read
  await s.rerender(<RenewalHome />);
  expect(await s.findByTestId('renewal-popup')).toBeTruthy();
});
