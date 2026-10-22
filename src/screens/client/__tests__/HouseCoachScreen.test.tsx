/** RENEWAL-M H1 (RENEWAL3), after SWITCH-CONFIRM-M's confirm page: the house coach's packages; a package opens its page. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockRead: () => Promise<unknown>;
const mockGet = jest.fn((..._a: unknown[]) => mockRead());
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) } }));

const Screen: typeof import('../HouseCoachScreen').default = require('../HouseCoachScreen').default;
const ROWS = [{ id: 'h-1', name: '12-week strength block', price_cents: 29900, currency: 'usd', billing_type: 'one_time' },
  { id: 'h-2', name: 'Monthly coaching', amount_cents: 14900, currency: 'usd', billing_type: 'recurring', interval: 'month' }];
const nav = { goBack: jest.fn(), navigate: jest.fn() };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = () => render(<Screen route={{ key: 'h', name: 'HouseCoach', params: { coach: { id: 'house-1', firstName: 'Bradley' } } } as any} navigation={nav as any} />);

beforeEach(() => { jest.clearAllMocks(); mockRead = async () => ({ data: { packages: ROWS } }); });

it('H1: his name and packages; a package opens its own page (no sheet, no checkout here); Back goes back', async () => {
  const s = await mount();
  await fireEvent.press(await s.findByTestId('house-package-h-2'));
  expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach/packages?coach_id=house-1');
  expect(s.getByText("TGP's Top Rated Coach")).toBeTruthy();
  expect(s.getByText('1:1 coaching with Bradley')).toBeTruthy();
  expect(s.getByTestId('house-package-h-1')).toBeTruthy();
  expect(nav.navigate).toHaveBeenCalledWith('HousePackage', { coach: { id: 'house-1', firstName: 'Bradley' }, pkg: expect.objectContaining({ id: 'h-2', description: null, weeks: null }) });
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.press(s.getByTestId('house-coach-back'));
  expect(nav.goBack).toHaveBeenCalledTimes(1);
});

it('no free trial from the house (#166-6): a trial row is not listed', async () => {
  mockRead = async () => ({ data: [...ROWS, { id: 'h-t', name: 'Try it', amount_cents: 9900, currency: 'usd', billing_type: 'recurring', interval: 'month', trial_days: 7 }] });
  const s = await mount();
  await s.findByTestId('house-package-h-1');
  expect(s.queryByTestId('house-package-h-t')).toBeNull();
  expect(s.queryByText(/trial/i)).toBeNull();
});

it.each([
  ['the read fails', async () => { throw new Error('offline'); }],
  ['no package can be sold (a free one is not)', async () => ({ data: { packages: [{ id: 'f', name: 'Free' }] } })],
])('%s: a quiet error with Try again, then the list', async (_l, read) => {
  mockRead = read;
  const s = await mount();
  await s.findByTestId('house-coach-error');
  expect(s.getByText('Bradley')).toBeTruthy();
  mockRead = async () => ({ data: ROWS });
  await fireEvent.press(s.getByTestId('house-coach-error-retry'));
  await s.findByTestId('house-package-h-1');
});
