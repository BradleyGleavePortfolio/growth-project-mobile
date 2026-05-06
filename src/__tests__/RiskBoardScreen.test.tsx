// RiskBoardScreen — Phase 1E doctrine guards.
//
// We assert the contract that matters most for this screen:
//   1. The role gate exists in source — students/coaches see a placeholder,
//      only role==='owner' loads the data path.
//   2. The four filter chips wire to setFilter and re-fetch.
//   3. Tapping a row navigates with `userId`.
//   4. The empty state quotes the "04:00 UTC" recompute window.
// A full mount-and-fetch test would pull in axios, RN Navigation, theme
// fonts, and the founding-number hook chain — way too much surface for
// what we're guarding. The InviteCodesScreen test in this repo uses the
// same source-level approach (see __tests__/InviteCodesShare.test.ts).

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'RiskBoardScreen.tsx'),
  'utf8',
);

describe('RiskBoardScreen — source guards', () => {
  it("gates the data path behind role==='owner'", () => {
    expect(SCREEN_SRC).toMatch(/currentUser\?\.role\s*===\s*['"]owner['"]/);
    expect(SCREEN_SRC).toMatch(/if\s*\(!isOwner\)/);
  });

  it('exposes a placeholder testID for the non-owner branch', () => {
    expect(SCREEN_SRC).toMatch(/testID="risk-board-placeholder"/);
  });

  it('renders all four filter chips and re-fetches on filter change', () => {
    expect(SCREEN_SRC).toMatch(/Filter\[\]\s*=\s*\[\s*['"]all['"]\s*,\s*['"]red['"]\s*,\s*['"]amber['"]\s*,\s*['"]green['"]\s*\]/);
    // Effect re-runs when filter changes (resetting items + cursor + fetching)
    expect(SCREEN_SRC).toMatch(/\}\s*,\s*\[filter,\s*isOwner\]\s*\)\s*;/);
  });

  it('navigates to ClientRiskDetail with the userId param', () => {
    expect(SCREEN_SRC).toMatch(/navigation\.navigate\(\s*['"]ClientRiskDetail['"]/);
    expect(SCREEN_SRC).toMatch(/userId:\s*item\.user_id/);
  });

  it('shows the 04:00 UTC empty-state copy', () => {
    expect(SCREEN_SRC).toMatch(/04:00 UTC/);
  });

  it('uses cursor-based pagination with PAGE_SIZE = 20', () => {
    expect(SCREEN_SRC).toMatch(/const\s+PAGE_SIZE\s*=\s*20/);
    expect(SCREEN_SRC).toMatch(/onEndReached/);
  });

  it('never surfaces the engine basis', () => {
    expect(SCREEN_SRC).not.toMatch(/heuristic_v1|weighted_v2|model_v3/);
    expect(SCREEN_SRC).not.toMatch(/\bbasis\b/);
  });
});

// A light RTL render of the non-owner placeholder branch — proves the
// placeholder path mounts cleanly without an axios call.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'c@x.io', role: 'coach' }),
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#F5EFE4',
      surface: '#F1E8D5',
      primary: '#2C4A36',
      primaryTint: 'rgba(44,74,54,0.06)',
      textPrimary: '#1A1A18',
      textSecondary: '#3D3D3A',
      textMuted: '#B1A89F',
      textOnPrimary: '#F5EFE4',
      border: '#B08D57',
      divider: 'rgba(176,141,87,0.2)',
      success: '#2C4A36',
      warning: '#C5A253',
      error: '#4A0404',
    },
  }),
}));
jest.mock('../services/ptmApi', () => ({
  ptmApi: {
    getRiskBoard: jest.fn(() =>
      Promise.resolve({ data: { items: [], next_cursor: null } }),
    ),
  },
}));
jest.mock('../components/HapticPressable', () => {
  const RNActual = require('react-native');
  const ReactActual = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      // strip non-RN props (intent) before forwarding
      ReactActual.createElement(
        RNActual.Pressable,
        Object.fromEntries(
          Object.entries(props).filter(([k]) => k !== 'intent'),
        ),
      ),
  };
});

const RiskBoardScreen = require('../screens/coach/RiskBoardScreen').default;

describe('RiskBoardScreen — non-owner branch', () => {
  it('renders the placeholder for non-owner roles', () => {
    const { getByTestId, getByText } = render(<RiskBoardScreen />);
    expect(getByTestId('risk-board-placeholder')).toBeTruthy();
    expect(getByText(/Coach risk board coming/i)).toBeTruthy();
  });
});
