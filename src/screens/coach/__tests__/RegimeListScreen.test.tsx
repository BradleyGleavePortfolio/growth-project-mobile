/**
 * RegimeListScreen — render + interaction tests (F2 named-regimes surface).
 *
 * The flag is forced ON (the flag-OFF null-render is pinned in
 * src/__tests__/namedRegimesFlagOff.test.tsx). `useRegimes` is mocked so the
 * list/empty/loading/error states and row navigation are asserted without
 * TanStack Query or a live API.
 *
 * Also tests the pure helpers `attachmentLabel` / `regimeTitle`.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { namedRegimes: true },
  isFeatureEnabled: () => true,
}));

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

let regimesState: Record<string, unknown> = {
  data: [],
  isLoading: false,
  isError: false,
};
jest.mock('../../../hooks/useRegimes', () => ({
  useRegimes: () => regimesState,
}));

import RegimeListScreen, {
  attachmentLabel,
  regimeTitle,
} from '../RegimeListScreen';
import type { RegimeListItem } from '../../../types/regimes';

function regime(overrides: Partial<RegimeListItem> = {}): RegimeListItem {
  return {
    id: 'reg-1',
    name: 'Hypertrophy Block',
    regime_display_name: 'Off-Season Mass',
    weeks: 8,
    days_per_week: 4,
    head_revision_id: 'rev-9',
    archived_at: null,
    package_attachments_count: 2,
    ...overrides,
  };
}

function makeNav() {
  return { navigate: jest.fn() } as never;
}

beforeEach(() => {
  regimesState = { data: [], isLoading: false, isError: false };
});

describe('RegimeListScreen', () => {
  it('renders a loading spinner while the list is loading', async () => {
    regimesState = { data: undefined, isLoading: true, isError: false };
    const { getByTestId } = await render(
      <RegimeListScreen navigation={makeNav()} route={{ params: undefined } as never} />,
    );
    expect(getByTestId('regime-list-spinner')).toBeTruthy();
  });

  it('renders an empty state when there are no regimes', async () => {
    regimesState = { data: [], isLoading: false, isError: false };
    const { getByTestId } = await render(
      <RegimeListScreen navigation={makeNav()} route={{ params: undefined } as never} />,
    );
    expect(getByTestId('regime-list-empty')).toBeTruthy();
  });

  it('renders an error state when the list fails to load', async () => {
    regimesState = { data: undefined, isLoading: false, isError: true };
    const { getByTestId } = await render(
      <RegimeListScreen navigation={makeNav()} route={{ params: undefined } as never} />,
    );
    expect(getByTestId('regime-list-error')).toBeTruthy();
  });

  it('renders a row per regime with its display name', async () => {
    regimesState = { data: [regime()], isLoading: false, isError: false };
    const { getByTestId, getByText } = await render(
      <RegimeListScreen navigation={makeNav()} route={{ params: undefined } as never} />,
    );
    expect(getByTestId('regime-row-reg-1')).toBeTruthy();
    expect(getByText('Off-Season Mass')).toBeTruthy();
  });

  it('navigates to the editor with a null regimeId from "+ New Regime"', async () => {
    const nav = makeNav();
    const { getByTestId } = await render(
      <RegimeListScreen navigation={nav} route={{ params: undefined } as never} />,
    );
    await fireEvent.press(getByTestId('regime-new-button'));
    expect((nav as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith(
      'RegimeEditor',
      { regimeId: null },
    );
  });

  it('navigates to the editor with the regime id when a row is tapped', async () => {
    regimesState = { data: [regime()], isLoading: false, isError: false };
    const nav = makeNav();
    const { getByTestId } = await render(
      <RegimeListScreen navigation={nav} route={{ params: undefined } as never} />,
    );
    await fireEvent.press(getByTestId('regime-row-reg-1'));
    expect((nav as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith(
      'RegimeEditor',
      { regimeId: 'reg-1' },
    );
  });
});

describe('attachmentLabel', () => {
  it('reads "Not attached" at zero', () => {
    expect(attachmentLabel(0)).toBe('Not attached to any package');
  });
  it('is singular at one and plural beyond', () => {
    expect(attachmentLabel(1)).toBe('1 package');
    expect(attachmentLabel(4)).toBe('4 packages');
  });
});

describe('regimeTitle', () => {
  it('prefers the display name', () => {
    expect(regimeTitle(regime())).toBe('Off-Season Mass');
  });
  it('falls back to the program name when display name is null/blank', () => {
    expect(regimeTitle(regime({ regime_display_name: null }))).toBe('Hypertrophy Block');
    expect(regimeTitle(regime({ regime_display_name: '   ' }))).toBe('Hypertrophy Block');
  });
});
