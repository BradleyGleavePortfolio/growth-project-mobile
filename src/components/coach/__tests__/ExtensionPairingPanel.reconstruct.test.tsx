/**
 * ExtensionPairingPanel — reconstruct/roster claim absence (UX-03a
 * paired-state truth correction).
 *
 * This suite formerly drove the PR-M4 `useReconstructCounts` section and the
 * PR-M3 roster review delta through every state inside the panel's `paired`
 * view. UX-03a removes both: `pair/status` returning `paired` proves only
 * that the code was redeemed for this coach's account (brief §2 row 4), and
 * no per-family count, roster delta, or "reconstructed so far" claim is
 * backed by that fact. Per the grant, this file is rewritten — not
 * deleted — to assert the absence is real and durable:
 *   - the panel source no longer imports useRosterReviewDelta or
 *     useReconstructCounts,
 *   - the rendered `paired` tree contains neither the reconstruct section nor
 *     any roster-delta test id or copy,
 *   - the panel still renders correctly even if those hooks were to be
 *     called elsewhere in the module graph (defence in depth: mocking them
 *     with non-empty state must have zero effect on the panel's output).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, cleanup } from '@testing-library/react-native';

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

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'coach@example.com', name: 'Jordan Coach' }),
}));

// Defence in depth: even if these hooks were still reachable from the module
// graph and returned non-empty "progress", the panel must not surface it —
// because it no longer imports or calls either hook. jest.mock is safe to
// keep here (it no-ops if unresolved by the bundler in a future cleanup) and
// proves the panel's independence from their return values.
jest.mock('../../../hooks/useRosterReviewDelta', () => ({
  useRosterReviewDelta: () => ({ delta: 999, refresh: jest.fn() }),
}));
jest.mock('../../../hooks/useReconstructCounts', () => ({
  useReconstructCounts: () => ({
    enabled: true,
    families: [
      {
        family: 'workouts',
        count: 4137,
        reasons: [{ code: 'partial', message: 'Some sessions were unreadable.' }],
        isLoading: false,
        isRefreshing: false,
        errorKind: null,
        hasData: true,
        hasMore: true,
        fetchMore: jest.fn(),
        retry: jest.fn(),
      },
    ],
    refresh: jest.fn(),
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../analytics/posthog.service', () => ({ track: jest.fn() }));

import ExtensionPairingPanel from '../ExtensionPairingPanel';

function renderPaired() {
  return render(<ExtensionPairingPanel platformId="truecoach" />);
}

afterEach(() => cleanup());

describe('ExtensionPairingPanel source — import absence proof', () => {
  it('does not import useRosterReviewDelta', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'ExtensionPairingPanel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/useRosterReviewDelta/);
  });

  it('does not import useReconstructCounts', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'ExtensionPairingPanel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/useReconstructCounts/);
  });
});

describe('reconstruct section — removed', () => {
  it('never renders the reconstruct-counts section, even when the (unused) hook reports enabled families', async () => {
    const { queryByTestId } = await renderPaired();
    expect(queryByTestId('reconstruct-counts')).toBeNull();
    expect(queryByTestId('reconstruct-workouts')).toBeNull();
    expect(queryByTestId('reconstruct-workouts-count')).toBeNull();
    expect(queryByTestId('reconstruct-workouts-more')).toBeNull();
  });

  it('never renders the honest reconstruct heading text', async () => {
    const { toJSON } = await renderPaired();
    const s = JSON.stringify(toJSON());
    expect(s).not.toMatch(/reconstructed so far/i);
  });

  it('never renders a per-family loaded-so-far count, even with a large mocked count', async () => {
    const { toJSON } = await renderPaired();
    const s = JSON.stringify(toJSON());
    expect(s).not.toMatch(/4137/);
    expect(s).not.toMatch(/loaded so far/i);
  });

  it('never renders the mocked family reason text', async () => {
    const { toJSON } = await renderPaired();
    const s = JSON.stringify(toJSON());
    expect(s).not.toMatch(/Some sessions were unreadable/i);
  });
});

describe('roster review delta — removed', () => {
  it('never renders the pairing-review-delta test id', async () => {
    const { queryByTestId } = await renderPaired();
    expect(queryByTestId('pairing-review-delta')).toBeNull();
  });

  it('never renders "since you started this import" even with a non-zero mocked delta', async () => {
    const { toJSON } = await renderPaired();
    const s = JSON.stringify(toJSON());
    expect(s).not.toMatch(/since you started this import/i);
  });

  it('never renders a "new clients" roster-delta claim', async () => {
    const { toJSON } = await renderPaired();
    const s = JSON.stringify(toJSON());
    expect(s).not.toMatch(/\d+ new clients?/i);
  });

  it('never claims the import is "running" in the browser extension', async () => {
    const { toJSON } = await renderPaired();
    const s = JSON.stringify(toJSON());
    expect(s).not.toMatch(/\brunning\b/i);
  });
});

describe('paired state — what actually renders instead', () => {
  it('shows the truthful confirmation and checklist in place of the removed sections', async () => {
    const { getByTestId } = await renderPaired();
    expect(getByTestId('pairing-paired')).toHaveTextContent('Connected to your computer', { exact: false });
    expect(getByTestId('pairing-checklist')).toBeTruthy();
    expect(getByTestId('pairing-check-platform')).toHaveTextContent('Not yet known', { exact: false });
  });
});
