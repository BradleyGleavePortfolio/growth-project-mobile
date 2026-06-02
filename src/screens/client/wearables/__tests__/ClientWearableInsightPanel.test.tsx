/**
 * ClientWearableInsightPanel — client AI panel component tests (PR-HK-5b).
 *
 * The data hook (`useClientInsight`) is mocked so each render path is
 * deterministic and the test suite exits clean (no React Query timers / no
 * "Jest did not exit" warning, #48). Covers the full state matrix:
 *   - loading skeleton (anti-spinner, R0): no ActivityIndicator in the tree,
 *   - empty branch literal copy + secondary line, NO chip, NO CTA,
 *   - error branch sanitized copy + Retry → refetch,
 *   - loaded with optional_cta = null → three sections, NO CTA,
 *   - loaded with a safe CTA → press fires onCtaPress with the deep link,
 *   - loaded with an UNSAFE deep link → CTA press is refused (onCtaPress NOT
 *     called),
 *   - confidence chip text for two confidence levels,
 *   - accessibility labels on root + chip + CTA + Retry.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

const mockUseClientInsight = jest.fn();

jest.mock('../../../../hooks/useWearableInsight', () => ({
  useClientInsight: (args: unknown) => mockUseClientInsight(args),
}));

import { makeAccessibilitySubscription } from '../testSupport/accessibilityMocks';
import { ClientWearableInsightPanel } from '../ClientWearableInsightPanel';
import type {
  ClientInsight,
  ClientInsightResponse,
  EmptyInsight,
} from '../../../../api/wearableInsightsApi';

function fullInsight(overrides: Partial<ClientInsight> = {}): ClientInsight {
  return {
    observation: 'Your resting heart rate is trending down this week',
    norm_comparison: 'That is below the typical range for your age group',
    intervention: 'Keep your easy runs easy — your aerobic base is building',
    optional_cta: null,
    confidence_level: 'confident',
    source_metrics: ['RESTING_HEART_RATE_BPM', 'HEART_RATE_BPM'],
    ...overrides,
  };
}

function emptyInsight(): EmptyInsight {
  return {
    observation: 'Not enough data yet — keep syncing.',
    confidence_level: 'i_think',
    source_metrics: [],
    is_empty: true,
  };
}

function queryState(over: Record<string, unknown>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    ...over,
  };
}

beforeEach(() => {
  mockUseClientInsight.mockReset();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true); // reduce-motion ON → static skeleton, deterministic
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue(makeAccessibilitySubscription());
});

const baseProps = { bucket: 'HEALTH_FITNESS' as const };

describe('loading / empty / error states', () => {
  it('renders a skeleton (not a spinner) while loading', () => {
    mockUseClientInsight.mockReturnValue(queryState({ isLoading: true }));
    const { getByTestId, queryByTestId, UNSAFE_queryAllByType } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('client-insight-loading')).toBeTruthy();
    expect(queryByTestId('client-insight-panel')).toBeNull();
    // No spinner anywhere in the tree (R0 / brief test #1).
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('renders the literal empty copy + secondary line, NO chip, NO CTA', () => {
    mockUseClientInsight.mockReturnValue(queryState({ data: emptyInsight() }));
    const { getByTestId, getByText, queryByTestId } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('client-insight-empty')).toBeTruthy();
    expect(getByText('Not enough data yet — keep syncing.')).toBeTruthy();
    expect(
      getByText("We'll add insights here as your devices report more."),
    ).toBeTruthy();
    expect(queryByTestId('client-insight-confidence')).toBeNull();
    expect(queryByTestId('client-insight-cta')).toBeNull();
  });

  it('renders sanitized error copy + Retry, and Retry refetches', () => {
    const refetch = jest.fn();
    mockUseClientInsight.mockReturnValue(
      queryState({ isError: true, error: new Error('internal db path leak'), refetch }),
    );
    const { getByTestId, getByText, getByLabelText, queryByText } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('client-insight-error')).toBeTruthy();
    // Raw error text must never reach the surface (#12).
    expect(queryByText('internal db path leak')).toBeNull();
    expect(getByText("We couldn't load this insight.")).toBeTruthy();
    fireEvent.press(getByLabelText('Retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('loaded state', () => {
  it('renders observation / norm / intervention but NO CTA when optional_cta is null', () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight({ optional_cta: null }) }),
    );
    const { getByTestId, getByText, queryByTestId } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('client-insight-panel')).toBeTruthy();
    expect(getByText('Observation')).toBeTruthy();
    expect(
      getByText('Your resting heart rate is trending down this week'),
    ).toBeTruthy();
    expect(getByText('Norm comparison')).toBeTruthy();
    expect(
      getByText('That is below the typical range for your age group'),
    ).toBeTruthy();
    expect(getByText('Intervention')).toBeTruthy();
    expect(
      getByText('Keep your easy runs easy — your aerobic base is building'),
    ).toBeTruthy();
    expect(queryByTestId('client-insight-cta')).toBeNull();
  });

  it('renders a safe CTA and fires onCtaPress with the deep link on press', () => {
    const onCtaPress = jest.fn();
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          optional_cta: {
            label: 'Open sleep tips',
            deep_link: 'tgp://wearables/sleep-tips',
          },
        }),
      }),
    );
    const { getByTestId, getByText } = render(
      <ClientWearableInsightPanel {...baseProps} onCtaPress={onCtaPress} />,
    );
    expect(getByText('Open sleep tips')).toBeTruthy();
    fireEvent.press(getByTestId('client-insight-cta'));
    expect(onCtaPress).toHaveBeenCalledTimes(1);
    expect(onCtaPress).toHaveBeenCalledWith('tgp://wearables/sleep-tips');
  });

  it('refuses to open an UNSAFE deep link — onCtaPress is NOT called', () => {
    const onCtaPress = jest.fn();
    // Build a VALID response object first, then mutate the field via
    // Object.assign so we exercise the component's own defence-in-depth guard
    // without reaching for a wildcard type-escape (R0-forbidden). The hook is
    // mocked, so the unsafe value never has to pass the real Zod parse.
    const seeded: ClientInsightResponse = fullInsight({
      optional_cta: { label: 'Open something', deep_link: 'tgp://placeholder' },
    });
    if (seeded.optional_cta) {
      Object.assign(seeded.optional_cta, { deep_link: 'https://evil.com' });
    }
    mockUseClientInsight.mockReturnValue(queryState({ data: seeded }));
    const { getByTestId } = render(
      <ClientWearableInsightPanel {...baseProps} onCtaPress={onCtaPress} />,
    );
    fireEvent.press(getByTestId('client-insight-cta'));
    expect(onCtaPress).not.toHaveBeenCalled();
  });

  it('renders the confidence chip text for two confidence levels', () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight({ confidence_level: 'confident' }) }),
    );
    const { getByText, rerender } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // confident → 85%
    expect(getByText('Confident · 85%')).toBeTruthy();

    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight({ confidence_level: 'verified' }) }),
    );
    rerender(<ClientWearableInsightPanel {...baseProps} />);
    // verified → 100%
    expect(getByText('Verified · 100%')).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('exposes accessibility labels on the root, chip, CTA and Retry', () => {
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          confidence_level: 'fairly_sure',
          optional_cta: {
            label: 'Open recovery plan',
            deep_link: 'tgp://wearables/recovery',
          },
        }),
      }),
    );
    const { getByLabelText } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // Root region carries the human bucket label.
    expect(getByLabelText('AI insight, Health & Fitness')).toBeTruthy();
    // Confidence chip label.
    expect(getByLabelText('Fairly sure confidence')).toBeTruthy();
    // CTA label equals the CTA copy.
    expect(getByLabelText('Open recovery plan')).toBeTruthy();
  });

  it('exposes a Retry accessibility label in the error state', () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ isError: true, error: new Error('x'), refetch: jest.fn() }),
    );
    const { getByLabelText } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByLabelText('Retry')).toBeTruthy();
  });
});
