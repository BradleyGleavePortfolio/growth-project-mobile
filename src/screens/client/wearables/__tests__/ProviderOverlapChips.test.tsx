/**
 * ProviderOverlapChips — optimistic active-chip read (R1 code P1 #1).
 *
 * The chip must reflect the OPTIMISTICALLY-written preference (the value the
 * preference mutation writes into the per-metric cache before the network
 * confirms), not only the server-resolved `activeProvider` prop. This test
 * seeds the optimistic cache and asserts the active chip follows it.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProviderOverlapChips from '../components/ProviderOverlapChips';
import { wearablePreferenceQueryKey } from '../../../../hooks/useWearablePreference';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

describe('ProviderOverlapChips optimistic preference', () => {
  it('marks the optimistic provider active (not just the server prop)', () => {
    const { qc, Wrapper } = makeWrapper();
    // Optimistic cache says GARMIN even though the server prop is still Apple.
    qc.setQueryData(wearablePreferenceQueryKey('STEPS'), 'GARMIN');

    const { getByLabelText } = render(
      <ProviderOverlapChips
        metric="STEPS"
        providers={['APPLE_HEALTHKIT', 'GARMIN']}
        activeProvider="APPLE_HEALTHKIT"
        isAuto={false}
        tone="warm"
        onError={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    // Garmin chip reflects the optimistic preference (selected), Apple does not.
    expect(getByLabelText('Garmin').props.accessibilityState.selected).toBe(true);
    expect(
      getByLabelText('Apple Health').props.accessibilityState.selected,
    ).toBe(false);
  });

  it('falls back to the server activeProvider when no optimistic value exists', () => {
    const { Wrapper } = makeWrapper();

    const { getByLabelText } = render(
      <ProviderOverlapChips
        metric="STEPS"
        providers={['APPLE_HEALTHKIT', 'GARMIN']}
        activeProvider="APPLE_HEALTHKIT"
        isAuto={false}
        tone="warm"
        onError={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    expect(
      getByLabelText('Apple Health').props.accessibilityState.selected,
    ).toBe(true);
  });
});
