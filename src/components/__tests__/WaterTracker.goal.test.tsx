import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import WaterTracker from '../WaterTracker';

describe('WaterTracker', () => {
  beforeEach(() => AsyncStorage.clear());

  it("uses the client's Water Goal from Settings, not a fixed 128 oz", async () => {
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ waterGoalOz: 64 }));
    await render(<WaterTracker currentOz={8} onAdd={jest.fn()} />);
    expect(await screen.findByText('8 / 64 oz')).toBeTruthy();
    expect(screen.getByText('1 glass (8 oz)')).toBeTruthy();
  });

  it('falls back to the Settings default and counts glasses with the right word', async () => {
    await render(<WaterTracker currentOz={24} onAdd={jest.fn()} />);
    expect(await screen.findByText('24 / 100 oz')).toBeTruthy();
    expect(screen.getByText('3 glasses (8 oz each)')).toBeTruthy();
  });
});
