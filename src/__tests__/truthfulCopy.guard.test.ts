import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
const ROOT = path.resolve(__dirname, '..');
function shipped(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === '__tests__' || /\.(test|spec)\./.test(entry.name)) return [];
    return entry.isDirectory() ? shipped(full) : /\.(tsx?|json)$/.test(entry.name) ? [full] : [];
  });
}
it('does not bring back retired customer-facing claims', () => {
  const retired = ['One workout to go', 'Day 7 of 30', 'Everything is in order', 'finance pillar',
    'Your coach will assign your first workout', 'Check back after your next session', 'Mornings work best', 'our servers'];
  const offenders: string[] = [];
  for (const file of ['screens', 'components', 'ui', 'utils'].flatMap((dir) => shipped(path.join(ROOT, dir)))) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1').toLowerCase();
    for (const line of retired) if (code.includes(line.toLowerCase())) offenders.push(`${path.relative(ROOT, file)}: ${line}`);
  }
  expect(offenders).toEqual([]);
});
const mockNavigate = jest.fn(), mockBack = jest.fn(), mockReplace = jest.fn();
const mockNav = { navigate: mockNavigate, goBack: mockBack, replace: mockReplace, dispatch: jest.fn(), addListener: () => () => {}, getParent: () => ({ navigate: mockNavigate }) };
let mockParams: Record<string, unknown> = {};
let mockPayment: Record<string, unknown> = { ok: true, data: { state: 'active', purchase_id: 'purchase', package_id: 'package', package_name: 'Strength' } };
let mockDrops: Record<string, unknown> = { ok: true, data: [] };
let mockPairStatus = 'unavailable';
const mockStart = jest.fn(), mockRetry = jest.fn(), mockCancel = jest.fn();
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({
  colors: require('../constants/colors').default, tokens: require('../theme/tokens').default,
  semanticColors: require('../theme/tokens').lightTokens, colorScheme: 'light',
}) }));
jest.mock('../theme/useTheme', () => ({ useTheme: () => require('../theme/ThemeProvider').useTheme() }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', email: 'client@example.test' }) }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav, useRoute: () => ({ params: mockParams }), useFocusEffect: jest.fn(),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../analytics/posthog.service', () => ({ track: jest.fn() }));
jest.mock('../utils/haptics', () => ({ mediumTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn() }));
jest.mock('../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => false }));
jest.mock('../config/featureFlags', () => ({ featureFlags: { deliverables: false, privateCommunityHub: true } }));
jest.mock('../services/api', () => ({
  __esModule: true, default: { get: jest.fn(async () => ({ data: { id: 'coach', name: 'Coach Lee' } })) },
  aiApi: { getStructuredContext: jest.fn(async () => ({ data: { coach: null } })) },
  usersApi: { getFoundingNumber: jest.fn(async () => ({ data: null })) },
}));
jest.mock('../api/clientPaymentsApi', () => ({ clientPaymentsApi: {
  confirmCheckoutSession: jest.fn(async () => mockPayment), getPaymentStatus: jest.fn(async () => mockPayment),
  getPurchaseDrops: jest.fn(async () => mockDrops), getPurchases: jest.fn(async () => ({ ok: true, data: [] })),
  getPackages: jest.fn(async () => ({ ok: true, data: [] })),
} }));
jest.mock('../services/wave11Adapters', () => ({ fetchCommunityHub: jest.fn(async () => ({ rooms: [], recentPosts: [] })) }));
jest.mock('../hooks/useExtensionPairing', () => ({
  useExtensionPairing: () => ({ status: mockPairStatus, code: 'ABCD', start: mockStart, retry: mockRetry, cancel: mockCancel }),
  PAIRING_REASON_COPY: {},
}));
jest.mock('../api/packagesApi', () => ({ coachPackagesApi: {
  list: jest.fn(async () => { throw Object.assign(new Error('Packages unavailable'), { response: { status: 404, data: { code: 'PACKAGES_DISABLED' } } }); }),
  get: jest.fn(async () => ({ data: mockPackage })),
  update: jest.fn(async () => ({ data: mockPackage })),
  publish: jest.fn(async () => ({ data: mockPackage })),
  unpublish: jest.fn(async () => ({ data: mockPackage })),
  archive: jest.fn(async () => ({ data: mockPackage })),
} }));
const mockPackage: import('../api/packagesApi').CoachPackage = {
  id: 'package', coachUserId: 'client', title: 'Strength', description: 'Training', priceCents: 9900,
  currency: 'usd', billingInterval: 'monthly', intervalCount: 1, trialDays: null, features: [],
  status: 'active', shareToken: null, subscriberCount: 0, monthlyRevenueCents: 0,
  createdAt: '2026-10-01', updatedAt: '2026-10-01', archivedAt: null, publishedAt: null,
};
import PurchaseUnpackScreen from '../screens/client/PurchaseUnpackScreen';
import MembershipScreen from '../screens/client/MembershipScreen';
import CheckoutReturnScreen from '../screens/client/CheckoutReturnScreen';
import PrivateCommunityHubScreen from '../screens/client/PrivateCommunityHubScreen';
import CoachPackagesListScreen from '../screens/coach/payments/CoachPackagesListScreen';
import CoachPackageEditScreen from '../screens/coach/payments/CoachPackageEditScreen';
import ExtensionPairingPanel from '../components/coach/ExtensionPairingPanel';
beforeEach(() => {
  jest.clearAllMocks(); mockParams = { purchaseId: 'purchase' };
  mockPayment = { ok: true, data: { state: 'active', purchase_id: 'purchase', package_id: 'package', package_name: 'Strength' } };
  mockDrops = { ok: true, data: [] }; mockPairStatus = 'unavailable';
  jest.spyOn(require('react-native').AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());
it('shows a neutral purchase empty state and keeps Done and refresh', async () => {
  const s = await render(React.createElement(PurchaseUnpackScreen));
  await waitFor(() => expect(s.getByText('Nothing released yet.')).toBeTruthy());
  await waitFor(() => expect(s.getByText('Items appear here when Coach Lee releases them.')).toBeTruthy());
  expect(s.queryByText(/notification each time/)).toBeNull();
  await fireEvent.press(s.getByTestId('purchase-unpack-done')); expect(mockNavigate).toHaveBeenLastCalledWith('Home');
  await s.getByTestId('purchase-unpack-empty').props.refreshControl.props.onRefresh();
  expect(require('../api/clientPaymentsApi').clientPaymentsApi.getPurchaseDrops).toHaveBeenCalledTimes(2);
});
it.each(['not_configured', 'error'])('keeps purchase fallback Done and real Retry: %s', async (reason) => {
  mockDrops = { ok: false, reason, message: 'The included items did not load.' };
  const s = await render(React.createElement(PurchaseUnpackScreen));
  await waitFor(() => expect(s.getByTestId('purchase-unpack-done')).toBeTruthy());
  if (reason === 'error') await fireEvent.press(s.getByTestId('purchase-unpack-retry'));
  await fireEvent.press(s.getByTestId('purchase-unpack-done')); expect(mockNavigate).toHaveBeenLastCalledWith('Home');
});
it('keeps Membership Back, plans, messages and support without predicting coach activity', async () => {
  const s = await render(React.createElement(MembershipScreen));
  await waitFor(() => expect(s.getByText('Access starts when a coach invite is attached to this account.')).toBeTruthy());
  await fireEvent.press(s.getByLabelText('Back')); expect(mockBack).toHaveBeenCalled();
  await fireEvent.press(s.getByLabelText('View coaching plans')); expect(mockNavigate).toHaveBeenLastCalledWith('ClientPackages');
  await fireEvent.press(s.getByLabelText('Message your coach')); expect(mockNavigate).toHaveBeenLastCalledWith('Home', { screen: 'Messages' });
  expect(s.getByLabelText('Contact support').props.onPress).toEqual(expect.any(Function));
});
it('confirms only payment status, retaining the Home action', async () => {
  mockParams = { outcome: 'success', session_id: 'session' };
  const s = await render(React.createElement(CheckoutReturnScreen));
  await waitFor(() => expect(s.getByText('Welcome to Strength')).toBeTruthy());
  expect(s.queryByText(/coach has been notified|will be in touch/)).toBeNull();
  await fireEvent.press(s.getByText('Go to home')); expect(mockNavigate).toHaveBeenCalled();
});
it.each(['cancel', 'error', 'pending'])('keeps checkout recovery routes without invented payment facts: %s', async (state) => {
  mockParams = { outcome: state === 'cancel' ? 'cancel' : 'success', session_id: 'session' };
  if (state === 'error') mockPayment = { ok: false, reason: 'not_configured' };
  if (state === 'pending') mockPayment = { ok: true, data: { state: 'none', purchase_id: null } };
  const s = await render(React.createElement(CheckoutReturnScreen));
  await waitFor(() => expect(s.getByText(state === 'cancel' ? 'Back to plans' : 'Go to home')).toBeTruthy());
  expect(s.queryByText(/Backend not configured|coach has been notified|will be in touch|within a few minutes/)).toBeNull();
  await fireEvent.press(s.getByText(state === 'cancel' ? 'Back to plans' : 'Go to home'));
  expect(mockNavigate).toHaveBeenLastCalledWith(state === 'cancel' ? 'MoreTab' : 'Home', ...(state === 'cancel' ? [{ screen: 'ClientPackages' }] : []));
});
it('keeps private rooms/posts and refresh, removing only a false voice-note placeholder', async () => {
  const s = await render(React.createElement(PrivateCommunityHubScreen));
  await waitFor(() => expect(s.getByText('Private rooms appear here after an invitation. No one is added without one.')).toBeTruthy());
  expect(s.getByText('Recent posts')).toBeTruthy(); expect(s.queryByText(/coming soon/i)).toBeNull();
  expect(s.getByLabelText('Pull to refresh community').props.onRefresh).toEqual(expect.any(Function));
});
it('labels unavailable packages honestly and retains Back and refresh', async () => {
  const s = await render(React.createElement(CoachPackagesListScreen, { navigation: jest.requireMock('@react-navigation/native').useNavigation() }));
  await waitFor(() => expect(s.getByText('Packages are not available in this version.')).toBeTruthy());
  await fireEvent.press(s.getByLabelText('Go back')); expect(mockBack).toHaveBeenCalled();
  expect(s.getByTestId('coach-packages-list').props.refreshControl.props.onRefresh).toEqual(expect.any(Function));
});
it('keeps real package editing, preview and navigation, not a dead share row', async () => {
  const s = await render(React.createElement(CoachPackageEditScreen, {
    navigation: mockNav, route: { key: 'edit', name: 'CoachPackageEdit', params: { packageId: 'package', initialPackage: mockPackage } },
  } as React.ComponentProps<typeof CoachPackageEditScreen>));
  await waitFor(() => expect(s.getByLabelText('Save changes')).toBeTruthy());
  expect(s.queryByText(/Share links are coming soon/i)).toBeNull();
  await fireEvent.press(s.getByLabelText('Preview as buyer')); await fireEvent.press(s.getByLabelText('Close preview'));
  for (const label of ['Manage content', 'View subscribers']) {
    await fireEvent.press(s.getByLabelText(label)); expect(mockNavigate).toHaveBeenCalled();
  }
  await fireEvent.press(s.getByLabelText('Make Strength live'));
  await waitFor(() => expect(require('../api/packagesApi').coachPackagesApi.publish).toHaveBeenCalled());
  await fireEvent.press(s.getByLabelText('Save changes'));
  await waitFor(() => expect(require('../api/packagesApi').coachPackagesApi.update).toHaveBeenCalled());
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await fireEvent.press(s.getByLabelText('Archive package')); expect(alert).toHaveBeenCalled();
  await fireEvent.press(s.getByLabelText('Go back')); expect(mockBack).toHaveBeenCalled();
});
it('retains real package sharing and the create/open-package routes', async () => {
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const s = await render(React.createElement(CoachPackageEditScreen, {
    navigation: mockNav, route: { key: 'share', name: 'CoachPackageEdit', params: { packageId: 'package', initialPackage: { ...mockPackage, shareToken: 'real-token' } } },
  } as React.ComponentProps<typeof CoachPackageEditScreen>));
  await fireEvent.press(s.getByLabelText('Share package link')); expect(Share.share).toHaveBeenCalled();
  require('../api/packagesApi').coachPackagesApi.list.mockResolvedValueOnce({ data: [mockPackage] });
  const list = await render(React.createElement(CoachPackagesListScreen, { navigation: jest.requireMock('@react-navigation/native').useNavigation() }));
  await waitFor(() => expect(list.getByLabelText('Edit Strength')).toBeTruthy());
  await fireEvent.press(list.getByLabelText('Create package')); expect(mockNavigate).toHaveBeenLastCalledWith('CoachPackageEdit', { packageId: null });
  await fireEvent.press(list.getByLabelText('Edit Strength')); expect(mockNavigate).toHaveBeenLastCalledWith('CoachPackageEdit', { packageId: 'package', initialPackage: mockPackage });
});
it('does not promise import enablement and keeps pairing Copy/Cancel/Review/Retry', async () => {
  const s = await render(React.createElement(ExtensionPairingPanel, { platformId: 'everfit' }));
  expect(s.getByText('Data import is not enabled on this account.')).toBeTruthy();
  mockPairStatus = 'waiting'; await s.rerender(React.createElement(ExtensionPairingPanel, { platformId: 'everfit' }));
  await fireEvent.press(s.getByTestId('pairing-copy')); await fireEvent.press(s.getByTestId('pairing-cancel'));
  expect(mockCancel).toHaveBeenCalled();
  mockPairStatus = 'paired'; await s.rerender(React.createElement(ExtensionPairingPanel, { platformId: 'everfit' }));
  await fireEvent.press(s.getByTestId('pairing-review-cta')); expect(mockNavigate).toHaveBeenLastCalledWith('ClientsStack', { screen: 'ClientsList' });
  mockPairStatus = 'failed'; await s.rerender(React.createElement(ExtensionPairingPanel, { platformId: 'everfit' }));
  await fireEvent.press(s.getByTestId('pairing-retry')); expect(mockRetry).toHaveBeenCalled();
});
