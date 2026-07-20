/**
 * ExtensionPairingPanel — PR-M4 reconstruct counts section.
 *
 * Mounts the panel in the `paired` state and drives useReconstructCounts through
 * every state to assert the honest, page-local rendering:
 *   - hidden entirely when the hook is disabled (kill switch off / no coach),
 *   - per-family loading, empty ("None yet"), counted ("N loaded so far"),
 *     reasons, refreshing, stale-after-refresh-error (prior data kept visible),
 *     hard-error + retry, and Load-more pagination affordance,
 *   - NEVER a percentage, total, ETA, or a completion/success claim,
 *   - accessible: the section announces via a polite live region.
 *
 * useReconstructCounts is mocked so states are deterministic; the hook's own
 * behaviour is covered in useReconstructCounts.test.tsx.
 */
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import type { ReconstructFamilyCounts } from '../../../hooks/useReconstructCounts';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#f5f5f5', border: '#ddd', primary: '#2c4a36',
      textPrimary: '#111', textSecondary: '#555', textMuted: '#999',
      textOnPrimary: '#fff', info: '#2b6cb0', error: '#c0392b',
    },
  }),
}));

jest.mock('../../../hooks/useExtensionPairing', () => ({
  useExtensionPairing: () => ({
    status: 'paired',
    code: null,
    start: jest.fn(),
    retry: jest.fn(),
    cancel: jest.fn(),
  }),
}));

jest.mock('../../../hooks/useRosterReviewDelta', () => ({
  useRosterReviewDelta: () => ({ delta: 0, refresh: jest.fn() }),
}));

let mockReconstruct: {
  enabled: boolean;
  families: ReconstructFamilyCounts[];
  refresh: () => void;
};
jest.mock('../../../hooks/useReconstructCounts', () => ({
  useReconstructCounts: () => mockReconstruct,
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../analytics/posthog.service', () => ({ track: jest.fn() }));

import ExtensionPairingPanel from '../ExtensionPairingPanel';

const mockFetchMore = jest.fn();
const mockRetry = jest.fn();

function fam(overrides: Partial<ReconstructFamilyCounts> = {}): ReconstructFamilyCounts {
  return {
    family: 'workouts',
    count: 0,
    reasons: [],
    isLoading: false,
    isRefreshing: false,
    errorKind: null,
    hasData: true,
    hasMore: false,
    fetchMore: mockFetchMore,
    retry: mockRetry,
    ...overrides,
  };
}

function renderPaired() {
  return render(<ExtensionPairingPanel platformId="truecoach" />);
}

beforeEach(() => {
  mockFetchMore.mockClear();
  mockRetry.mockClear();
  mockReconstruct = { enabled: true, families: [], refresh: jest.fn() };
});

afterEach(() => cleanup());

describe('reconstruct section — visibility', () => {
  it('renders nothing when the hook is disabled', async () => {
    mockReconstruct = { enabled: false, families: [], refresh: jest.fn() };
    const { queryByTestId } = await renderPaired();
    expect(queryByTestId('reconstruct-counts')).toBeNull();
  });

  it('announces the section via a polite live region', async () => {
    mockReconstruct.families = [fam({ count: 2 })];
    const { getByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-counts').props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('reconstruct section — per-family states', () => {
  it('shows a per-family loading state on first load', async () => {
    mockReconstruct.families = [fam({ isLoading: true, hasData: false })];
    const { getByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-loading')).toBeTruthy();
  });

  it('gives the first-load spinner an accessible label naming the family', async () => {
    mockReconstruct.families = [fam({ isLoading: true, hasData: false })];
    const { getByLabelText } = await renderPaired();
    const spinner = getByLabelText('Loading Workouts');
    expect(spinner.props.accessibilityRole).toBe('progressbar');
  });

  it('shows a calm "None yet" when loaded pages are empty', async () => {
    mockReconstruct.families = [fam({ count: 0 })];
    const { getByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-count')).toHaveTextContent('None yet');
  });

  it('reports page-local count as "N loaded so far" — never a total or percentage', async () => {
    mockReconstruct.families = [fam({ count: 5 })];
    const { getByTestId, toJSON } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-count')).toHaveTextContent('5 loaded so far');
    const s = JSON.stringify(toJSON());
    expect(s).not.toMatch(/\b\d{1,3}%/);
    expect(s).not.toMatch(/of \d+|total|complete|imported|finished|\bdone\b|success/i);
  });

  it('renders stable reasons verbatim', async () => {
    mockReconstruct.families = [
      fam({ count: 1, reasons: [{ code: 'partial', message: 'Some sessions were unreadable.' }] }),
    ];
    const { getByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-reason')).toHaveTextContent(
      'Some sessions were unreadable.',
    );
  });

  it('shows a subtle refreshing marker while re-fetching with data visible', async () => {
    mockReconstruct.families = [fam({ count: 3, isRefreshing: true })];
    const { getByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-count')).toHaveTextContent(/refreshing/);
  });

  it('keeps prior data visible and notes a failed refresh (stale) rather than blanking', async () => {
    mockReconstruct.families = [fam({ count: 3, errorKind: 'network', hasData: true })];
    const { getByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-count')).toHaveTextContent('3 loaded so far');
    expect(getByTestId('reconstruct-workouts-stale')).toBeTruthy();
  });

  it('shows an explicit error + retry when the first load fails (no silent zero)', async () => {
    mockReconstruct.families = [fam({ errorKind: 'server', hasData: false })];
    const { getByTestId, queryByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-error')).toBeTruthy();
    expect(queryByTestId('reconstruct-workouts-count')).toBeNull();
    fireEvent.press(getByTestId('reconstruct-workouts-retry'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('exposes a Load more affordance when an opaque cursor remains', async () => {
    mockReconstruct.families = [fam({ count: 20, hasMore: true })];
    const { getByTestId } = await renderPaired();
    fireEvent.press(getByTestId('reconstruct-workouts-more'));
    expect(mockFetchMore).toHaveBeenCalledTimes(1);
  });

  it('renders both canonical families with neutral, source-agnostic labels', async () => {
    mockReconstruct.families = [
      fam({ family: 'workouts', count: 2 }),
      fam({ family: 'client_history', count: 4 }),
    ];
    const { getByTestId, toJSON } = await renderPaired();
    expect(getByTestId('reconstruct-workouts')).toBeTruthy();
    expect(getByTestId('reconstruct-client_history')).toBeTruthy();
    const s = JSON.stringify(toJSON());
    expect(s).toMatch(/Workouts/);
    expect(s).toMatch(/Client history/);
    // No source-specific label ever leaks into the counts section.
    expect(s).not.toMatch(/truecoach|trainerize/i);
  });

  it('omits the refreshing marker and stale note while healthy', async () => {
    mockReconstruct.families = [fam({ count: 3 })];
    const { getByTestId, queryByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-count')).not.toHaveTextContent(/refreshing/);
    expect(queryByTestId('reconstruct-workouts-stale')).toBeNull();
  });

  it('never renders the raw errorKind token in the stale state', async () => {
    mockReconstruct.families = [fam({ count: 3, errorKind: 'network', hasData: true })];
    const { toJSON } = await renderPaired();
    const s = JSON.stringify(toJSON());
    // The coarse machine label is for telemetry, not the coach's eyes.
    expect(s).not.toMatch(/\bnetwork\b|errorKind/);
  });

  it('gives the retry control an accessible button role and label', async () => {
    mockReconstruct.families = [fam({ errorKind: 'server', hasData: false })];
    const { getByTestId } = await renderPaired();
    const retry = getByTestId('reconstruct-workouts-retry');
    expect(retry.props.accessibilityRole).toBe('button');
    expect(retry.props.accessibilityLabel).toMatch(/Workouts/);
  });

  it('gives the Load more control an accessible label naming the family', async () => {
    mockReconstruct.families = [fam({ count: 20, hasMore: true })];
    const { getByTestId } = await renderPaired();
    const more = getByTestId('reconstruct-workouts-more');
    expect(more.props.accessibilityLabel).toMatch(/Workouts/);
  });

  it('never emits a percentage/ETA/completion word even with a large count', async () => {
    mockReconstruct.families = [fam({ count: 4137, hasMore: true })];
    const { getByTestId, toJSON } = await renderPaired();
    expect(getByTestId('reconstruct-workouts-count')).toHaveTextContent('4137 loaded so far');
    const s = JSON.stringify(toJSON());
    expect(s).not.toMatch(/%|percent|\bETA\b|remaining|of \d+|complete|imported|finished|success/i);
  });

  it('titles the section with an honest, page-local heading', async () => {
    mockReconstruct.families = [fam({ count: 1 })];
    const { getByTestId } = await renderPaired();
    expect(getByTestId('reconstruct-counts')).toHaveTextContent(/reconstructed so far/);
  });
});
