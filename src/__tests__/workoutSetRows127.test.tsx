import React, { useState } from 'react';
import { StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import Colors from '../constants/colors';
import type { ThemeColors } from '../theme/ThemeProvider';
import { lightTokens as sc } from '../theme/tokens';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import { ExerciseCard } from '../screens/client/active-workout/ExerciseCard';
import { makeStyles } from '../screens/client/active-workout/styles';
import type { SessionSet } from '../screens/client/active-workout/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));

const colors: ThemeColors = {
  ...Colors, dark: Colors.textPrimary, white: Colors.textOnPrimary,
  gold: Colors.warning, orange: Colors.error,
};
const styles = makeStyles(colors);
const previous: SessionSet = { weight: 60, reps: 10, completed: false };

function Harness({ prior = previous, initial = { weight: 0, reps: 0, completed: false }, toggle = jest.fn() }: {
  prior?: SessionSet | null; initial?: SessionSet; toggle?: jest.Mock;
}) {
  const [set, update] = useState(initial);
  return <>
    <SetLogger set={set} setIdx={0} exIdx={0} previous={prior ?? undefined}
      onUpdate={(_ex, _set, field, value) => update((s) => ({ ...s, [field]: value }))}
      onToggleComplete={(ex, idx) => { toggle(ex, idx); update((s) => ({ ...s, completed: !s.completed })); }}
      colors={colors} styles={styles} />
    <Text testID="saved-set">{JSON.stringify(set)}</Text>
  </>;
}

describe('live workout row ghost values and action parity', () => {
  it('shows honest ghosts, then a blank tick adopts history as actual values', async () => {
    const toggle = jest.fn();
    const view = await render(<Harness toggle={toggle} />);
    expect(view.getByTestId('set-weight-0-0').props).toMatchObject({ value: '', placeholder: '60', placeholderTextColor: sc.textMuted });
    expect(view.getByTestId('set-reps-0-0').props).toMatchObject({ value: '', placeholder: '10' });
    await fireEvent.press(view.getByRole('checkbox', { name: 'Mark set 1 done' }));
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('60');
    expect(view.getByTestId('set-reps-0-0').props.value).toBe('10');
    expect(view.getByTestId('saved-set').props.children).toBe(JSON.stringify({ weight: 60, reps: 10, completed: true }));
    expect(toggle).toHaveBeenCalledWith(0, 0);
    await fireEvent.press(view.getByRole('checkbox', { name: 'Mark set 1 done', checked: true }));
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('60');
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('typed decimals and reps override ghosts while Previous stays visible', async () => {
    const view = await render(<Harness />);
    await fireEvent.changeText(view.getByTestId('set-weight-0-0'), '72.');
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('72.');
    await fireEvent.changeText(view.getByTestId('set-weight-0-0'), '72.5');
    await fireEvent.changeText(view.getByTestId('set-reps-0-0'), '8');
    expect(view.getByText('Previous')).toBeTruthy();
    expect(view.getByText('60 × 10')).toBeTruthy();
    await fireEvent.press(view.getByRole('checkbox'));
    expect(view.getByTestId('saved-set').props.children).toBe(JSON.stringify({ weight: 72.5, reps: 8, completed: true }));
  });

  it('fills only a blank field and does not replace an explicitly typed zero', async () => {
    const view = await render(<Harness />);
    await fireEvent.changeText(view.getByTestId('set-weight-0-0'), '0');
    await fireEvent.press(view.getByRole('checkbox'));
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('0');
    expect(view.getByTestId('set-reps-0-0').props.value).toBe('10');
  });

  it('shows a repeated bodyweight zero as actual text after completion', async () => {
    const view = await render(<Harness prior={{ ...previous, weight: 0 }} />);
    await fireEvent.press(view.getByRole('checkbox'));
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('0');
    expect(view.getByTestId('set-reps-0-0').props.value).toBe('10');
  });

  it('keeps Use previous as the same one-tap fill action on the compact cell', async () => {
    const view = await render(<Harness />);
    await fireEvent.changeText(view.getByTestId('set-weight-0-0'), '75');
    await fireEvent.press(view.getByRole('button', { name: 'Use previous set 1: 60 pounds, 10 reps' }));
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('60');
    expect(view.getByTestId('set-reps-0-0').props.value).toBe('10');
  });

  it('without history, leaves empty inputs at zero rather than inventing a valid set', async () => {
    const view = await render(<Harness prior={null} />);
    expect(view.getByTestId('set-weight-0-0').props.placeholder).toBe('0');
    expect(view.queryByText('Previous')).toBeNull();
    await fireEvent.press(view.getByRole('checkbox'));
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('');
    expect(view.getByTestId('set-reps-0-0').props.value).toBe('');
    expect(view.getByTestId('saved-set').props.children).toBe(JSON.stringify({ weight: 0, reps: 0, completed: true }));
  });

  it('keeps already populated plan/resume values instead of replacing them', async () => {
    const view = await render(<Harness initial={{ weight: 95, reps: 6, completed: false }} />);
    await fireEvent.press(view.getByRole('checkbox'));
    expect(view.getByTestId('saved-set').props.children).toBe(JSON.stringify({ weight: 95, reps: 6, completed: true }));
  });

  it('keeps the hidden completion mode used by saved-workout corrections', async () => {
    const view = await render(<SetLogger set={{ ...previous, completed: true }} setIdx={0} exIdx={0}
      onUpdate={jest.fn()} onToggleComplete={jest.fn()} hideCompletion colors={colors} styles={styles} />);
    expect(view.queryByRole('checkbox')).toBeNull();
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('60');
  });

  it('renders the consuming exercise card with every existing action still wired', async () => {
    const exercise = { exerciseId: 'bench', exerciseName: 'Bench press', sets: [previous], restSec: 90, coachNote: 'Controlled tempo' };
    const update = jest.fn(), complete = jest.fn(), add = jest.fn(), remove = jest.fn();
    const video = jest.fn(), move = jest.fn(), swap = jest.fn(), notes = jest.fn(), rest = jest.fn();
    const view = await render(<ExerciseCard exercise={exercise} exIdx={1} onUpdateSet={update}
      onToggleSetComplete={complete} onAddSet={add} onRemoveExercise={remove} onOpenExerciseDetail={video}
      onMove={move} onSwap={swap} onChangeNotes={notes} onChangeRest={rest}
      previous={[previous]} colors={colors} styles={styles} />);
    for (const label of ['Watch video for Bench press', 'Remove Bench press', 'Move Bench press up',
      'Move Bench press down', 'Swap Bench press', ...[60, 90, 120].map((n) => `Set rest for Bench press to ${n} seconds`)]) {
      await fireEvent.press(view.getByLabelText(label));
    }
    await fireEvent.press(view.getByText('Add set'));
    await fireEvent.changeText(view.getByLabelText('Notes for Bench press'), 'Smooth');
    await fireEvent.changeText(view.getByTestId('set-weight-1-0'), '65');
    await fireEvent.changeText(view.getByTestId('set-reps-1-0'), '8');
    await fireEvent.press(view.getByLabelText('Use previous set 1: 60 pounds, 10 reps'));
    await fireEvent.press(view.getByRole('checkbox'));
    expect(video).toHaveBeenCalledWith(exercise);
    expect(remove).toHaveBeenCalledWith(1);
    expect(move.mock.calls).toEqual([[1, -1], [1, 1]]);
    expect(swap).toHaveBeenCalledWith(1);
    expect(rest.mock.calls).toEqual([[1, 60], [1, 90], [1, 120]]);
    expect(add).toHaveBeenCalledWith(1);
    expect(notes).toHaveBeenCalledWith(1, 'Smooth');
    expect(update.mock.calls).toEqual([[1, 0, 'weight', 65], [1, 0, 'reps', 8], [1, 0, 'weight', 60], [1, 0, 'reps', 10]]);
    expect(complete).toHaveBeenCalledWith(1, 0);
    expect(view.getByText('Coach note: Controlled tempo')).toBeTruthy();
  });

  it('uses Inter, readable labels, semantic hairlines and comfortable number targets', () => {
    for (const style of Object.values(styles)) {
      const flat = StyleSheet.flatten<TextStyle>(style);
      if ('fontSize' in flat) {
        expect(flat.fontSize).toBeGreaterThanOrEqual(13);
        expect(flat.fontFamily).toMatch(/^Inter_/);
      }
    }
    const input = StyleSheet.flatten<TextStyle>(styles.setInput);
    const row = StyleSheet.flatten<ViewStyle>(styles.setRow);
    expect(input.minHeight).toBeGreaterThanOrEqual(44);
    expect(input.minWidth).toBeGreaterThanOrEqual(44);
    expect(styles.previousSet.minHeight).toBeGreaterThanOrEqual(44);
    expect(styles.checkBtn.width).toBeGreaterThanOrEqual(44);
    for (const style of [styles.setInput, styles.timerText, styles.restCountdown]) {
      expect(StyleSheet.flatten<TextStyle>(style).fontVariant).toEqual(['tabular-nums']);
    }
    expect(row.borderBottomColor).toBe(sc.border);
  });
});
