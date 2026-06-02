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

function renderTab() {
  return render(
    <HealthFitnessTab clientId="client_1" colors={colors} styles={styles} />,
  );
}

describe('HealthFitnessTab coach anomaly band', () => {
  beforeEach(() => mockUseWearableSamples.mockReset());

  it('renders NEUTRAL error copy on isError — never the green all-clear', () => {
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
    });
    const { getByText, queryByText } = renderTab();
    expect(getByText(/Couldn't load insights/i)).toBeTruthy();
    // The reassurance copy must NOT appear on a failed fetch.
    expect(queryByText(/No notable shifts/i)).toBeNull();
  });

  it('renders a loading skeleton (not the all-clear) while loading', () => {
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
    });
    const { getByLabelText, queryByText } = renderTab();
    expect(getByLabelText('Loading coach insights')).toBeTruthy();
    expect(queryByText(/No notable shifts/i)).toBeNull();
  });

  it('renders the genuine no-shifts copy only on a successful empty result', () => {
    mockUseWearableSamples.mockReturnValue({
      data: { series: [] },
      isError: false,
      isLoading: false,
    });
    const { getByText } = renderTab();
    expect(getByText(/No notable shifts/i)).toBeTruthy();
  });
});
