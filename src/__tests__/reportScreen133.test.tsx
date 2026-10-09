// REDO-INSETS-133 PR 2 (agent 133): Weekly report on the progress-details
// reference. Top from the Screen wrapper, no first-person title, rounded
// tokens only, and today's totals stay unknown until the log is read.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { logApi, weightApi } from '../services/api';
import { layout } from '../theme/tokens';
import ReportScreen from '../screens/client/ReportScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../constants/colors').default, semanticColors: jest.requireActual('../theme/tokens').lightTokens }),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', firstName: 'Ada', profile: { current_weight: 180, calorie_target: 2000, primary_goal: 'maintain' } }),
}));
jest.mock('../services/api', () => ({
  logApi: { getDaily: jest.fn() },
  weightApi: { getHistory: jest.fn() },
}));

const navigation = { goBack: jest.fn() as () => void } as NavigationProp<ParamListBase>;
const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];
const mount = (d: (typeof DEVICES)[number]) => render(
  <SafeAreaProvider initialMetrics={{ frame: d.frame, insets: d.insets }}><ReportScreen navigation={navigation} /></SafeAreaProvider>,
);

beforeEach(() => {
  jest.mocked(weightApi.getHistory).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof weightApi.getHistory>>);
});

it.each(DEVICES)('sits insets.top + 12 under the status bar on $name, titled Weekly report', async (d) => {
  jest.mocked(logApi.getDaily).mockResolvedValue({ data: { entries: [] } } as Awaited<ReturnType<typeof logApi.getDaily>>);
  const s = await mount(d);
  await waitFor(() => expect(s.getAllByText('0')).toHaveLength(4));
  expect(StyleSheet.flatten(s.getByTestId('report').props.style).paddingTop).toBe(d.insets.top + layout.statusBarGap);
  expect(s.getByRole('header', { name: 'Weekly report' })).toBeTruthy();
  expect(s.queryByText(/My Report/)).toBeNull();
  expect(s.getByText('Take a screenshot to keep this report.')).toBeTruthy();
  expect(s.getByLabelText('Back')).toBeTruthy();
});

it('shows -- for today, not zero, when the food log cannot be read', async () => {
  jest.mocked(logApi.getDaily).mockRejectedValue(new Error('offline'));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const s = await mount(DEVICES[0]);
  await waitFor(() => expect(logApi.getDaily).toHaveBeenCalled());
  await waitFor(() => expect(s.getAllByText('--').length).toBeGreaterThanOrEqual(4));
  expect(s.queryByText('0')).toBeNull();
});

it('uses the rounded tokens only and the shared wrapper', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'client', 'ReportScreen.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  expect(src.match(/borderRadius:\s*\d/g)).toBeNull();
  expect(src).toMatch(/import \{ Screen \} from '\.\.\/\.\.\/ui'/);
  expect(src).not.toMatch(/paddingTop:\s*56/);
});
