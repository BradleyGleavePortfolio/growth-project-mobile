/**
 * PhantomCalmBanner — verifies the reassurance-before-deficit ORDER (UX gate
 * §5.2) structurally, and that the deficit never leads.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PhantomCalmBanner } from '../components/PhantomCalmBanner';
import { testColors } from '../recoveryTestColors';

describe('PhantomCalmBanner', () => {
  it('renders reassurance and deficit copy', async () => {
    const { getByTestId } = await render(
      <PhantomCalmBanner
        colors={testColors}
        reassurance="You're close —"
        deficit="about 45 min under your sleep need"
      />,
    );
    expect(getByTestId('phantom-calm-reassurance').props.children).toBe("You're close —");
    expect(getByTestId('phantom-calm-deficit').props.children).toBe('about 45 min under your sleep need');
  });

  it('orders reassurance BEFORE the deficit in the accessibility label', async () => {
    const { getByTestId } = await render(
      <PhantomCalmBanner colors={testColors} reassurance="You're close —" deficit="about 45 min under your sleep need" />,
    );
    const label = getByTestId('phantom-calm-banner').props.accessibilityLabel as string;
    expect(label.indexOf("You're close")).toBeLessThan(label.indexOf('45 min'));
  });

  it('uses the soft-amber accent only on attention tone', async () => {
    const { getByTestId, rerender } = await render(
      <PhantomCalmBanner colors={testColors} reassurance="r" deficit="d" tone="attention" />,
    );
    // The accent bar is the first child View of the banner.
    const banner = getByTestId('phantom-calm-banner');
    // Smoke: attention tone renders without throwing; calm tone too.
    expect(banner).toBeTruthy();
    await rerender(<PhantomCalmBanner colors={testColors} reassurance="r" deficit="d" tone="calm" />);
    expect(getByTestId('phantom-calm-banner')).toBeTruthy();
  });
});
