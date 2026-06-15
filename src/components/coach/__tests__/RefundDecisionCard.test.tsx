/**
 * RefundDecisionCard — render + interaction tests (F2 partial-refund surface).
 *
 * The flag is forced ON here (the flag-OFF null-render is pinned separately in
 * src/__tests__/namedRegimesFlagOff.test.tsx). `useDecideRefund` is mocked so
 * the card's button wiring is asserted without standing up TanStack Query.
 *
 * useTheme is mocked to the real light tokens so semanticColors keys resolve
 * (bgSurface / textOnAccent / textMuted) without a ThemeProvider.
 *
 * Also runs the Roman voice contract over the F2 copy this card renders: no
 * exclamation, no emoji, no banned hype/corporate/slang word — the existing
 * roman/copy doctrine sweep iterates an explicit P3 list and does not reach the
 * new F2 strings, so this block owns their voice accounting.
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

const mutate = jest.fn();
let decideState: Record<string, unknown> = {
  mutate,
  isPending: false,
  isSuccess: false,
  data: undefined,
};
jest.mock('../../../hooks/useRegimes', () => ({
  useDecideRefund: () => decideState,
}));

import RefundDecisionCard from '../RefundDecisionCard';
import {
  romanPartialRefundDecided,
  romanRegimePromoted,
  romanRegimeArchived,
  romanRegimePushed,
} from '../../../lib/roman/copy';
import type { PendingRefundDecision } from '../../../types/regimes';

function decision(overrides: Partial<PendingRefundDecision> = {}): PendingRefundDecision {
  return {
    id: 'dec-1',
    client_purchase_id: 'cp-1',
    stripe_refund_id: 're_1',
    decision: 'pending',
    created_at: '2026-06-14T00:00:00.000Z',
    client_user_id: 'u-1',
    amount_cents: 2500,
    ...overrides,
  };
}

beforeEach(() => {
  mutate.mockReset();
  decideState = { mutate, isPending: false, isSuccess: false, data: undefined };
});

describe('RefundDecisionCard', () => {
  it('renders the refunded amount and both decision buttons', async () => {
    const { getByTestId, getByText } = await render(
      <RefundDecisionCard decision={decision()} />,
    );
    expect(getByTestId('refund-decision-card')).toBeTruthy();
    expect(getByText(/\$25\.00/)).toBeTruthy();
    expect(getByTestId('refund-keep-drops')).toBeTruthy();
    expect(getByTestId('refund-unassign-drops')).toBeTruthy();
  });

  it('fires keep_drops with the stripe refund id', async () => {
    const { getByTestId } = await render(<RefundDecisionCard decision={decision()} />);
    await fireEvent.press(getByTestId('refund-keep-drops'));
    expect(mutate).toHaveBeenCalledWith({
      refundId: 're_1',
      decision: 'keep_drops',
    });
  });

  it('fires unassign_drops with the stripe refund id', async () => {
    const { getByTestId } = await render(<RefundDecisionCard decision={decision()} />);
    await fireEvent.press(getByTestId('refund-unassign-drops'));
    expect(mutate).toHaveBeenCalledWith({
      refundId: 're_1',
      decision: 'unassign_drops',
    });
  });

  it('shows a spinner and disables the buttons while the decision is pending', async () => {
    decideState = { mutate, isPending: true, isSuccess: false, data: undefined };
    const { getByTestId } = await render(<RefundDecisionCard decision={decision()} />);
    expect(getByTestId('refund-decision-spinner')).toBeTruthy();
    expect(getByTestId('refund-keep-drops').props.accessibilityState?.disabled).toBe(true);
  });

  it('renders the Roman confirmation once the decision succeeds', async () => {
    decideState = {
      mutate,
      isPending: false,
      isSuccess: true,
      data: { id: 'dec-1', decision: 'unassign_drops', drops_canceled: 3 },
    };
    const { getByTestId, queryByTestId } = await render(
      <RefundDecisionCard decision={decision()} />,
    );
    expect(getByTestId('refund-decision-confirmation')).toBeTruthy();
    // The action buttons give way to the confirmation line.
    expect(queryByTestId('refund-keep-drops')).toBeNull();
  });

  it('honours a custom testID', async () => {
    const { getByTestId } = await render(
      <RefundDecisionCard decision={decision()} testID="custom-card" />,
    );
    expect(getByTestId('custom-card')).toBeTruthy();
  });
});

// ── Roman voice contract over the F2 copy strings ───────────────────────────
const EMOJI_RE = new RegExp(
  [
    '[\\u{1F300}-\\u{1FAFF}]',
    '[\\u{2600}-\\u{27BF}]',
    '[\\u{2190}-\\u{21FF}]',
    '[\\u{2B00}-\\u{2BFF}]',
    '[\\u{1F1E6}-\\u{1F1FF}]',
    '[\\u{FE00}-\\u{FE0F}]',
  ].join('|'),
  'u',
);
const BANNED_WORDS = [
  'synergy', 'leverage', 'circle back', 'touch base', 'bandwidth',
  'amazing', 'incredible', 'awesome', 'epic', 'insane', 'game-changer',
  'crushing it', "let's go", 'beast mode', 'slay', 'no cap', 'rizz',
];

describe('F2 Roman copy — voice contract (no exclamation / emoji / hype)', () => {
  const strings = [
    romanRegimePromoted,
    romanRegimeArchived,
    romanRegimePushed({ drops_updated: 4, buyers_affected: 1 }),
    romanRegimePushed({ drops_updated: 9, buyers_affected: 3 }),
    romanPartialRefundDecided({ decision: 'keep_drops' }),
    romanPartialRefundDecided({ decision: 'unassign_drops' }),
  ];

  it.each(strings)('"%s" carries zero exclamation marks', (value) => {
    expect((value.match(/!/g) ?? []).length).toBe(0);
  });

  it.each(strings)('"%s" contains no emoji', (value) => {
    expect(EMOJI_RE.test(value)).toBe(false);
  });

  it.each(strings)('"%s" contains no banned hype / corporate / slang word', (value) => {
    const lower = value.toLowerCase();
    for (const word of BANNED_WORDS) {
      expect(lower).not.toContain(word.toLowerCase());
    }
  });

  it.each(strings)('"%s" is non-empty and trimmed', (value) => {
    expect(value.length).toBeGreaterThan(0);
    expect(value).toBe(value.trim());
  });

  it('the push line reports singular vs plural buyers correctly', () => {
    expect(romanRegimePushed({ drops_updated: 4, buyers_affected: 1 })).toContain(
      '1 active buyer',
    );
    expect(romanRegimePushed({ drops_updated: 9, buyers_affected: 3 })).toContain(
      '3 active buyers',
    );
  });

  it('the partial-refund line differs per decision', () => {
    const keep = romanPartialRefundDecided({ decision: 'keep_drops' });
    const unassign = romanPartialRefundDecided({ decision: 'unassign_drops' });
    expect(keep).not.toBe(unassign);
    expect(keep.toLowerCase()).toContain('kept');
    expect(unassign.toLowerCase()).toContain('unassigned');
  });
});
