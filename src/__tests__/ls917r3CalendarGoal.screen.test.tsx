/** Real Calendar view, not a source-text existence test. */
import React from 'react';
import { render } from '@testing-library/react-native';
import { CalendarWeekPage, type CalendarWeekData } from '../screens/client/calendar/CalendarWeekScreen';
jest.mock('../hooks/useApi', () => ({}));
jest.mock('../hooks/useCalendar', () => ({}));
jest.mock('../hooks/useWorkoutBuilder', () => ({}));
jest.mock('../services/api', () => ({}));
jest.mock('../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (component: unknown) => component }));
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
jest.mock('../hooks/useNetworkStatus', () => ({}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), error: jest.fn(), softImpact: jest.fn() },
}));
jest.mock('../ui/states/QuietStates', () => ({ QuietLoading: () => null }));
jest.mock('../ui', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PrimaryButton: () => null, TextLink: () => null,
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../theme/tokens').lightTokens,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn(),
}));

it('LS-917R3 B3: picked C4 calendar offers the Month view, not a dead Week label', async () => {
  const data: CalendarWeekData = {
    coaches: [], sessions: [], workouts: [], checkIns: [], logs: [],
    loading: false, failed: false, refreshing: false, offline: false, hasData: true,
  };
  const view = await render(<CalendarWeekPage data={data}
    onRefresh={jest.fn()} onSession={jest.fn()} onBook={jest.fn()} />);
  expect(view.getByText('Week')).toBeTruthy();
  // C4 C2_week's Week/Month navigation is absent, not merely a different shade.
  expect(view.getByText('Month')).toBeTruthy();
});
