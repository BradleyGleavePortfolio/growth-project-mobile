/**
 * RegimeEditorScreen — render + interaction tests (F2 named-regimes editor).
 *
 * The flag is forced ON (the flag-OFF null-render is pinned in
 * src/__tests__/namedRegimesFlagOff.test.tsx). The regime hooks are mocked so
 * the name input, revision drawer, push-to-existing button, and the archive
 * confirmation modal are asserted without TanStack Query or a live API.
 *
 * Also tests the pure helper `formatRevisionDate`.
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

const updateMutate = jest.fn();
const archiveMutate = jest.fn();
const pushMutate = jest.fn();

let regimesState: Record<string, unknown>;
let regimeState: Record<string, unknown>;
let updateState: Record<string, unknown>;
let archiveState: Record<string, unknown>;
let pushState: Record<string, unknown>;

jest.mock('../../../hooks/useRegimes', () => ({
  useRegimes: () => regimesState,
  useRegime: () => regimeState,
  useUpdateRegime: () => updateState,
  useArchiveRegime: () => archiveState,
  usePushRegimeToExisting: () => pushState,
}));

import RegimeEditorScreen, { formatRevisionDate } from '../RegimeEditorScreen';

const REGIME = {
  id: 'reg-1',
  name: 'Hypertrophy Block',
  regime_display_name: 'Off-Season Mass',
  weeks: 8,
  days_per_week: 4,
  head_revision_id: 'rev-9',
  archived_at: null,
  package_attachments_count: 2,
};

function makeNav() {
  return { navigate: jest.fn(), goBack: jest.fn() } as never;
}

function route(regimeId: string | null) {
  return { params: { regimeId } } as never;
}

beforeEach(() => {
  updateMutate.mockReset();
  archiveMutate.mockReset();
  pushMutate.mockReset();
  regimesState = { data: [REGIME], isLoading: false, isError: false };
  regimeState = { data: [], isLoading: false };
  updateState = { mutate: updateMutate, isPending: false };
  archiveState = { mutate: archiveMutate, isPending: false };
  pushState = { mutate: pushMutate, isPending: false, isSuccess: false, data: undefined };
});

describe('RegimeEditorScreen', () => {
  it('renders the editor surface with the current display name in the input', async () => {
    const { getByTestId } = await render(
      <RegimeEditorScreen navigation={makeNav()} route={route('reg-1')} />,
    );
    expect(getByTestId('regime-editor-screen')).toBeTruthy();
    expect(getByTestId('regime-name-input').props.value).toBe('Off-Season Mass');
  });

  it('saves the edited name via useUpdateRegime', async () => {
    const { getByTestId } = await render(
      <RegimeEditorScreen navigation={makeNav()} route={route('reg-1')} />,
    );
    fireEvent.changeText(getByTestId('regime-name-input'), 'Peak Week');
    await fireEvent.press(getByTestId('regime-save-name'));
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'reg-1',
      regime_display_name: 'Peak Week',
    });
  });

  it('toggles the read-only revision drawer and lists revisions', async () => {
    regimeState = {
      data: [
        { revision_index: 3, created_at: '2026-06-10T00:00:00.000Z', cause: 'edit' },
        { revision_index: 2, created_at: '2026-06-01T00:00:00.000Z', cause: 'promote' },
      ],
      isLoading: false,
    };
    const { getByTestId, queryByTestId } = await render(
      <RegimeEditorScreen navigation={makeNav()} route={route('reg-1')} />,
    );
    expect(queryByTestId('regime-revisions-drawer')).toBeNull();
    await fireEvent.press(getByTestId('regime-revisions-toggle'));
    expect(getByTestId('regime-revisions-drawer')).toBeTruthy();
    expect(getByTestId('regime-revision-3')).toBeTruthy();
    expect(getByTestId('regime-revision-2')).toBeTruthy();
  });

  it('calls usePushRegimeToExisting with the package + head revision', async () => {
    const { getByTestId } = await render(
      <RegimeEditorScreen navigation={makeNav()} route={route('reg-1')} />,
    );
    await fireEvent.press(getByTestId('regime-push-existing'));
    expect(pushMutate).toHaveBeenCalledWith({
      packageId: 'reg-1',
      contentId: 'rev-9',
    });
  });

  it('opens the archive confirmation modal and confirms archive', async () => {
    const { getByTestId, queryByTestId } = await render(
      <RegimeEditorScreen navigation={makeNav()} route={route('reg-1')} />,
    );
    expect(queryByTestId('regime-archive-modal')).toBeNull();
    await fireEvent.press(getByTestId('regime-archive-button'));
    expect(getByTestId('regime-archive-modal')).toBeTruthy();
    await fireEvent.press(getByTestId('regime-archive-confirm'));
    expect(archiveMutate).toHaveBeenCalledWith('reg-1', expect.any(Object));
  });

  it('dismisses the archive modal on cancel without archiving', async () => {
    const { getByTestId } = await render(
      <RegimeEditorScreen navigation={makeNav()} route={route('reg-1')} />,
    );
    await fireEvent.press(getByTestId('regime-archive-button'));
    await fireEvent.press(getByTestId('regime-archive-cancel'));
    expect(archiveMutate).not.toHaveBeenCalled();
  });

  it('shows the archived note instead of the archive button for an archived regime', async () => {
    regimesState = {
      data: [{ ...REGIME, archived_at: '2026-06-14T00:00:00.000Z' }],
      isLoading: false,
      isError: false,
    };
    const { getByTestId, queryByTestId } = await render(
      <RegimeEditorScreen navigation={makeNav()} route={route('reg-1')} />,
    );
    expect(getByTestId('regime-archived-note')).toBeTruthy();
    expect(queryByTestId('regime-archive-button')).toBeNull();
  });
});

describe('formatRevisionDate', () => {
  it('degrades to an em dash for an unparseable timestamp', () => {
    expect(formatRevisionDate('not-a-date')).toBe('—');
  });
  it('formats a valid ISO timestamp into a readable date', () => {
    const out = formatRevisionDate('2026-06-10T00:00:00.000Z');
    expect(out.length).toBeGreaterThan(3);
    expect(out).not.toBe('—');
  });
});
