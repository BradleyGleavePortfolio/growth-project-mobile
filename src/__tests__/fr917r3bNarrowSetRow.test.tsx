/**
 * FR-917R3B (renders at the head, LO-917R3 B2): on a 320 pt phone the next
 * set's fields and its filled "As planned" did not fit one line (the pill
 * dropped under the numbers). There the next set is its text row (tap the
 * numbers to type) and the pill drops its tick; wider phones keep the fields.
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

function Harness({ toggle }: { toggle: jest.Mock }) {
  const [set, update] = useState<SessionSet>({ weight: 155, reps: 6, completed: false });
  return <>
    <SetLogger set={set} setIdx={1} exIdx={1} nextUp
      onUpdate={(_ex, _set, field, value) => update((s) => ({ ...s, [field]: value }))}
      onToggleComplete={(ex, idx) => { toggle(ex, idx); update((s) => ({ ...s, completed: !s.completed })); }}
      colors={colors} styles={styles} />
    <Text testID="saved-set">{JSON.stringify(set)}</Text>
  </>;
}

// The module object SetLogger reads (a namespace import would be a copy).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native') as typeof import('react-native');
const windowOf = (width: number) => ({ width, height: 640, scale: 2, fontScale: 1 });

afterEach(() => { jest.restoreAllMocks(); mockTick.mockClear(); });

it('FR-917R3B: at 320 pt the next set is a text row and its pill has no tick; tapping the numbers opens the fields', async () => {
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue(windowOf(320));
  const toggle = jest.fn();
  const view = await render(<Harness toggle={toggle} />);
  // Control: it is still the next set (lifted row, filled pill with the words in its name).
  expect(view.getByLabelText('As planned, mark set 2 done')).toBeTruthy();
  expect(view.getByText('155 lb × 6')).toBeTruthy();
  expect(view.queryByTestId('set-weight-1-1')).toBeNull();
  expect(mockTick).not.toHaveBeenCalledWith('checkmark');
  await fireEvent.press(view.getByTestId('set-value-1-1'));
  expect(view.getByTestId('set-weight-1-1').props.value).toBe('155');
  await fireEvent.changeText(view.getByTestId('set-reps-1-1'), '5');
  await fireEvent.press(view.getByTestId('set-done-1-1'));
  expect(toggle).toHaveBeenCalledWith(1, 1);
  expect(JSON.parse(view.getByTestId('saved-set').props.children)).toEqual({ weight: 155, reps: 5, completed: true });
});

it('FR-917R3B: at 360 pt the next set keeps its fields and the tick', async () => {
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue(windowOf(360));
  const view = await render(<Harness toggle={jest.fn()} />);
  expect(view.getByTestId('set-weight-1-1').props.value).toBe('155');
  expect(view.queryByTestId('set-value-1-1')).toBeNull();
  expect(mockTick).toHaveBeenCalledWith('checkmark');
});
