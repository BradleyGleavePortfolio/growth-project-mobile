/**
 * Fix round #304 (Sol B1): the Day-1 unsolicited package prompt is offered
 * only after an explicit inactive entitlement, and (#161-5 op 1) only to a
 * coached client, on iPhone too. Caller-level: the real Day1WinScreen and the
 * real packagePromptGate; only the network and cache edges are mocked. Comp
 * (active), coachless and every unknown/error lookup must skip the sheet.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), replace: jest.fn() }),
}));
jest.mock('../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../theme/tokens').default;
  return {
    useTheme: () => ({
      colors: new Proxy({}, { get: () => '#2C4A36' }),
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      colorScheme: 'light',
    }),
  };
});
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true }));
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: {
    getStatus: jest.fn().mockResolvedValue({ data: { completed: false, completedAt: null } }),
    complete: jest.fn(),
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-1', role: 'student' }),
}));
// The coach has packages, so only the entitlement gate decides.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: [{ id: 'pkg-1' }] })) },
}));
const mockGetEntitlement = jest.fn();
jest.mock('../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
const mockDunning = jest.fn();
jest.mock('../entitlements/dunning/dunningApi', () => ({ dunningApi: { getStatus: () => mockDunning() } }));
jest.mock('../components/PackageSelectionSheet', () => {
  const R = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return ({ visible, recordShown, onShown }: { visible: boolean; recordShown?: boolean; onShown?: () => void }) =>
    visible ? R.createElement(Text, { testID: 'package-sheet', recordShown, onShown }, 'sheet') : null;
});
let mockCoachId: string | undefined = 'coach-1';
jest.mock('../lib/userCache', () => ({
  ...jest.requireActual('../lib/userCache'),
  readUserCache: async () => ({ id: 'client-1', role: 'student', coach_id: mockCoachId }),
}));

import { Platform } from 'react-native';
import Day1WinScreen from '../screens/client/Day1WinScreen';

async function skipAndSettle(entitlement: () => Promise<unknown>) {
  mockGetEntitlement.mockImplementation(entitlement);
  const onComplete = jest.fn();
  const r = await render(<Day1WinScreen onComplete={onComplete} />);
  await fireEvent.press(r.getByTestId('day1win-skip-button'));
  return { ...r, onComplete };
}

describe('Day1WinScreen package prompt is fail closed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCoachId = 'coach-1';
    mockDunning.mockResolvedValue({ enabled: true, state: 'none' });
  });
  afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' }));

  it('comp (active) client: no sheet, straight into the app', async () => {
    const r = await skipAndSettle(async () => ({ ok: true, data: { active: true, entitlement_active: true } }));
    await waitFor(() => expect(r.onComplete).toHaveBeenCalledTimes(1));
    expect(r.queryByTestId('package-sheet')).toBeNull();
  });

  it.each([
    ['ok:false', async () => ({ ok: false, reason: 'error', message: 'timeout' })],
    ['empty data', async () => ({ ok: true, data: {} })],
    ['rejected lookup', async () => { throw new Error('network'); }],
  ])('failed entitlement lookup (%s): no sheet, straight into the app', async (_l, impl) => {
    const r = await skipAndSettle(impl as () => Promise<unknown>);
    await waitFor(() => expect(r.onComplete).toHaveBeenCalledTimes(1));
    expect(r.queryByTestId('package-sheet')).toBeNull();
  });

  it('explicitly inactive client with packages: the sheet is offered', async () => {
    const r = await skipAndSettle(async () => ({ ok: true, data: { active: false, entitlement_active: false } }));
    await waitFor(() => expect(r.getByTestId('package-sheet')).toBeTruthy());
    expect(r.onComplete).not.toHaveBeenCalled();
  });

  it('iPhone, coached, no plan: the 1:1 sheet is offered (#161-5 op 1) and saves its 24 h time on open (#836 B1)', async () => {
    expect(Platform.OS).toBe('ios');
    const r = await skipAndSettle(async () => ({ ok: true, data: { active: false, entitlement_active: false } }));
    await waitFor(() => expect(r.getByTestId('package-sheet')).toBeTruthy());
    expect(r.getByTestId('package-sheet').props.recordShown).toBe(true);
    expect(r.onComplete).not.toHaveBeenCalled();
    // RENEWAL-M: this is the iPhone's one first offer, so a later start does not offer it again.
    await act(async () => r.getByTestId('package-sheet').props.onShown());
    await waitFor(async () => expect(await AsyncStorage.getItem('prefs:plan_renewal.shown_once:client-1')).not.toBeNull());
  });

  it('Android: the sheet keeps its skip-only 24 h time', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    const r = await skipAndSettle(async () => ({ ok: true, data: { active: false, entitlement_active: false } }));
    await waitFor(() => expect(r.getByTestId('package-sheet')).toBeTruthy());
    expect(r.getByTestId('package-sheet').props.recordShown).toBe(false);
    expect(r.getByTestId('package-sheet').props.onShown).toBeUndefined();
  });

  it('payment failing (dunning past_due): no sheet, straight into the app (#836 C1)', async () => {
    mockDunning.mockResolvedValue({ enabled: true, state: 'past_due', kind: 'payment', reason: 'payment_failed', purchase_id: 'pur-1' });
    const r = await skipAndSettle(async () => ({ ok: true, data: { active: false, entitlement_active: false } }));
    await waitFor(() => expect(r.onComplete).toHaveBeenCalledTimes(1));
    expect(r.queryByTestId('package-sheet')).toBeNull();
  });

  it('coachless: no sheet and no entitlement lookup', async () => {
    mockCoachId = undefined;
    const r = await skipAndSettle(async () => ({ ok: true, data: { active: false, entitlement_active: false } }));
    await waitFor(() => expect(r.onComplete).toHaveBeenCalledTimes(1));
    expect(r.queryByTestId('package-sheet')).toBeNull();
    expect(mockGetEntitlement).not.toHaveBeenCalled();
  });
});
