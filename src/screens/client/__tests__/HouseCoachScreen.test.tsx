/** RENEWAL-M H1-H3 (RENEWAL3): the house coach's packages; a package opens #836's sheet under his name; paid → his. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockRefresh = jest.fn(async () => undefined);
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: mockRefresh }) }));
const mockPatch = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../lib/userCache', () => ({ patchUserCache: (...a: unknown[]) => mockPatch(...a) }));
let mockRead: () => Promise<unknown>;
const mockGet = jest.fn((..._a: unknown[]) => mockRead());
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));
jest.mock('../../../components/PackageSelectionSheet', () => (p: { house?: { id: string; name: string }; initialPackageId?: string; skipSnoozeCheck?: boolean; onPaymentSuccess: () => void }) =>
  jest.requireActual('react').createElement(jest.requireActual('react-native').Pressable,
    { testID: 'package-sheet', accessibilityLabel: `${p.house?.id}|${p.house?.name}|${p.initialPackageId}|${p.skipSnoozeCheck}`, onPress: p.onPaymentSuccess }));

const Screen: typeof import('../HouseCoachScreen').default = require('../HouseCoachScreen').default;
const ROWS = [{ id: 'h-1', name: '12-week strength block', price_cents: 29900, currency: 'usd', billing_type: 'one_time' },
  { id: 'h-2', name: 'Monthly coaching', amount_cents: 14900, currency: 'usd', billing_type: 'recurring', interval: 'month' }];
const nav = { goBack: jest.fn(), popToTop: jest.fn() };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = () => render(<Screen route={{ key: 'h', name: 'HouseCoach', params: { coach: { id: 'house-1', firstName: 'Bradley' } } } as any} navigation={nav as any} />);

beforeEach(() => { jest.clearAllMocks(); mockRead = async () => ({ data: { packages: ROWS } }); });

it('H1-H3: his name and packages; a package opens the sheet under his name; paid → coach saved, plan re-read, Home', async () => {
  const s = mount();
  fireEvent.press(await s.findByTestId('house-package-h-2'));
  expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach/packages?coach_id=house-1');
  expect(s.getByText("TGP's Top Rated Coach")).toBeTruthy();
  expect(s.getByText('1:1 coaching with Bradley')).toBeTruthy();
  expect(s.getByTestId('house-package-h-1')).toBeTruthy();
  expect(s.getByTestId('package-sheet').props.accessibilityLabel).toBe('house-1|Bradley|h-2|true');
  fireEvent.press(s.getByTestId('package-sheet'));
  expect(mockPatch).toHaveBeenCalledWith({ coach_id: 'house-1' });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(nav.popToTop).toHaveBeenCalledTimes(1);
  expect(s.queryByTestId('package-sheet')).toBeNull();
  fireEvent.press(s.getByTestId('house-coach-back'));
  expect(nav.goBack).toHaveBeenCalledTimes(1);
});

it.each([
  ['the read fails', async () => { throw new Error('offline'); }],
  ['no package can be sold (a free one is not)', async () => ({ data: { packages: [{ id: 'f', name: 'Free' }] } })],
])('%s: a quiet error with Try again, then the list', async (_l, read) => {
  mockRead = read;
  const s = mount();
  await s.findByTestId('house-coach-error');
  expect(s.getByText('Bradley')).toBeTruthy();
  mockRead = async () => ({ data: ROWS });
  fireEvent.press(s.getByTestId('house-coach-error-retry'));
  await s.findByTestId('house-package-h-1');
});
