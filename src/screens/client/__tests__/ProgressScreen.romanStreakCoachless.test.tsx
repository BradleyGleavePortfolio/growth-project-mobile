/**
 * STREAK-PROGRESS (agent 167): the §2.7 Roman streak card on Progress carries
 * the same coachless lock as every other Roman surface (useClientNeedsCoach,
 * m#651). Owner, verbatim: "coachless clients have no access to roman at all".
 * A three-day weigh-in run puts the client on the tier-3 milestone day.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { bucketDateLocal } from '../../../utils/date';

const DAY = 86400000;
function day(daysAgo: number): string {
  return `${bucketDateLocal(new Date(Date.now() - daysAgo * DAY))}T00:00:00.000Z`;
}
const mockLogs = [
  { id: 'a', date: day(2), weight_lbs: 185 },
  { id: 'b', date: day(1), weight_lbs: 184 },
  { id: 'c', date: day(0), weight_lbs: 183 },
];
const mockGetHistory = jest.fn(async () => ({ data: { logs: mockLogs, height_cm: null } }));
jest.mock('../../../services/api', () => ({
  weightApi: { getHistory: () => mockGetHistory(), log: jest.fn(async () => ({})) },
  logApi: { getDaily: jest.fn(async () => ({ data: {} })) },
}));
const COACHED = { id: 'client-p', role: 'student', coach_id: 'coach-p', firstName: 'Ava' };
let mockUser: Record<string, unknown> = COACHED;
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../theme/ThemeProvider', () => {
  const tokens = require('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({ NavigationContext: require('react').createContext(undefined), useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../config/featureFlags', () => ({
  __esModule: true,
  featureFlags: { romanFirstPaymentBodyweightPolish: false, romanChat: true, romanStreakBackendLive: true },
}));

import ProgressScreen from '../ProgressScreen';
import { featureFlags } from '../../../config/featureFlags';

const mockFlags = featureFlags as unknown as { romanChat: boolean; romanStreakBackendLive: boolean };

beforeEach(() => {
  mockGetHistory.mockClear();
  mockUser = COACHED;
  mockFlags.romanChat = true;
  mockFlags.romanStreakBackendLive = true;
});

async function renderLoaded() {
  const screen = await render(<ProgressScreen />);
  await waitFor(() => expect(mockGetHistory).toHaveBeenCalled());
  // The run hero shows once the three-day streak is counted.
  await screen.findByText('3 days in a row with a weigh-in');
  return screen;
}

describe('Roman streak card on Progress — coachless lock', () => {
  it('coached client, both flags on: the card shows', async () => {
    const { findByTestId } = await renderLoaded();
    expect(await findByTestId('roman-streak-card')).toBeTruthy();
  });

  it('coachless client, both flags on: no card', async () => {
    mockUser = { ...COACHED, coach_id: null };
    const { queryByTestId } = await renderLoaded();
    expect(queryByTestId('roman-streak-card')).toBeNull();
  });

  it.each([
    ['romanChat', { romanChat: false, romanStreakBackendLive: true }],
    ['romanStreakBackendLive', { romanChat: true, romanStreakBackendLive: false }],
  ])('coached client, %s off: no card', async (_name, flags) => {
    Object.assign(mockFlags, flags);
    const { queryByTestId } = await renderLoaded();
    expect(queryByTestId('roman-streak-card')).toBeNull();
  });
});
