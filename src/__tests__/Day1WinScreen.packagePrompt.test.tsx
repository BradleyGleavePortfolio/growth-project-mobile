/**
 * Fix round #304 (Sol B1): the Day-1 unsolicited package prompt is offered
 * only after an explicit inactive entitlement. Caller-level: the real
 * Day1WinScreen and the real packagePromptGate; only the network edges are
 * mocked. Comp (active) and every unknown/error lookup must skip the sheet.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

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
jest.mock('../components/PackageSelectionSheet', () => {
  const R = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return ({ visible }: { visible: boolean }) =>
    visible ? R.createElement(Text, { testID: 'package-sheet' }, 'sheet') : null;
});

import Day1WinScreen from '../screens/client/Day1WinScreen';

async function skipAndSettle(entitlement: () => Promise<unknown>) {
  mockGetEntitlement.mockImplementation(entitlement);
  const onComplete = jest.fn();
  const r = await render(<Day1WinScreen onComplete={onComplete} />);
  await fireEvent.press(r.getByTestId('day1win-skip-button'));
  return { ...r, onComplete };
}

describe('Day1WinScreen package prompt is fail closed', () => {
  beforeEach(() => jest.clearAllMocks());

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
});
