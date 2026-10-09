/**
 * ProgressScreen — REDO-PROGRESS-133 PR B: today's food, BMI, recent
 * weigh-ins and the Log weight sheet redrawn to progress-details/luxury.jpg,
 * with the WEIGH-KB-128 truth items U2 (BMI from the server height, in
 * monochrome; no empty "Body Stats" heading) and U3 (no invented "/ 2000
 * kcal"; nothing claimed while the read runs or after it fails).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act, waitFor, within } from '@testing-library/react-native';
import { colors, radius } from '../../../theme/tokens';

let mockLogs: Array<{ id: string; date: string; weight_lbs: number; notes?: string }> = [];
let mockHeightCm: number | null = null;
jest.mock('../../../services/api', () => ({
  weightApi: {
    getHistory: jest.fn(async () => ({ data: { logs: mockLogs, height_cm: mockHeightCm } })),
    log: jest.fn(async () => ({})),
  },
  logApi: { getDaily: () => mockDaily() },
}));
let mockDaily: () => Promise<{ data: Record<string, number> }> = async () => ({ data: {} });
let mockTargets: Record<string, number> | null = null;
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => mockTargets }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user-1', profile: {} }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const tokens = require('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../config/featureFlags', () => ({
  __esModule: true,
  featureFlags: { romanFirstPaymentBodyweightPolish: false },
}));

import ProgressScreen from '../ProgressScreen';

beforeEach(() => {
  mockLogs = [
    { id: 'b', date: '2026-10-01T00:00:00.000Z', weight_lbs: 185 },
    { id: 'c', date: '2026-10-07T00:00:00.000Z', weight_lbs: 183, notes: 'After a long run.' },
  ];
  mockHeightCm = null;
  mockTargets = null;
  mockDaily = async () => ({ data: { total_calories: 1240, total_protein_g: 98, total_carbs_g: 120, total_fat_g: 41 } });
});

async function screen() {
  const utils = await render(<ProgressScreen />);
  await waitFor(() => expect(utils.getByText('Recent weigh-ins')).toBeTruthy());
  return utils;
}

describe('U2: BMI', () => {
  it('reads the server height and stays monochrome', async () => {
    mockHeightCm = 178;
    const { findByText, getByText } = await screen();
    const bmi = await findByText('26.2');
    expect([colors.warning, colors.success, colors.error]).not.toContain(StyleSheet.flatten(bmi.props.style).color);
    expect(getByText('Overweight')).toBeTruthy();
  });

  it('shows no BMI row and no empty heading without a height', async () => {
    const { queryByText } = await screen();
    expect(queryByText('BMI')).toBeNull();
    expect(queryByText('Body Stats')).toBeNull();
  });
});

describe("U3: today's food", () => {
  it('invents no calorie target', async () => {
    const { findByText, queryByText } = await screen();
    expect(await findByText('1,240 kcal')).toBeTruthy();
    expect(queryByText(/2,000|2000/)).toBeNull();
  });

  it('reads "of" against real targets', async () => {
    mockTargets = { calories: 2100, protein: 160 };
    const { findByText, getByText } = await screen();
    expect(await findByText('1,240 of 2,100 kcal')).toBeTruthy();
    expect(getByText('98 of 160 g')).toBeTruthy();
    expect(getByText('120 g')).toBeTruthy();
  });

  it('claims no zeros while the read runs', async () => {
    let release: (v: { data: Record<string, number> }) => void = () => undefined;
    mockDaily = () => new Promise((resolve) => { release = resolve; });
    const { getByTestId } = await screen();
    expect(within(getByTestId('progress-today-food')).getAllByText('\u2014')).toHaveLength(4);
    await act(async () => { release({ data: {} }); });
  });

  it('says so when the read fails', async () => {
    mockDaily = async () => { throw new Error('offline'); };
    const { findByTestId } = await screen();
    expect(await findByTestId('progress-today-error')).toBeTruthy();
  });
});

describe('Recent weigh-ins and the sheet', () => {
  it('lists the newest first with the note under the day', async () => {
    const { getByTestId } = await screen();
    const rows = within(getByTestId('progress-weigh-ins'));
    expect(rows.getByText('Wed 7 Oct')).toBeTruthy();
    expect(rows.getByText('After a long run.')).toBeTruthy();
    expect(rows.queryByText(/lbs/)).toBeNull();
  });

  it('rounds the sheet and its field with the radius tokens', async () => {
    const { getByLabelText, findByTestId, getByTestId } = await screen();
    await fireEvent.press(getByLabelText('Log weight'));
    const sheet = StyleSheet.flatten((await findByTestId('log-weight-sheet')).props.style);
    expect(sheet.borderTopLeftRadius).toBe(radius.sheet);
    expect(StyleSheet.flatten(getByTestId('log-weight-input').props.style).borderRadius).toBe(radius.input);
    expect(StyleSheet.flatten(getByTestId('log-weight-save').props.style).borderRadius).toBe(radius.button);
    // The button reads "Save"; screen readers still hear the full action.
    expect(getByTestId('log-weight-save').props.accessibilityLabel).toBe('Save weight log entry');
    expect(within(getByTestId('log-weight-save')).getByText('Save')).toBeTruthy();
  });
});
