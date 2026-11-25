/**
 * BEAUTY-928 (renders of m#928 at 360 pt, 100% text): a timed row's "sec"
 * made the next set's fields and its filled "As planned" too wide for one
 * line, so the pill dropped under the numbers (C1 v2 C2_logger draws it at
 * the row's end). Below 390 pt a timed next set is its text row (tap the
 * numbers to type) and the pill drops its tick, as every next set does at
 * 320 pt (FR-917R3B). A reps row keeps its fields at 360; 390 keeps both.
 */
import React, { useState } from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import Colors from '../constants/colors';
import type { ThemeColors } from '../theme/ThemeProvider';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import { makeStyles } from '../screens/client/active-workout/styles';
import type { SessionSet } from '../screens/client/active-workout/types';

const mockTick = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: (props: { name: string }) => { mockTick(props.name); return null; } }));
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));

const colors: ThemeColors = {
  ...Colors, dark: Colors.textPrimary, white: Colors.textOnPrimary,
  gold: Colors.warning, orange: Colors.error,
};
const styles = makeStyles(colors);

function Harness({ toggle, timed }: { toggle: jest.Mock; timed: boolean }) {
  const [set, update] = useState<SessionSet>({ weight: 0, reps: 60, completed: false, prescribedZero: true });
  return <>
    <SetLogger set={set} setIdx={0} exIdx={0} nextUp timed={timed}
      onUpdate={(_ex, _set, field, value) => update((s) => ({ ...s, [field]: value }))}
      onToggleComplete={(ex, idx) => { toggle(ex, idx); update((s) => ({ ...s, completed: !s.completed })); }}
      colors={colors} styles={styles} />
    <Text testID="saved-set">{JSON.stringify(set)}</Text>
  </>;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native') as typeof import('react-native');
const windowOf = (width: number) => ({ width, height: 780, scale: 2, fontScale: 1 });

afterEach(() => { jest.restoreAllMocks(); mockTick.mockClear(); });

it('at 360 pt a timed next set is its text row with a tickless pill; tapping the numbers opens the fields, in seconds', async () => {
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue(windowOf(360));
  const toggle = jest.fn();
  const view = await render(<Harness toggle={toggle} timed />);
  expect(view.getByLabelText('As planned, mark set 1 done')).toBeTruthy();
  expect(view.getByText('0 lb × 60 sec')).toBeTruthy();
  expect(view.queryByTestId('set-reps-0-0')).toBeNull();
  expect(mockTick).not.toHaveBeenCalledWith('checkmark');
  await fireEvent.press(view.getByLabelText('Set 1, 0 pounds, 60 seconds. Change the numbers'));
  expect(view.getByTestId('set-reps-0-0').props.value).toBe('60');
  expect(view.getByText('sec')).toBeTruthy();
  await fireEvent.changeText(view.getByTestId('set-reps-0-0'), '45');
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  expect(toggle).toHaveBeenCalledWith(0, 0);
  expect(JSON.parse(view.getByTestId('saved-set').props.children)).toMatchObject({ weight: 0, reps: 45, completed: true });
});

it('at 360 pt a reps next set keeps its fields and the tick, as main', async () => {
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue(windowOf(360));
  const view = await render(<Harness toggle={jest.fn()} timed={false} />);
  expect(view.getByTestId('set-reps-0-0').props.value).toBe('60');
  expect(view.queryByTestId('set-value-0-0')).toBeNull();
  expect(mockTick).toHaveBeenCalledWith('checkmark');
});

it('at 390 pt a timed next set keeps its fields, "sec" and the tick', async () => {
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue(windowOf(390));
  const view = await render(<Harness toggle={jest.fn()} timed />);
  expect(view.getByTestId('set-reps-0-0').props.value).toBe('60');
  expect(view.getByText('sec')).toBeTruthy();
  expect(view.queryByTestId('set-value-0-0')).toBeNull();
  expect(mockTick).toHaveBeenCalledWith('checkmark');
});
