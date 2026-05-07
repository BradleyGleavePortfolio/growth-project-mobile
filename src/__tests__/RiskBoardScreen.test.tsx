// RiskBoardScreen — Phase 1E doctrine guards.
//
// Assertions enforced here:
//   1. The role gate exists in source — students get a "restricted"
//      screen; both coaches and the OWNER account load real data.
//   2. The fetch picks /coach/clients/risk-board for coaches and
//      /admin/ptm/risk-board for the OWNER (no fake data).
//   3. The four filter chips wire to setFilter and re-fetch.
//   4. Tapping a row navigates with `userId`.
//   5. The empty state quotes the "04:00 UTC" recompute window.
//   6. When risk_score is null (coach scope) the row renders the
//      bucket label, not a fake percentage.
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
  it('gates the data path behind a coach-or-owner role check', () => {
    expect(SCREEN_SRC).toMatch(/currentUser\?\.role\s*===\s*['"]owner['"]/);
    expect(SCREEN_SRC).toMatch(/currentUser\?\.role\s*===\s*['"]coach['"]/);
    expect(SCREEN_SRC).toMatch(/if\s*\(!canViewBoard\)/);
  });

  it('exposes a "locked" testID for unauthorised roles (no fake data)', () => {
    expect(SCREEN_SRC).toMatch(/testID="risk-board-locked"/);
    // Old "coming soon" placeholder copy MUST be gone — the backend is
    // now wired and a coach should never see a stub.
    expect(SCREEN_SRC).not.toMatch(/Coach risk board coming/);
    expect(SCREEN_SRC).not.toMatch(/risk-board-placeholder/);
  });

  it('routes coaches to /coach/clients/risk-board and owners to /admin/ptm/risk-board', () => {
    // The screen picks the fetcher off ptmApi based on isOwner.
    expect(SCREEN_SRC).toMatch(/isOwner\s*\?\s*ptmApi\.getRiskBoard\s*:\s*ptmApi\.getMyRiskBoard/);
  });

  it('renders all four filter chips and re-fetches on filter change', () => {
    expect(SCREEN_SRC).toMatch(/Filter\[\]\s*=\s*\[\s*['"]all['"]\s*,\s*['"]red['"]\s*,\s*['"]amber['"]\s*,\s*['"]green['"]\s*\]/);
    // Effect re-runs when filter changes (resetting items + cursor + fetching)
    expect(SCREEN_SRC).toMatch(/\}\s*,\s*\[filter,\s*canViewBoard\]\s*\)\s*;/);
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

  it('hides the numeric percentage when risk_score is null (coach scope)', () => {
    // The screen branches: when item.risk_score is null it renders a
    // bucket label; otherwise the percentage. Both halves must be
    // present in source.
    expect(SCREEN_SRC).toMatch(/item\.risk_score\s*==\s*null/);
    expect(SCREEN_SRC).toMatch(/Math\.round\(item\.risk_score\s*\*\s*100\)/);
  });
});

// ─── Shared mock wiring ──────────────────────────────────────────────────────
//
// jest.mock calls are hoisted to the top of the module by Babel/Jest before
// any imports are evaluated. Referencing the `mockUseCurrentUser` variable
// from inside a mock factory is safe because:
//   (a) the factory is lazy — it runs when the module is first required, not
//       at hoist time, so the var is already assigned.
//   (b) jest.mock itself is still hoisted but its *factory argument* closes
//       over the module scope at call time.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));
const mockUseCurrentUser = jest.fn(() => ({
  id: 'u1',
  email: 'c@x.io',
  role: 'student',
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
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
const mockGetRiskBoard = jest.fn((_q?: unknown) =>
  Promise.resolve({ data: { items: [], next_cursor: null } }),
);
const mockGetMyRiskBoard = jest.fn((_q?: unknown) =>
  Promise.resolve({ data: { items: [], next_cursor: null } }),
);
jest.mock('../services/ptmApi', () => ({
  ptmApi: {
    getRiskBoard: (q?: unknown) => mockGetRiskBoard(q),
    getMyRiskBoard: (q?: unknown) => mockGetMyRiskBoard(q),
  },
}));
jest.mock('../components/HapticPressable', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RNActual = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RiskBoardScreen = require('../screens/coach/RiskBoardScreen').default;

// ─── Locked branch ───────────────────────────────────────────────────────────

describe('RiskBoardScreen — locked branch', () => {
  beforeEach(() => {
    mockGetRiskBoard.mockClear();
    mockGetMyRiskBoard.mockClear();
    mockUseCurrentUser.mockReturnValue({
      id: 'u1',
      email: 's@x.io',
      role: 'student',
    });
  });

  it('renders the locked screen for a non-coach, non-owner role', () => {
    const { getByTestId, getByText } = render(<RiskBoardScreen />);
    expect(getByTestId('risk-board-locked')).toBeTruthy();
    expect(getByText(/coaches and the operator account/i)).toBeTruthy();
    expect(mockGetRiskBoard).not.toHaveBeenCalled();
    expect(mockGetMyRiskBoard).not.toHaveBeenCalled();
  });
});

// ─── Coach branch ────────────────────────────────────────────────────────────

describe('RiskBoardScreen — coach branch hits the coach-scoped endpoint', () => {
  beforeEach(() => {
    mockGetRiskBoard.mockClear();
    mockGetMyRiskBoard.mockClear();
    mockUseCurrentUser.mockReturnValue({
      id: 'coach-1',
      email: 'c@x.io',
      role: 'coach',
    });
  });

  it('calls getMyRiskBoard (coach-scoped) and never the OWNER endpoint', async () => {
    render(<RiskBoardScreen />);
    // Effect dispatches the initial fetch synchronously after mount;
    // a microtask flush is enough to settle the call.
    await Promise.resolve();
    expect(mockGetMyRiskBoard).toHaveBeenCalled();
    expect(mockGetRiskBoard).not.toHaveBeenCalled();
  });

  it('renders the empty state when the API returns an empty list', async () => {
    mockGetMyRiskBoard.mockResolvedValueOnce({
      data: { items: [], next_cursor: null },
    });
    const { findByText } = render(<RiskBoardScreen />);
    // Empty-state body text references the nightly recompute window.
    expect(await findByText(/04:00 UTC/i)).toBeTruthy();
  });

  it('renders a client row when the API returns data (coach — bucket label only)', async () => {
    // Coach scope: risk_score is null; the row shows the bucket label, not a %.
    mockGetMyRiskBoard.mockResolvedValueOnce({
      data: {
        items: [
          {
            user_id: 'client-1',
            name: 'Alex Trent',
            email: 'alex@example.com',
            risk_score: null,
            success_score: null,
            bucket: 'red',
            last_signal_at: null,
            outcome_label: null,
          },
        ],
        next_cursor: null,
      },
    });
    const { findByText } = render(<RiskBoardScreen />);
    expect(await findByText('Alex Trent')).toBeTruthy();
    // Coach sees the uppercased bucket label, not a numeric percentage.
    expect(await findByText('Red')).toBeTruthy();
  });

  it('renders the error state when the API rejects', async () => {
    mockGetMyRiskBoard.mockRejectedValueOnce(new Error('Network timeout'));
    const { findByText } = render(<RiskBoardScreen />);
    // Error path sets error in state; ListEmptyComponent shows the error title + message.
    expect(await findByText(/Could not load risk data/i)).toBeTruthy();
    expect(await findByText(/Network timeout/i)).toBeTruthy();
  });
});

// ─── Owner branch ────────────────────────────────────────────────────────────

describe('RiskBoardScreen — owner branch hits the OWNER endpoint', () => {
  beforeEach(() => {
    mockGetRiskBoard.mockClear();
    mockGetMyRiskBoard.mockClear();
    mockUseCurrentUser.mockReturnValue({
      id: 'owner-1',
      email: 'o@x.io',
      role: 'owner',
    });
  });

  it('calls getRiskBoard (OWNER) and never the coach endpoint', async () => {
    render(<RiskBoardScreen />);
    await Promise.resolve();
    expect(mockGetRiskBoard).toHaveBeenCalled();
    expect(mockGetMyRiskBoard).not.toHaveBeenCalled();
  });

  it('renders a client row with a numeric percentage for the owner', async () => {
    // Owner scope: risk_score is returned as a number and displayed as a %.
    mockGetRiskBoard.mockResolvedValueOnce({
      data: {
        items: [
          {
            user_id: 'client-2',
            name: 'Jordan Miles',
            email: 'jordan@example.com',
            risk_score: 0.75,
            success_score: 0.4,
            bucket: 'red',
            last_signal_at: null,
            outcome_label: null,
          },
        ],
        next_cursor: null,
      },
    });
    const { findByText } = render(<RiskBoardScreen />);
    expect(await findByText('Jordan Miles')).toBeTruthy();
    // Owner sees the numeric score: Math.round(0.75 * 100) = 75%.
    expect(await findByText('75%')).toBeTruthy();
  });
});
