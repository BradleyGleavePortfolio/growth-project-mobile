/**
 * AUDIT-11-125: the Health empty state names only what this phone can connect
 * (cloud trackers are not switched on for launch), and the coach embed shows
 * coach copy with no Connect button (a coach's client view has no Connections
 * route, so the button did nothing).
 */
import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../cards/ThreeRingHero', () => ({ __esModule: true, default: () => null }));

import HealthFitnessEmptyState from '../empty/HealthFitnessEmptyState';

const originalOS = Platform.OS;
function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}
afterEach(() => setOS(originalOS));

describe('HealthFitnessEmptyState (AUDIT-11-125)', () => {
  it('iPhone: names Apple Health only, and Connect opens Connections', async () => {
    setOS('ios');
    const onConnect = jest.fn();
    await render(<HealthFitnessEmptyState tone="warm" reduceMotion onConnect={onConnect} />);
    expect(
      screen.getByText(
        'Connect Apple Health to fill your rings and watch your heart, workouts and body trends come to life.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Garmin|Fitbit/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Connect a tracker'));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('Android: names Health Connect', async () => {
    setOS('android');
    await render(<HealthFitnessEmptyState tone="warm" reduceMotion onConnect={jest.fn()} />);
    expect(screen.getByText(/^Connect Health Connect to fill your rings/)).toBeTruthy();
  });

  it('coach embed (no onConnect): coach copy and no Connect button', async () => {
    await render(<HealthFitnessEmptyState tone="warm" reduceMotion />);
    expect(screen.getByText('No health data from this client yet')).toBeTruthy();
    expect(screen.queryByLabelText('Connect a tracker')).toBeNull();
  });
});
