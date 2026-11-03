/** Independent native-source/RNTL touch contract, not a painted-ring-size test. */
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { CalendarWeekPage, type CalendarWeekData } from '../screens/client/calendar/CalendarWeekScreen';

// The same module object used by CalendarWeekPage, not a copied namespace.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native') as typeof import('react-native');

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

const data: CalendarWeekData = {
  coaches: [], sessions: [], workouts: [], checkIns: [], logs: [],
  loading: false, failed: false, refreshing: false, offline: false, hasData: true,
};

async function month(width: number, fontScale: number) {
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({
    width, height: 800, scale: 1, fontScale,
  });
  const view = await render(<CalendarWeekPage data={data} initialMonth="2026-10-01"
    onRefresh={jest.fn()} onSession={jest.fn()} onBook={jest.fn()} />);
  const page = StyleSheet.flatten(view.getByTestId('week-page').props.style as StyleProp<ViewStyle>);
  const horizontal = Number(page.paddingHorizontal ?? page.padding ?? 0);
  const contentWidth = width - horizontal * 2;
  const cells = view.getAllByTestId(/^month-day-/).map((cell) => {
    const style = StyleSheet.flatten(cell.props.style as StyleProp<ViewStyle>);
    return {
      cell, style,
      width: typeof style.width === 'number'
        ? style.width : contentWidth * parseFloat(String(style.width)) / 100,
    };
  });
  expect(cells).toHaveLength(35);
  return { view, cells };
}

afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it.each([1, 1.3])('LS-917R5 B1: every Month day button is at least 44 pt wide at 320 pt and %s text', async (fontScale) => {
  const { cells } = await month(320, fontScale);
  // No hitSlop, overflow action, or enclosing day-button exists in the real source.
  // Assert the Pressable's allocated column, not its decorative child ring.
  for (const target of cells) {
    expect(target.cell.props.accessibilityRole).toBe('button');
    expect(target.cell.props.hitSlop).toBeUndefined();
    expect(target.width).toBeGreaterThanOrEqual(44);
  }
});

it.each([[360, 1], [360, 1.3], [390, 1], [390, 1.3]])(
  'control: Month day buttons meet the 44 pt width at %s pt and %s text', async (width, fontScale) => {
    for (const target of (await month(width, fontScale)).cells) {
      expect(target.width).toBeGreaterThanOrEqual(44);
    }
  },
);

it('control: all 320 pt day buttons have sufficient vertical touch area', async () => {
  for (const target of (await month(320, 1.3)).cells) {
    expect(Number(target.style.minHeight)).toBeGreaterThanOrEqual(44);
  }
});

it('control: a Month day remains a working selected-state action', async () => {
  const { view } = await month(320, 1.3);
  const day = view.getByTestId('month-day-2026-10-05');
  await fireEvent.press(day);
  expect(view.getByTestId('month-day-2026-10-05').props.accessibilityState).toEqual({ selected: true });
  expect(view.getByTestId('week-agenda-2026-10-05')).toBeTruthy();
});

it('control: the small painted ring is not itself required to be 44 pt', async () => {
  const { view } = await month(320, 1.3);
  const day = view.getByTestId('month-day-2026-10-05');
  let circle: ViewStyle | undefined;
  const findCircle = (node: typeof day | string) => {
    if (typeof node === 'string') return;
    const style = StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>);
    if (style && Number(style.borderWidth) === 1.5) circle = style;
    node.children.forEach(findCircle);
  };
  findCircle(day);
  expect(circle).toBeDefined();
  expect(Number(circle?.minWidth)).toBe(36);
});
