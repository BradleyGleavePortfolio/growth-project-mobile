/**
 * RENEWAL-M (RENEWAL3; backend #1127 CONTRACT 6328688356): Home's renewal pop-up (M1-M4) and banner (B1-B2) from
 * the entitlement's `renewal` block. Real storage and pop-up rule; the sheet, navigation and network are mocked.
 */
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { noteHouseJoinPending, readRenewal, type Renewal } from '../../../lib/planRenewal';
import { readUserCacheSync, setUserCache } from '../../../lib/userCache';
import { authEvents } from '../../../utils/authEvents';

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
const mockMe = jest.fn(async (): Promise<{ data: unknown }> => ({ data: {} }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: async () => ({ data: { name: 'Jordan Avery-Blake' } }), post: (...a: unknown[]) => mockPost(...a) }, authApi: { me: () => mockMe() } }));
jest.mock('../../../api/clientPaymentsApi', () => ({ clientPaymentsApi: {
  getPurchases: async () => ({ ok: true, data: [{ package_id: 'p-old', created_at: '2026-01-02' }, { package_id: 'p-last', created_at: '2026-07-01' }] }),
  getPackages: async () => ({ ok: true, data: [{ id: 'p-last', name: '12-week strength block' }, { id: 'p-old', name: 'Starter' }] }),
} }));
let mockTap: (() => void) | undefined;
jest.mock('../../../services/pushTapRouter', () => ({ onPlanRenewalTap: (l: () => void) => { mockTap = l; return () => undefined; } }));
jest.mock('../../PackageSelectionSheet', () => (p: { skipSnoozeCheck?: boolean; onPaymentSuccess: () => void }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').Pressable, { testID: `package-sheet-${p.skipSnoozeCheck}`, onPress: p.onPaymentSuccess }));

const RenewalHome: typeof import('../RenewalHome').default = require('../RenewalHome').default;
const { HouseJoined }: typeof import('../CoachMonogram') = require('../CoachMonogram');
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
  await fireEvent.press(s.getAllByTestId('renewal-own-coach')[0]);
  expect(mockNavigate).not.toHaveBeenCalled(); // nothing new without a house coach: own coach still opens the sheet
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

const HOUSE = { id: 'house-1', firstName: 'Bradley' };
it('house coach (Android, at once): the one-coach confirm page first, never the packages, naming the current coach', async () => {
  const s = await open(ended(7));
  await fireEvent.press(s.getAllByTestId('renewal-house-coach')[0]);
  expect(s.queryByTestId('renewal-popup')).toBeNull();
  expect(mockNavigate.mock.calls).toEqual([['HouseCoachConfirm', { coach: HOUSE, from: { id: 'coach-1', firstName: 'Jordan' } }]]);
});

it('house coach from the banner: the same confirm page; with no current coach it names none', async () => {
  mockRenewal = ended(null);
  const s = await render(<RenewalHome />);
  await fireEvent.press(await s.findByTestId('renewal-house-coach'));
  expect(mockNavigate.mock.calls).toEqual([['HouseCoachConfirm', { coach: HOUSE, from: { id: 'coach-1', firstName: 'Jordan' } }]]);
  await s.unmount();
  mockNavigate.mockClear();
  const none = await open(ended(0, { coach: null }));
  expect(none.queryByTestId('renewal-own-coach')).toBeNull();
  await fireEvent.press(none.getByTestId('renewal-house-coach'));
  expect(mockNavigate.mock.calls).toEqual([['HouseCoachConfirm', { coach: HOUSE, from: null }]]);
});

it('house coach full name (backend #1142): it reaches the confirm page; the current coach stays first name only', async () => {
  const s = await open(ended(7, { coach: { ...COACH, full_name: 'Jordan Reyes' }, house_coach: { id: 'house-1', first_name: 'Bradley', full_name: ' Bradley Gleave ' } }));
  await fireEvent.press(s.getAllByTestId('renewal-house-coach')[0]);
  expect(mockNavigate.mock.calls).toEqual([['HouseCoachConfirm', { coach: { ...HOUSE, fullName: 'Bradley Gleave' }, from: { id: 'coach-1', firstName: 'Jordan' } }]]);
});

it('banner day: "Renew now" with the last package and end date, no pop-up, no ack; own coach opens the sheet', async () => {
  mockRenewal = ended(null);
  const s = await render(<RenewalHome />);
  expect(await s.findByText('Renew now')).toBeTruthy();
  await waitFor(() => expect(s.getByText(/^12-week strength block · ended /)).toBeTruthy());
  // "ended Oct 21" stays on one line: no-break spaces (the default normalizer would fold them into spaces)
  expect(s.getByText(/ · ended\u00A0\S+\u00A0\d+$/, { normalizer: (t: string) => t })).toBeTruthy();
  expect(s.queryByTestId('renewal-popup')).toBeNull();
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.press(s.getByTestId('renewal-own-coach'));
  expect(s.getByTestId('package-sheet-true')).toBeTruthy();
});

it("banner (RENEWAL3 B1-B2) has its own sizes and the pop-up keeps its own; the screen's style places the banner", async () => {
  const s = await open(ended(1)); // the banner under the pop-up: both on screen
  await s.rerender(<RenewalHome style={{ marginTop: 7, marginBottom: 0 }} />);
  const st = (e: { props: { style?: unknown } }) => StyleSheet.flatten(e.props.style as never) as Record<string, unknown>;
  expect(st(s.getByTestId('renewal-banner'))).toMatchObject({ marginTop: 7, marginBottom: 0, padding: 16, borderRadius: 16 });
  // the banner uses the shared Monogram (m#860): 40 disc, 1.5 ring, 47 painted, laid out 40
  const ring = st(within(s.getByTestId('renewal-banner')).getByTestId('coach-monogram', { includeHiddenElements: true }));
  expect(ring).toMatchObject({ width: 47, height: 47, borderWidth: 1.5, margin: -3.5 });
  // the ring is painted outside the 40 pt disc and lays out 40, so the text starts 16 + 40 + 12 = 68 in (r3.py .rbn, .cms, gap)
  const head = st(s.getByTestId('renewal-banner').props.children[0]);
  expect(head).toMatchObject({ flexDirection: 'row', alignItems: 'center', gap: 12 });
  expect(Number(st(s.getByTestId('renewal-banner')).padding) + Number(ring.width) + 2 * Number(ring.margin) + Number(head.gap)).toBe(68);
  expect(st(s.getByText('Renew now'))).toMatchObject({ fontSize: 26, lineHeight: 32, letterSpacing: 0, color: '#FFFFFF' });
  const [bannerOwn, popupOwn] = s.getAllByTestId('renewal-own-coach').map(st);
  const [bannerHouse, popupHouse] = s.getAllByTestId('renewal-house-coach').map(st);
  expect(bannerOwn).toMatchObject({ minHeight: 48, paddingVertical: 10, paddingHorizontal: 14, marginTop: 14 });
  expect(bannerHouse).toMatchObject({ minHeight: 48, marginTop: 8, backgroundColor: '#26402F', borderWidth: 1.5, borderColor: '#4A6553' });
  // the pop-up's own sizes (m#860, r2b.py .modal: choices 12 + 10 = 22 below, 10 apart, 1.5 quiet edge)
  expect(popupOwn).toMatchObject({ minHeight: 52, paddingVertical: 12, paddingHorizontal: 16, marginTop: 10 });
  expect(popupHouse).toMatchObject({ minHeight: 52, marginTop: 10, borderWidth: 1.5 });
  expect(st(s.getAllByText("View Coach Jordan's packages")[0])).toMatchObject({ color: '#142019', letterSpacing: 0 });
});

it.each([['active', { state: 'active' }], ['none', { state: 'none' }]])(
  'B2: paid with the own coach, the plan re-reads as %s while the sheet is open; the sheet stays until Continue', async (_l, next) => {
    mockRenewal = ended(null);
    const s = await render(<RenewalHome />);
    await fireEvent.press(await s.findByTestId('renewal-own-coach'));
    mockRenewal = readRenewal({ renewal: next }); // the sheet's own re-read after payment
    await s.rerender(<RenewalHome />);
    expect(s.queryByTestId('renewal-banner')).toBeNull();
    expect(s.getByTestId('package-sheet-true')).toBeTruthy();
    await fireEvent.press(s.getByTestId('package-sheet-true')); // Continue
    expect(s.queryByTestId('package-sheet-true')).toBeNull();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
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

it('m#860 FIX R2 (Sol B1): a house join still confirming at Continue settles on Home once the server names him, not before', async () => {
  await setUserCache({ id: 'client-1', email: '', role: 'student', coach_id: 'coach-1' });
  await noteHouseJoinPending('client-1', 'house-1');
  const login = jest.fn();
  authEvents.on('login', login);
  mockMe.mockResolvedValue({ data: { id: 'client-1', coach_id: 'coach-1' } }); // Home on return: the webhook has not landed
  mockRenewal = ended(null);
  const s = await render(<RenewalHome />);
  await waitFor(() => expect(mockMe).toHaveBeenCalledTimes(1));
  await act(async () => undefined);
  expect(readUserCacheSync()?.coach_id).toBe('coach-1');
  expect(login).not.toHaveBeenCalled();
  mockMe.mockResolvedValue({ data: { id: 'client-1', coach_id: 'house-1' } }); // it lands; the next plan read (foreground)
  mockRenewal = { state: 'none' };
  await s.rerender(<RenewalHome />);
  await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
  expect(readUserCacheSync()?.coach_id).toBe('house-1');
  mockRenewal = { state: 'none' };
  await s.rerender(<RenewalHome />);
  await act(async () => undefined);
  expect(mockMe).toHaveBeenCalledTimes(2); // settled: no more reads
  authEvents.off('login', login);
});

it('m#860 FIX R2 (Sol B2) + R3 (Sol B1): quiet fill on the second choice; each ring painted outside the disc and taking no room', async () => {
  const s = await open(ended(0));
  for (const b of s.getAllByTestId('renewal-house-coach')) {
    expect(StyleSheet.flatten(b.props.style)).toMatchObject({ backgroundColor: '#26402F', borderWidth: 1.5, borderColor: '#4A6553' });
  }
  // painted: 72 (r2b.py .cm 64 + 2 gap + 2 ring) and 47 (r3.py .cms 40 + 2 + 1.5); laid out: the disc only, 64 and 40
  const rings = s.getAllByTestId('coach-monogram', { includeHiddenElements: true }).map((m) => StyleSheet.flatten(m.props.style));
  expect(rings.map((r) => [r.width, r.height, r.margin]).sort()).toEqual([[47, 47, -3.5], [72, 72, -4]]);
  expect(rings.map((r) => Number(r.width) + 2 * Number(r.margin)).sort()).toEqual([40, 64]);
  // the pop-up's disc sits 6 below the card's 28 (.cm margin 6px auto 0), so its ring starts 30 down, as in the frame
  const pop = s.getByTestId('renewal-popup');
  expect(StyleSheet.flatten(pop.props.style).paddingTop).toBe(28);
  expect(StyleSheet.flatten(pop.props.children[0].props.style)).toEqual({ marginTop: 6 });
  // the banner's text starts 16 + 40 + 12 = 68 in from the card edge (r3.py .rbn padding 16, .cms 40, gap 12)
  const banner = s.getByTestId('renewal-banner');
  expect(StyleSheet.flatten(banner.props.style).padding).toBe(16);
  expect(StyleSheet.flatten(banner.props.children[0].props.style)).toMatchObject({ flexDirection: 'row', gap: 12 });
});

it('m#860 FIX R3 (Sol B1, Opus C2): H3, his row is 12 + 40 + 12 tall and its text 14 + 40 + 12 in, as r3.py .nowc', async () => {
  const s = await render(<HouseJoined name="Bradley Gleave" title="You're all set" body="Body." onContinue={() => undefined} />);
  const row = s.getByTestId('payment-new-coach');
  expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 });
  const ring = StyleSheet.flatten(s.getByTestId('coach-monogram', { includeHiddenElements: true }).props.style);
  expect(ring).toMatchObject({ width: 47, height: 47, borderWidth: 1.5, margin: -3.5 });
  expect(Number(ring.width) + 2 * Number(ring.margin)).toBe(40);
});
