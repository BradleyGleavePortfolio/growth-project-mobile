/** RENEWAL-M H1 (RENEWAL3), after SWITCH-CONFIRM-M's confirm page: his full name, what joining includes, his packages; a package opens its page. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockRefresh = jest.fn(async () => undefined);
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: mockRefresh }) }));
let mockRead: () => Promise<unknown>;
const mockGet = jest.fn((..._a: unknown[]) => mockRead());
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) } }));

const Screen: typeof import('../HouseCoachScreen').default = require('../HouseCoachScreen').default;
const ROWS = [{ id: 'h-1', name: '12-week strength block', price_cents: 29900, currency: 'usd', billing_type: 'one_time' },
  { id: 'h-2', name: 'Monthly coaching', amount_cents: 14900, currency: 'usd', billing_type: 'recurring', interval: 'month' }];
const nav = { goBack: jest.fn(), navigate: jest.fn() };
const HOUSE = { id: 'house-1', firstName: 'Bradley', fullName: 'Bradley Gleave' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = (coach: { id: string; firstName: string; fullName?: string } = HOUSE) => render(<Screen route={{ key: 'h', name: 'HouseCoach', params: { coach } } as any} navigation={nav as any} />);

/** Every string the screen draws, top to bottom. */
const textsOf = (n: unknown): string[] =>
  !n ? [] : typeof n === 'string' ? [n] : Array.isArray(n) ? n.flatMap(textsOf) : textsOf((n as { children?: unknown }).children);

beforeEach(() => { jest.clearAllMocks(); mockRead = async () => ({ data: { packages: ROWS } }); });

it('H1 (W-168-HC): his full name and monogram, then Includes (HC-2 to HC-7), then his packages, in that order', async () => {
  const s = await mount();
  await s.findByTestId('house-package-h-1');
  const texts = textsOf(s.toJSON());
  const order = ['BG', "TGP's Top Rated Coach", 'Bradley Gleave', 'Includes', 'Personalized workout plans', '1:1 check-ins',
    'Direct access to Bradley', 'Customized meal plans', 'Advanced AI usage', '1:1 coaching with Bradley Gleave', '12-week strength block', 'Monthly coaching'];
  expect(order.map((t) => texts.indexOf(t))).toEqual(order.map((t) => texts.indexOf(t)).sort((a, b) => a - b));
  expect(order.every((t) => texts.includes(t))).toBe(true);
  expect(s.getByText('Includes').props.accessibilityRole).toBe('header');
});

it('a server without full_name (before backend #1142): the first name and monogram, as before', async () => {
  const s = await mount({ id: 'house-1', firstName: 'Bradley' });
  await s.findByTestId('house-package-h-1');
  expect(s.getByText('B', { includeHiddenElements: true })).toBeTruthy(); // the monogram is hidden from screen readers
  for (const t of ['Bradley', '1:1 coaching with Bradley', 'Direct access to Bradley']) expect(s.getByText(t)).toBeTruthy();
});

it('H1: a package opens its own page (no sheet, no checkout here); Back goes back', async () => {
  const s = await mount();
  await fireEvent.press(await s.findByTestId('house-package-h-2'));
  expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach/packages?coach_id=house-1');
  expect(s.getByTestId('house-package-h-1')).toBeTruthy();
  expect(nav.navigate).toHaveBeenCalledWith('HousePackage', { coach: HOUSE, pkg: expect.objectContaining({ id: 'h-2', description: null, weeks: null }) });
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

it('C1: the server closed the house offer (404): the quiet error, and the plan is re-read so Home drops the choice', async () => {
  mockRead = async () => { throw Object.assign(new Error('Not found'), { response: { status: 404 } }); };
  const s = await mount();
  await s.findByTestId('house-coach-error');
  expect(s.getByText('Packages could not load. Try again in a moment.')).toBeTruthy();
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it.each([
  ['the read fails', async () => { throw new Error('offline'); }],
  ['no package can be sold (a free one is not)', async () => ({ data: { packages: [{ id: 'f', name: 'Free' }] } })],
])('%s: a quiet error with Try again, then the list', async (_l, read) => {
  mockRead = read;
  const s = await mount();
  await s.findByTestId('house-coach-error');
  expect(s.getByText('Bradley Gleave')).toBeTruthy();
  expect(s.getByTestId('house-coach-includes')).toBeTruthy();
  mockRead = async () => ({ data: ROWS });
  await fireEvent.press(s.getByTestId('house-coach-error-retry'));
  await s.findByTestId('house-package-h-1');
});
