// START-HANG-134 (B36, B37): the calm startup states (prototype 44) and the
// biometric gate's checking state.
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StartupErrorScreen, StartupPending, STARTUP_ERROR_COPY } from '../StartupErrorScreen';
import BiometricUnlockGate from '../BiometricUnlockGate';

let mockGate: { status: 'checking' | 'locked' | 'unlocked'; retry: jest.Mock } = {
  status: 'checking',
  retry: jest.fn(),
};
jest.mock('../../hooks/useBiometricGate', () => ({ useBiometricGate: () => mockGate }));

function allText(tree: Awaited<ReturnType<typeof render>>): string {
  return JSON.stringify(tree.toJSON());
}

describe('StartupErrorScreen (prototype 44)', () => {
  it("Roman's calm line and one forest Try again; no exclamation marks", async () => {
    const onRetry = jest.fn();
    const r = await render(<StartupErrorScreen onRetry={onRetry} />);
    expect(r.getByTestId('startup-error-line').props.children).toBe(STARTUP_ERROR_COPY.server);
    expect(r.getByTestId('startup-error-roman')).toBeTruthy();
    expect(r.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(r.getByTestId('startup-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    for (const line of Object.values(STARTUP_ERROR_COPY)) expect(line).not.toMatch(/!/);
  });
});

describe('StartupPending: never an endless spinner', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('becomes the calm error at the ceiling; Try again runs again and waits afresh', async () => {
    const onRetry = jest.fn();
    const r = await render(<StartupPending ceilingMs={1000} onRetry={onRetry} />);
    expect(r.getByTestId('startup-pending')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(r.queryByTestId('startup-error')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(r.getByTestId('startup-error')).toBeTruthy();
    await fireEvent.press(r.getByTestId('startup-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(r.getByTestId('startup-pending')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(r.getByTestId('startup-error')).toBeTruthy();
  });
});

describe('BiometricUnlockGate (B36)', () => {
  const child = <Text testID="app">app</Text>;

  it('while checking: the plain splash background only, no "Locked", no spinner', async () => {
    mockGate = { status: 'checking', retry: jest.fn() };
    const r = await render(<BiometricUnlockGate>{child}</BiometricUnlockGate>);
    expect(r.getByTestId('biometric-gate-checking')).toBeTruthy();
    expect(allText(r)).not.toMatch(/Locked|Verifying/);
    expect(r.queryByTestId('app')).toBeNull();
  });

  it('unlocked: the app renders', async () => {
    mockGate = { status: 'unlocked', retry: jest.fn() };
    const r = await render(<BiometricUnlockGate>{child}</BiometricUnlockGate>);
    expect(r.getByTestId('app')).toBeTruthy();
  });

  it('locked (opted in, unlock not done): "Locked" and one Unlock button', async () => {
    const retry = jest.fn();
    mockGate = { status: 'locked', retry };
    const r = await render(<BiometricUnlockGate>{child}</BiometricUnlockGate>);
    expect(r.getByText('Locked')).toBeTruthy();
    expect(r.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(r.getByTestId('biometric-gate-unlock'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
