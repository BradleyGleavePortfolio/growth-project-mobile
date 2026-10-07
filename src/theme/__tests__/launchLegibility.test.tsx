import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import Colors from '../../constants/colors';
import { Typography } from '../index';
import { lightTokens } from '../tokens';
import { ThemeProvider, useTheme } from '../ThemeProvider';

jest.mock('../../hooks/useIdentity', () => ({ useFoundingNumber: () => ({ data: null }) }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true, default: () => 'dark',
}));

function ReadTheme() {
  const theme = useTheme();
  return <Text testID="theme">{JSON.stringify({
    scheme: theme.colorScheme, override: theme.appearanceOverride, colors: theme.semanticColors,
  })}</Text>;
}

beforeEach(() => AsyncStorage.clear());

it('uses the AA-verified muted role across legacy exports and body text', () => {
  expect(Colors.textMuted).toBe(lightTokens.textMuted);
  expect(Typography.body.color).toBe(lightTokens.textMuted);
});

it.each(['system', 'light', 'dark'])('renders stored %s coherently light, even on a dark device', async (stored) => {
  await AsyncStorage.setItem('gp_appearance', stored);
  const view = await render(<ThemeProvider><ReadTheme /></ThemeProvider>);
  await waitFor(() => expect(JSON.parse(view.getByTestId('theme').props.children)).toEqual({
    scheme: 'light', override: stored === 'dark' ? 'light' : stored, colors: lightTokens,
  }));
});

it('persists the supported preferences without activating the partial dark theme', async () => {
  let theme!: ReturnType<typeof useTheme>;
  function Controls() { theme = useTheme(); return <ReadTheme />; }
  const view = await render(<ThemeProvider><Controls /></ThemeProvider>);
  for (const override of ['light', 'system'] as const) {
    await act(async () => theme.setAppearanceOverride(override));
    expect(await AsyncStorage.getItem('gp_appearance')).toBe(override);
    expect(JSON.parse(view.getByTestId('theme').props.children).scheme).toBe('light');
  }
});
