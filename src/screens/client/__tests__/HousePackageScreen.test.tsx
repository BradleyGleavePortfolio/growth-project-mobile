/** SWITCH-CONFIRM-M (owner #166-5): one house package, everything the server sends and its price; pay only from its button. */
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readHousePackages, settleHouseJoin, type HousePackage } from '../../../lib/planRenewal';
import { planTerms } from '../../../lib/planTerms';

let mockBottom = 0;
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: mockBottom, left: 0, right: 0 }) }));
jest.mock('expo-status-bar', () => ({ StatusBar: ({ style }: { style: string }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID: `status-bar-${style}` }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', email: '', role: 'student', coach_id: 'old-1' }) }));
const mockRefresh = jest.fn(async () => undefined);
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: mockRefresh }) }));
const mockPatch = jest.fn(async (..._a: unknown[]) => undefined);
let mockCached: { id: string; coach_id?: string } | null = { id: 'client-1', coach_id: 'old-1' };
jest.mock('../../../lib/userCache', () => ({ patchUserCache: (...a: unknown[]) => mockPatch(...a), readUserCacheSync: () => mockCached }));
const mockEmit = jest.fn();
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: (...a: unknown[]) => mockEmit(...a) } }));
const mockApi = { get: jest.fn(), post: jest.fn() };
const mockMe = jest.fn(async (): Promise<{ data: unknown }> => ({ data: {} }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi, authApi: { me: () => mockMe() } }));
type SheetProps = { visible: boolean; house?: { id: string; name: string }; initialPackageId?: string; skipSnoozeCheck?: boolean; onDismiss: () => void; onPaymentSuccess: (paid: boolean) => void };
let mockSheet: SheetProps | null = null;
jest.mock('../../../components/PackageSelectionSheet', () => (p: SheetProps) => {
  mockSheet = p;
  return jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID: 'package-sheet' });
});

const Screen: typeof import('../HousePackageScreen').default = require('../HousePackageScreen').default;
const HOUSE = { id: 'house-1', firstName: 'Bradley', fullName: 'Bradley Gleave' };
const QUOTE = { due_today_cents: 29900, currency: 'usd', first_charge_at: null };
const [ONE, SUB, BARE] = readHousePackages({ packages: [
  { id: 'h-1', name: '12-week strength block', price_cents: 29900, currency: 'usd', billing_type: 'one_time', duration_periods: 12, description: '  Weekly check-ins and a training plan.  ', quote: QUOTE },
  { id: 'h-2', name: 'Monthly coaching', amount_cents: 14900, currency: 'usd', billing_type: 'recurring', interval: 'month', duration_periods: 6, description: 'Monthly calls.' },
  { id: 'h-3', name: 'Lifetime plan', price_cents: 9900, currency: 'usd', billing_type: 'one_time' },
] });
const nav = { goBack: jest.fn(), popToTop: jest.fn() };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = (pkg: HousePackage, coach: { id: string; firstName: string; fullName?: string } = HOUSE) => render(<Screen route={{ key: 'p', name: 'HousePackage', params: { coach, pkg } } as any} navigation={nav as any} />);

const noted = () => waitFor(async () => expect((await AsyncStorage.getAllKeys()).some((k) => k.includes('house_join'))).toBe(true));

beforeEach(async () => { jest.clearAllMocks(); mockSheet = null; mockCached = { id: 'client-1', coach_id: 'old-1' }; await AsyncStorage.clear(); });

it('one-time: price, billing, length and what is included, in that order; no sheet and no request until the button', async () => {
  const s = await mount(ONE);
  const t = planTerms(ONE);
  expect(s.getByText('1:1 coaching with Bradley Gleave')).toBeTruthy();
  expect(s.getByText('12-week strength block')).toBeTruthy();
  expect(s.getByTestId('house-package-price').props.children).toBe(t.price);
  expect(t.firstCharge).toBeTruthy();
  const section = (i: number, title: string, line: string) => {
    const at = within(s.getByTestId(`house-package-section-${i}`));
    expect(at.getByText(title)).toBeTruthy();
    expect(at.getByText(line)).toBeTruthy();
  };
  section(0, 'Billing', t.firstCharge as string);
  section(1, 'Length', '12 weeks from the day you pay');
  section(2, "What's included", 'Weekly check-ins and a training plan.');
  expect(s.queryByText(/trial/i)).toBeNull();
  expect(s.queryByTestId('package-sheet')).toBeNull();
  expect(mockApi.get).not.toHaveBeenCalled();
  expect(mockApi.post).not.toHaveBeenCalled();
  expect(s.getByTestId('house-package-select').props.accessibilityLabel).toBe(`Select this plan, 12-week strength block, ${t.price}`);
});

it('renewing: the renewal line and no Length, even when the row has duration_periods', async () => {
  const s = await mount(SUB);
  expect(SUB.weeks).toBeNull();
  expect(s.getByText(planTerms(SUB).renewal as string)).toBeTruthy();
  expect(s.queryByText('Length')).toBeNull();
  expect(s.getByText('Monthly calls.')).toBeTruthy();
});

it('no description and no quote: only what the server sent (no empty sections)', async () => {
  const s = await mount(BARE);
  expect(BARE.description).toBeNull();
  expect(s.getByTestId('house-package-price').props.children).toBe(planTerms(BARE).price);
  expect(s.queryByText("What's included")).toBeNull();
  expect(s.queryByText('Billing')).toBeNull();
  expect(s.queryByTestId('house-package-section-0')).toBeNull();
});

it('a server without full_name (before backend #1142): the first name, as before', async () => {
  const s = await mount(ONE, { id: 'house-1', firstName: 'Bradley' });
  expect(s.getByText('1:1 coaching with Bradley')).toBeTruthy();
  await fireEvent.press(s.getByTestId('house-package-select'));
  expect(mockSheet?.house).toEqual({ id: 'house-1', name: 'Bradley' });
});

it("the button opens #836's sheet with this package under his full name; dismiss stays; paid: coach saved, Home re-reads the account, plan re-read, Home", async () => {
  const s = await mount(ONE);
  await fireEvent.press(s.getByTestId('house-package-select'));
  expect(mockSheet).toMatchObject({ visible: true, skipSnoozeCheck: true, house: { id: 'house-1', name: 'Bradley Gleave' }, initialPackageId: 'h-1' });
  await act(async () => (mockSheet as SheetProps).onDismiss());
  expect(s.queryByTestId('package-sheet')).toBeNull();
  expect(nav.goBack).not.toHaveBeenCalled();
  expect(mockPatch).not.toHaveBeenCalled();
  await fireEvent.press(s.getByTestId('house-package-select'));
  await act(async () => (mockSheet as SheetProps).onPaymentSuccess(true));
  expect(mockPatch).toHaveBeenCalledWith({ coach_id: 'house-1' });
  expect(mockEmit).toHaveBeenCalledWith('login');
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(nav.popToTop).toHaveBeenCalledTimes(1);
});

it('B3 (m#853 FIX R1): Continue after a slow or pending confirmation: no coach change on the phone yet (the server moves him), plan re-read, Home', async () => {
  const s = await mount(ONE);
  await fireEvent.press(s.getByTestId('house-package-select'));
  await act(async () => (mockSheet as SheetProps).onPaymentSuccess(false));
  expect(mockPatch).not.toHaveBeenCalled();
  expect(mockEmit).not.toHaveBeenCalled();
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(nav.popToTop).toHaveBeenCalledTimes(1);
});

it('Sol B1 (m#860 FIX R2): pending at Continue, then the server moves him later: Home\'s check moves the cached coach once, never before', async () => {
  const s = await mount(ONE);
  await fireEvent.press(s.getByTestId('house-package-select'));
  await act(async () => (mockSheet as SheetProps).onPaymentSuccess(false));
  await noted();
  mockMe.mockResolvedValue({ data: { id: 'client-1', coach_id: 'old-1' } }); // the webhook has not landed
  await expect(settleHouseJoin('client-1')).resolves.toBe(false);
  mockMe.mockResolvedValue({ data: { id: 'client-2', coach_id: 'house-1' } }); // another account's answer
  await expect(settleHouseJoin('client-1')).resolves.toBe(false);
  mockCached = { id: 'client-2' }; // signed out and in as someone else meanwhile
  mockMe.mockResolvedValue({ data: { id: 'client-1', coach_id: 'house-1' } });
  await expect(settleHouseJoin('client-1')).resolves.toBe(false);
  expect(mockPatch).not.toHaveBeenCalled();
  expect(mockEmit).not.toHaveBeenCalled();
  mockCached = { id: 'client-1', coach_id: 'old-1' };
  await expect(settleHouseJoin('client-1')).resolves.toBe(true); // the server names him: the phone follows
  expect(mockPatch.mock.calls).toEqual([[{ coach_id: 'house-1' }]]);
  expect(mockEmit.mock.calls).toEqual([['login']]);
  mockMe.mockClear();
  await expect(settleHouseJoin('client-1')).resolves.toBe(false); // settled: no more reads
  expect(mockMe).not.toHaveBeenCalled();
});

it('Sol B1: a paid join notes nothing; a pending one older than a day is dropped without a read', async () => {
  const s = await mount(ONE);
  await fireEvent.press(s.getByTestId('house-package-select'));
  await act(async () => (mockSheet as SheetProps).onPaymentSuccess(true));
  await expect(settleHouseJoin('client-1')).resolves.toBe(false);
  await fireEvent.press(s.getByTestId('house-package-select'));
  await act(async () => (mockSheet as SheetProps).onPaymentSuccess(false));
  await noted();
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 25 * 60 * 60 * 1000);
  await expect(settleHouseJoin('client-1')).resolves.toBe(false);
  clock.mockRestore();
  await expect(settleHouseJoin('client-1')).resolves.toBe(false);
  expect(mockMe).not.toHaveBeenCalled();
});

it('a failed cache write still re-reads the account and goes Home', async () => {
  mockPatch.mockRejectedValueOnce(new Error('disk'));
  const s = await mount(ONE);
  await fireEvent.press(s.getByTestId('house-package-select'));
  await act(async () => (mockSheet as SheetProps).onPaymentSuccess(true));
  expect(mockEmit).toHaveBeenCalledWith('login');
  expect(nav.popToTop).toHaveBeenCalledTimes(1);
});

it('m#860 FIX R3 (Opus C4): the foot adds no bottom inset; the tab bar under the page holds it', async () => {
  mockBottom = 34;
  try {
    const s = await mount(ONE);
    expect(StyleSheet.flatten(s.getByTestId('house-package-foot').props.style)).toMatchObject({ paddingTop: 12, paddingBottom: 8 });
  } finally { mockBottom = 0; }
});

it('m#860 FIX R3 (Opus C5): on Android dark status icons go up before the light sheet opens and stay while it is up; iOS keeps its bar', async () => {
  const realOS = Platform.OS;
  const s = await mount(ONE);
  await fireEvent.press(s.getByTestId('house-package-select'));
  expect(s.getByTestId('package-sheet')).toBeTruthy();
  expect(s.queryByTestId('status-bar-dark')).toBeNull();
  await act(async () => (mockSheet as SheetProps).onDismiss());
  s.unmount();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  try {
    const a = await mount(ONE);
    expect(a.queryByTestId('status-bar-dark')).toBeNull();
    await fireEvent.press(a.getByTestId('house-package-select'));
    await waitFor(() => expect(a.getByTestId('status-bar-dark')).toBeTruthy());
    await waitFor(() => expect(a.getByTestId('package-sheet')).toBeTruthy());
    expect(a.getByTestId('status-bar-dark')).toBeTruthy(); // held while the sheet is up; it comes down with sheet 'off'
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
  }
});
