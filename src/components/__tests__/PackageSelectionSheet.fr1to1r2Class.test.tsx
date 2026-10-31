/**
 * FR-1TO1R2 (agent 185) class-first test. Class: every buyer surface that can start a purchase
 * names the coach's 1:1 coaching first and does not sell while that coach is unnamed
 * (ClientPackagesScreen's rule, LS-1TO1 B1). The plan sheet is one component mounted by five
 * surfaces; each mount's props x both platforms x every coach-name read outcome is a row.
 * The other purchase starters (usePackagePurchase callers) are listed with the rule they meet.
 */
import React from 'react';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ tokens: t.default, semanticColors: t.lightTokens, colorScheme: 'light' }) };
});
jest.mock('../../storage/mmkv', () => ({
  prefsStorage: { getStringAsync: jest.fn(async () => null), set: jest.fn(async () => undefined) },
}));
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'synthetic-client', role: 'student' }) }));
jest.mock('../../lib/planRenewal', () => ({
  ...jest.requireActual('../../lib/planRenewal'),
  markShownOnce: jest.fn(async () => undefined),
}));
const PACKAGES = [
  { id: 'p-1', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd', billing_type: 'recurring', interval: 'month' },
];
let mockCoach: () => Promise<unknown> = async () => ({ data: { name: 'Avery Stone' } });
const mockGet = jest.fn(async (url: string) => {
  if (url === '/v1/clients/me/coach') return mockCoach();
  if (url.startsWith('/v1/clients/me/coach/packages')) return { data: { packages: PACKAGES } };
  throw new Error(`unexpected read ${url}`);
});
jest.mock('../../services/api', () => ({ __esModule: true, default: { get: (url: string) => mockGet(url) } }));
const mockStart = jest.fn();
jest.mock('../../hooks/usePackagePurchase', () => ({
  usePackagePurchase: () => ({ busy: false, state: { phase: 'idle' }, clearNotice: jest.fn(), start: mockStart }),
}));

const Sheet: typeof import('../PackageSelectionSheet').default = require('../PackageSelectionSheet').default;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
afterEach(() => setOS(realOS));

type Mount = { recordShown?: boolean; skipSnoozeCheck?: boolean; initialPackageId?: string; house?: { id: string; name: string } };
const MOUNTS: Array<[string, Mount]> = [
  ['RootNavigator package_prompt', { recordShown: true }],
  ['Day1WinScreen', { recordShown: true }],
  ['RenewalHome', { skipSnoozeCheck: true }],
  ['CoachlessHomeSlot', { initialPackageId: 'p-1' }],
  ['HousePackageScreen', { skipSnoozeCheck: true, house: { id: 'house-1', name: 'Bradley Gleave' }, initialPackageId: 'p-1' }],
];
const READS: Array<[string, () => Promise<unknown>, string | null]> = [
  ['named', async () => ({ data: { name: 'Avery Stone' } }), 'Avery Stone'],
  ['read fails', async () => { throw new Error('network'); }, null],
  ['blank name', async () => ({ data: { name: '  ' } }), null],
];
const ROWS = MOUNTS.flatMap(([surface, props]) =>
  ['ios', 'android'].flatMap((os) => READS.map(([read, coach, name]) => [surface, os, read, props, coach, name] as const)));

it.each(ROWS)('%s on %s, coach name %s', async (_s, os, _r, props, coach, name) => {
  setOS(os);
  mockCoach = coach;
  mockStart.mockClear();
  const r = await render(<Sheet visible onDismiss={jest.fn()} onPaymentSuccess={jest.fn()} {...props} />);
  await waitFor(() => expect(r.getByTestId('package-sheet-one-to-one')).toBeTruthy());
  const shown = props.house?.name ?? name;
  expect(r.getByTestId('package-sheet-one-to-one').props.children).toBe(`1:1 coaching with ${shown ?? 'your coach'}`);
  await fireEvent.press(r.getByTestId('package-card-p-1'));
  expect(r.getByTestId('select-plan-btn').props.accessibilityState.disabled).toBe(!shown);
  expect(!!r.queryByTestId('package-sheet-coach-retry')).toBe(!shown);
  await fireEvent.press(r.getByTestId('select-plan-btn'));
  expect(mockStart).toHaveBeenCalledTimes(shown ? 1 : 0);
});

// Every other purchase starter, and how it meets the rule (the server names the coach or refuses).
const SRC = join(__dirname, '..', '..');
const STARTERS: Array<[string, RegExp, string]> = [
  ['components/PackageSelectionSheet.tsx', /const ctaDisabled = [^;]*!coachName;/, 'rows above'],
  ['screens/client/ClientPackagesScreen.tsx', /const blocked = [^;]*!coachName;/, 'Buy not enabled until the coach is named'],
  ['screens/client/PackageCheckoutScreen.tsx', /oneToOneCoachingLabel\(pkg\?\.coach\?\.displayName\)/, 'the storefront read names the coach or refuses (b#1183)'],
  ['screens/join/JoinPackageScreen.tsx', /oneToOneCoachingLabel\(join\.coach\.first_name\)/, 'the join names the coach or refuses (b#1183 planJoin)'],
];
it.each(STARTERS)('%s meets the rule (%s)', (file, rule) => {
  expect(readFileSync(join(SRC, file), 'utf8')).toMatch(rule);
});
it('lists every purchase starter', () => {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); } else if (/\.tsx?$/.test(e.name) && /usePackagePurchase\(/.test(readFileSync(p, 'utf8')) && !p.endsWith('hooks/usePackagePurchase.ts')) hits.push(p.slice(SRC.length + 1));
    }
  };
  walk(SRC);
  expect(hits.sort()).toEqual(STARTERS.map(([f]) => f).sort());
});
