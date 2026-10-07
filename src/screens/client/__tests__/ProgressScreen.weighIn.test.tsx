/**
 * ProgressScreen — Log weight sheet on iPhone (FW-BODY-128 B1) and the
 * truthful numbers next to it (U1, U6, U8, U9).
 *
 * B1: the decimal pad covered the sheet (weight field + Save) and nothing
 * dismissed it, so the first weigh-in could not be saved on an iPhone.
 */
import React from 'react';
import { Keyboard, StyleSheet } from 'react-native';
import { render, fireEvent, act, within } from '@testing-library/react-native';
import { colors } from '../../../theme/tokens';

const mockGetHistory = jest.fn(async (): Promise<{ data: unknown }> => ({
  data: {
    logs: [
      { id: '1', date: '2026-10-01T00:00:00.000Z', weight_lbs: 185 },
      { id: '2', date: '2026-10-07T00:00:00.000Z', weight_lbs: 187 },
    ],
    height_cm: null,
  },
}));
const mockLog = jest.fn(async (_body: unknown): Promise<unknown> => ({}));
jest.mock('../../../services/api', () => ({
  weightApi: {
    getHistory: (...args: unknown[]) => mockGetHistory(...(args as [])),
    log: (body: unknown) => mockLog(body),
  },
  logApi: { getDaily: jest.fn(async () => ({ data: {} })) },
}));

jest.mock('../../../hooks/useMacroTargets', () => ({
  useMacroTargets: () => ({ calories: 2000, protein: 150, carbs: 200, fat: 60 }),
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'user-1', profile: { target_weight_lbs: 170 } }),
}));

jest.mock('../../../theme/ThemeProvider', () => {
  const tokens = require('../../../theme/tokens');
  return {
    useTheme: () => ({
      colorScheme: 'light',
      colors: tokens.colors,
      semanticColors: tokens.lightTokens,
    }),
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../config/featureFlags', () => ({
  __esModule: true,
  featureFlags: {
    romanFirstPaymentBodyweightPolish: false,
    romanFirstPaymentRequireBackendHistory: false,
  },
}));

import { Alert } from 'react-native';
import ProgressScreen, { formatLogDate } from '../ProgressScreen';

let dismissSpy: jest.SpyInstance;
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockLog.mockClear();
  dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  dismissSpy.mockRestore();
  alertSpy.mockRestore();
});

async function openSheet() {
  const utils = await render(<ProgressScreen />);
  const fab = await utils.findByLabelText('Log weight');
  await fireEvent.press(fab);
  return utils;
}

describe('Log weight sheet on iPhone (B1)', () => {
  it('rides above the number pad: the sheet sits in a padding KeyboardAvoidingView', async () => {
    const { getByTestId } = await openSheet();
    // The avoider wraps the sheet, so the field and Save move above the pad
    // (behaviour "padding" on iOS) instead of sitting under it.
    const avoider = getByTestId('log-weight-keyboard-avoider');
    expect(within(avoider).getByTestId('log-weight-input')).toBeTruthy();
    expect(within(avoider).getByTestId('log-weight-save')).toBeTruthy();
  });

  it('dismisses the number pad on tap outside and on Done', async () => {
    const { getByTestId } = await openSheet();
    await fireEvent.press(getByTestId('log-weight-backdrop'));
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    await fireEvent.press(getByTestId('log-weight-keyboard-done'));
    expect(dismissSpy).toHaveBeenCalledTimes(2);
    expect(getByTestId('log-weight-input').props.inputAccessoryViewID).toBe(
      'progress-log-weight-keyboard',
    );
  });

  it('disables Save while saving and sends one entry for a double tap', async () => {
    let resolveLog: (v: unknown) => void = () => undefined;
    mockLog.mockImplementationOnce(
      () => new Promise((resolve) => { resolveLog = resolve; }),
    );
    const { getByTestId, getByText } = await openSheet();
    await fireEvent.changeText(getByTestId('log-weight-input'), '182.4');
    await fireEvent.press(getByTestId('log-weight-save'));
    expect(getByText('Saving')).toBeTruthy();
    expect(getByTestId('log-weight-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true, busy: true }),
    );
    await fireEvent.press(getByTestId('log-weight-save'));
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ weight_lbs: 182.4 }));
    await act(async () => {
      resolveLog({});
    });
  });

  it('Save is disabled until a weight is typed', async () => {
    const { getByTestId } = await openSheet();
    expect(getByTestId('log-weight-save').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });
});

describe('Log weight validation copy (U6)', () => {
  it('says the real range instead of a raw "Bad Request"', async () => {
    const { getByTestId } = await openSheet();
    await fireEvent.changeText(getByTestId('log-weight-input'), '1800');
    await fireEvent.press(getByTestId('log-weight-save'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Weight not saved',
      'Enter a weight between 40 and 1,500 lb.',
    );
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('asks for a number when the value is not one', async () => {
    const { getByTestId } = await openSheet();
    await fireEvent.changeText(getByTestId('log-weight-input'), '.');
    await fireEvent.press(getByTestId('log-weight-save'));
    expect(alertSpy).toHaveBeenCalledWith('Weight not saved', 'Enter your weight as a number.');
    expect(mockLog).not.toHaveBeenCalled();
  });
});

describe('Progress numbers tell the truth (U1, U8, U9)', () => {
  it('shows the goal the consultation saved (profile.target_weight_lbs)', async () => {
    const { findByText } = await render(<ProgressScreen />);
    expect(await findByText('170')).toBeTruthy();
  });

  it('shows the change in monochrome (a gain is not a warning)', async () => {
    const { findByTestId } = await render(<ProgressScreen />);
    const change = await findByTestId('progress-weight-change');
    const style = StyleSheet.flatten(change.props.style);
    expect(style.color).not.toBe(colors.warning);
    expect(style.color).not.toBe(colors.success);
  });

  it('formats entry dates as "Wed 7 Oct"', async () => {
    expect(formatLogDate('2026-10-07')).toBe('Wed 7 Oct');
    const { findByText } = await render(<ProgressScreen />);
    expect(await findByText('Wed 7 Oct')).toBeTruthy();
  });
});
