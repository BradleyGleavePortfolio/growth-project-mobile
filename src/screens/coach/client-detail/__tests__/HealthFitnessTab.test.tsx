/**
 * HealthFitnessTab — coach anomaly band data-integrity (R1 visual P1 #2).
 *
 * The MOST DANGEROUS finding in the audit: a failed samples query previously
 * rendered the green "no notable shifts" reassurance, lying to a coach reading
 * a real client's data. These tests pin the explicit branch:
 *   • isError   → neutral "Couldn't load insights" copy, NEVER the all-clear,
 *   • isLoading → a skeleton, not the all-clear,
 *   • success+empty → the genuine "no notable shifts" copy.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

const mockUseWearableSamples = jest.fn();
jest.mock('../../../../hooks/useWearableSamples', () => ({
  useWearableSamples: (...args: unknown[]) => mockUseWearableSamples(...args),
}));

// PR-HK-5a: the tab now mounts <WearableInsightPanel>, which calls the AI
// insight hooks (React Query). These band tests are not about the panel, so we
// hold the panel in its loading state — it renders a harmless skeleton with no
// `coach-insight-*` text that could collide with the anomaly-band assertions.
jest.mock('../../../../hooks/useWearableInsight', () => ({
  useCoachInsight: () => ({ data: undefined, isLoading: true, isError: false }),
  useApproveDraft: () => ({ mutate: jest.fn(), isPending: false, reset: jest.fn() }),
}));

// Isolate the band: stub the embedded client screen (it pulls navigation +
// its own data) and render WearableCard's children inline.
jest.mock('../../../client/wearables/HealthFitnessScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../../client/wearables/components/WearableCard', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});

import { HealthFitnessTab } from '../HealthFitnessTab';

// Minimal style + colour stubs — the band uses theme tokens internally now, so
// the coach `styles`/`colors` props only need the keys the tab reads.
const styles = { sectionTitle: {} } as never;
const colors = { surface: '#fff', border: '#eee' } as never;

async function renderTab() {
  return await render(
    <HealthFitnessTab clientId="client_1" colors={colors} styles={styles} />,
  );
}

describe('HealthFitnessTab coach anomaly band', () => {
  beforeEach(() => mockUseWearableSamples.mockReset());

  it('renders NEUTRAL error copy on isError — never the green all-clear', async () => {
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
    });
    const { getByText, queryByText } = await renderTab();
    expect(getByText(/Couldn't load insights/i)).toBeTruthy();
    // The reassurance copy must NOT appear on a failed fetch.
    expect(queryByText(/No notable shifts/i)).toBeNull();
  });

  it('renders a loading skeleton (not the all-clear) while loading', async () => {
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
    });
    const { getByLabelText, queryByText } = await renderTab();
    expect(getByLabelText('Loading coach insights')).toBeTruthy();
    expect(queryByText(/No notable shifts/i)).toBeNull();
  });

  it('renders the genuine no-shifts copy only on a successful empty result', async () => {
    mockUseWearableSamples.mockReturnValue({
      data: { series: [] },
      isError: false,
      isLoading: false,
    });
    const { getByText } = await renderTab();
    expect(getByText(/No notable shifts/i)).toBeTruthy();
  });
});
