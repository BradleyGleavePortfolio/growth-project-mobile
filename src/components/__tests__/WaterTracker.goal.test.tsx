import React from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import WaterTracker from '../WaterTracker';
import { darkTokens, lightTokens } from '../../theme/tokens';

let mockSemanticColors = lightTokens;
jest.mock('../../theme/useTheme', () => ({
  useTheme: () => ({ semanticColors: mockSemanticColors }),
}));

describe('WaterTracker', () => {
  beforeEach(() => {
    mockSemanticColors = lightTokens;
    return AsyncStorage.clear();
  });

  it('uses a changed Settings goal without calling it a starter goal', async () => {
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ waterGoalOz: 64 }));
    await render(<WaterTracker currentOz={8} onAdd={jest.fn()} />);
    expect(await screen.findByText('8 / 64 oz')).toBeTruthy();
    expect(screen.queryByText('Starter goal')).toBeNull();
    expect(screen.getByText('1 glass (8 oz)')).toBeTruthy();
  });

  it('labels the default reference as Starter goal and preserves the glass count', async () => {
    await render(<WaterTracker currentOz={24} onAdd={jest.fn()} />);
    expect(await screen.findByText('24 / 100 oz')).toBeTruthy();
    expect(screen.getByText('Starter goal')).toBeTruthy();
    expect(screen.getByText('3 glasses (8 oz each)')).toBeTruthy();
  });

  it('keeps the starter label when only the units preference was saved', async () => {
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ unit: 'kg' }));
    await render(<WaterTracker currentOz={8} onAdd={jest.fn()} />);
    expect(await screen.findByText('≈ 237 / 2957 ml')).toBeTruthy();
    expect(screen.getByText('Starter goal')).toBeTruthy();
    expect(screen.getByText('1 glass (about 237 ml)')).toBeTruthy();
    expect(screen.queryByText(/oz|ounces/)).toBeNull();
    expect(screen.getByLabelText('Water progress').props.accessibilityValue).toEqual({
      min: 0,
      max: 2957,
      now: 237,
      text: 'About 237 of 2957 milliliters, starter goal',
    });
  });

  it('honours an explicit target, even when it matches the starter amount', async () => {
    await render(<WaterTracker currentOz={8} targetOz={100} onAdd={jest.fn()} />);
    expect(screen.getByText('8 / 100 oz')).toBeTruthy();
    expect(screen.queryByText('Starter goal')).toBeNull();
    expect(screen.getByLabelText('Water progress').props.accessibilityValue.text)
      .toBe('8 of 100 ounces');
  });

  it('converts a changed goal and current amount together for metric progress', async () => {
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ unit: 'kg', waterGoalOz: 64 }));
    await render(<WaterTracker currentOz={24} onAdd={jest.fn()} />);
    expect(await screen.findByText('≈ 710 / 1893 ml')).toBeTruthy();
    expect(screen.queryByText('Starter goal')).toBeNull();
    expect(screen.getByText('3 glasses (about 237 ml each)')).toBeTruthy();
    expect(screen.getByLabelText('Water progress').props.accessibilityValue).toEqual({
      min: 0,
      max: 1893,
      now: 710,
      text: 'About 710 of 1893 milliliters',
    });
  });

  it('preserves all three imperial quick-add actions and ounce callback values', async () => {
    const onAdd = jest.fn();
    await render(<WaterTracker currentOz={0} onAdd={onAdd} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    for (const oz of [8, 12, 16]) {
      expect(screen.getByText(`+${oz}oz`)).toBeTruthy();
      await fireEvent.press(screen.getByLabelText(`Add ${oz} ounces of water`));
      expect(onAdd).toHaveBeenLastCalledWith(oz);
    }
    expect(onAdd).toHaveBeenCalledTimes(3);
  });

  it('makes every metric quick-add reach the same callback with exact stored ml', async () => {
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ unit: 'kg' }));
    const onAdd = jest.fn();
    await render(<WaterTracker currentOz={0} onAdd={onAdd} />);
    await screen.findByText('+250 ml');
    expect(screen.getAllByRole('button')).toHaveLength(3);
    for (const ml of [250, 350, 500]) {
      expect(screen.getByText(`+${ml} ml`)).toBeTruthy();
      await fireEvent.press(screen.getByLabelText(`Add ${ml} milliliters of water`));
      expect(onAdd).toHaveBeenLastCalledWith(ml / 29.5735);
      const oz = onAdd.mock.calls[onAdd.mock.calls.length - 1][0];
      expect(Math.round(oz * 29.5735)).toBe(ml);
    }
    expect(onAdd).toHaveBeenCalledTimes(3);
  });

  it.each([lightTokens, darkTokens])('uses the active semantic colours and keeps 44 pt controls', async (colours) => {
    mockSemanticColors = colours;
    await render(<WaterTracker currentOz={8} onAdd={jest.fn()} />);
    expect(StyleSheet.flatten(screen.getByText('Water').props.style).color).toBe(colours.textPrimary);
    expect(StyleSheet.flatten(screen.getByText('+8oz').props.style)).toMatchObject({
      color: colours.accent,
      fontVariant: ['tabular-nums'],
    });
    expect(StyleSheet.flatten(screen.getByLabelText('Add 8 ounces of water').props.style).minHeight).toBe(44);
  });
});
