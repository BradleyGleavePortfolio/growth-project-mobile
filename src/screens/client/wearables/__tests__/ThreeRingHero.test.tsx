/**
 * ThreeRingHero — render contract tests.
 *
 * Asserts the Bradley LAW §4.3 invariants: the empty state renders the
 * value-first connect prompt (NEVER "Coming soon"), and the populated state
 * renders the headline value + ring labels.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import ThreeRingHero, { type RingDatum } from '../cards/ThreeRingHero';

const RINGS: readonly [RingDatum, RingDatum, RingDatum] = [
  { progress: 0.5, color: '#B08D57', label: 'Move' },
  { progress: 0.3, color: '#C5A253', label: 'Exercise' },
  { progress: 0.8, color: '#2C4A36', label: 'Stand' },
];

describe('ThreeRingHero', () => {
  it('renders the headline value and ring labels when populated', async () => {
    const { getByText } = await render(
      <ThreeRingHero
        rings={RINGS}
        centerValue="430 kcal"
        centerLabel="Active kcal"
        tone="warm"
        reduceMotion
        empty={false}
      />,
    );
    expect(getByText('430 kcal')).toBeTruthy();
    expect(getByText('Active kcal')).toBeTruthy();
    expect(getByText('Move')).toBeTruthy();
    expect(getByText('Exercise')).toBeTruthy();
    expect(getByText('Stand')).toBeTruthy();
  });

  it('shows a value-first connect prompt when empty — never a placeholder gate', async () => {
    const { getByText, queryByText } = await render(
      <ThreeRingHero
        rings={[
          { progress: 0, color: '#B08D57', label: 'Move' },
          { progress: 0, color: '#C5A253', label: 'Exercise' },
          { progress: 0, color: '#2C4A36', label: 'Stand' },
        ]}
        centerValue="—"
        centerLabel="Active kcal"
        tone="warm"
        reduceMotion
        empty
      />,
    );
    expect(
      getByText('Connect Apple Health or another tracker to fill your rings.'),
    ).toBeTruthy();
    expect(queryByText(/coming soon/i)).toBeNull();
  });
});
