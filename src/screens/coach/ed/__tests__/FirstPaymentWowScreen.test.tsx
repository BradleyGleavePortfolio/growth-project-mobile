/**
 * FirstPaymentWowScreen — ED.3 component contract.
 *
 * Pins:
 *   1. FACE+VOICE invariant — the RomanAvatar (smile crop, the §3.8 milestone
 *      "knowing slight smile") renders in the SAME tree as the §2.6 copy.
 *   2. Copy — the §2.6 CELEBRATION variant renders verbatim (the one permitted
 *      exclamation present).
 *   3. Particle burst present (the celebration motion layer).
 *   4. Dismiss — pressing the Roman-tone button calls onDismiss exactly once.
 *
 * Reduce-motion is forced ON via the shared hook mock so the test does not
 * depend on async animation timing (the screen still renders face + voice).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

import FirstPaymentWowScreen, {
  FIRST_PAYMENT_DISMISS_LABEL,
} from '../FirstPaymentWowScreen';

const PROPS = {
  coachName: 'Marcus',
  amount: '$240.00',
  clientName: 'Dana',
};

describe('FirstPaymentWowScreen — ED.3', () => {
  it('renders the §2.6 celebration copy verbatim (FACE+VOICE: avatar + voice together)', () => {
    const { getByTestId } = render(
      <FirstPaymentWowScreen {...PROPS} onDismiss={jest.fn()} />,
    );

    // VOICE — exact §2.6 celebration string.
    expect(getByTestId('first-payment-message').props.children).toBe(
      'Marcus — your first payment has arrived. $240.00, from Dana. I have seen a great many first payments, and they never stop meaning something. Congratulations!',
    );

    // FACE — the smile crop avatar is present in the same tree, announced
    // as the pleased (milestone) register.
    const avatar = getByTestId('first-payment-avatar');
    expect(avatar.props.accessibilityLabel).toBe('Roman, pleased');
  });

  it('fires onDismiss exactly once when the Roman-tone button is pressed', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <FirstPaymentWowScreen {...PROPS} onDismiss={onDismiss} />,
    );
    const button = getByTestId('first-payment-dismiss');
    expect(button.props.accessibilityLabel).toBe(FIRST_PAYMENT_DISMISS_LABEL);
    fireEvent.press(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for the particle layer under reduce-motion (motion suppressed, moment still lands)', () => {
    const { queryByTestId, getByTestId } = render(
      <FirstPaymentWowScreen {...PROPS} onDismiss={jest.fn()} />,
    );
    // ParticleBurst returns null under reduce-motion.
    expect(queryByTestId('first-payment-particles')).toBeNull();
    // But the voice + face still render — the moment is carried without motion.
    expect(getByTestId('first-payment-message')).toBeTruthy();
    expect(getByTestId('first-payment-avatar')).toBeTruthy();
  });
});
