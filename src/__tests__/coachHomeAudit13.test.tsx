/**
 * AUDIT-13-125 — Coach Home (Overview tab).
 *
 * U-A13-1: the Overview tab mounts CommandCenterScreen with no props, so
 * tapping a client on At-Risk / Streaks / Actions or a thread on Inbox did
 * nothing. Rows now open the client page / the message thread.
 * U-A13-2: commandCenterApi swallowed every failure and returned zeros, so a
 * failed load read "0 clients", a red 0% and "No at-risk clients". Errors now
 * reach the screens' specific error + Retry state.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-native-safe-area-context', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const insets = { top: 47, bottom: 0, left: 0, right: 0 };
  return { useSafeAreaInsets: () => insets, SafeAreaInsetsContext: R.createContext(insets) };
});
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn() },
}));
jest.mock('../components/command-center/CoachLtvDashboard', () => () => null);
jest.mock('../screens/coach/command-center/CoachHomeCards', () => () => null);

import { commandCenterApi } from '../services/commandCenterApi';
import CommandCenterScreen from '../screens/coach/command-center/CommandCenterScreen';

beforeEach(() => {
  mockNavigate.mockClear();
  mockGet.mockReset();
});

describe('U-A13-2: no fake zeros when a Coach Home read fails', () => {
  it.each([
    ['getOverview'],
    ['getAtRisk'],
    ['getWinStreaks'],
    ['getInbox'],
    ['getActionQueue'],
  ] as const)('%s rejects instead of returning zeros', async (fn) => {
    mockGet.mockRejectedValue(new Error('Network Error'));
    await expect(commandCenterApi[fn]()).rejects.toThrow('Network Error');
  });
});

describe('U-A13-1: Coach Home rows open the right place', () => {
  it('an at-risk client opens that client page in the Clients tab', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.endsWith('/at-risk')) {
        return {
          data: {
            items: [
              {
                user_id: 'c-1',
                display_name: 'Ana Lopez',
                bucket: 'red',
                risk_score: null,
                last_active_at: null,
                top_factor: 'Missed check-ins',
                days_since_checkin: 4,
              },
            ],
            total_at_risk: 1,
          },
        };
      }
      return { data: { roster_size: 1, active_today: 0, check_in_rate_7day: 0, open_alerts: 0, at_risk_count: 1, win_streak_count: 0, unread_messages: 0, pending_actions: 0 } };
    });
    const screen = await render(<CommandCenterScreen />);
    await fireEvent.press(screen.getByTestId('command-center-tab-at-risk'));
    await fireEvent.press(await screen.findByTestId('command-center-at-risk-row'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', {
      screen: 'ClientDetail',
      params: { clientId: 'c-1', clientName: 'Ana Lopez' },
      initial: false,
    });
  });

  it('the tab row sits below the status bar (the shared Screen owns the top inset)', () => {
    const src = jest.requireActual<typeof import('fs')>('fs').readFileSync(
      require.resolve('../screens/coach/command-center/CommandCenterScreen.tsx'),
      'utf8',
    );
    expect(src).toMatch(/<Screen edges=\{\['top'\]\}/);
  });
});
