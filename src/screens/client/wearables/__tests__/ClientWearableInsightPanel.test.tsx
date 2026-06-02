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
import { AccessibilityInfo, Linking } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

const mockUseClientInsight = jest.fn();

jest.mock('../../../../hooks/useWearableInsight', () => ({
  useClientInsight: (args: unknown) => mockUseClientInsight(args),
}));

// `useReduceMotion` resolves the OS reduce-motion probe asynchronously, which
// lands a post-render setState OUTSIDE act(...) and would emit the noisy
// "update was not wrapped in act" warning for every render in this suite. The
// reduce-motion behaviour itself is covered by the hook's own unit test, so we
// pin it to a deterministic value here to keep this suite's gate warning-free
// (P2-7, scoped to HK-5b's own test).
jest.mock('../components/useReduceMotion', () => ({
  useReduceMotion: () => true,
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

/** 280-char filler so a field overflows the 3-line clamp deterministically. */
const LONG_280 = 'A'.repeat(280);

/** Flush the microtask queue so a resolved/rejected Linking promise settles. */
async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Fire RN's onTextLayout for a clamped Section so the panel learns the text
 * overflowed CLAMP_LINES (3) and surfaces the Read more toggle. `lines.length`
 * is all the component reads.
 */
function overflowLayout(node: ReactTestInstance, lineCount = 5): void {
  fireEvent(node, 'textLayout', {
    nativeEvent: {
      lines: Array.from({ length: lineCount }, () => ({
        text: '',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        ascender: 0,
        descender: 0,
        capHeight: 0,
        xHeight: 0,
      })),
    },
  });
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
    // Confidence chip label includes the calibrated percentage (P1-2) so a
    // screen-reader user hears the 70% calibration, not just the word.
    expect(
      getByLabelText('Confidence: Fairly sure, 70 percent'),
    ).toBeTruthy();
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

describe('CTA production navigation (Linking.openURL)', () => {
  it('calls Linking.openURL exactly once with the exact deep link (no onCtaPress)', async () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined);
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
    // No onCtaPress prop → the production Linking.openURL branch runs.
    const { getByTestId } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    fireEvent.press(getByTestId('client-insight-cta'));
    await flushPromises();
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('tgp://wearables/sleep-tips');
    openURL.mockRestore();
  });

  it('does NOT call Linking.openURL for an unsafe deep link (refusal logged)', () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined);
    // Build a valid object, then mutate the field to an unsafe scheme so the
    // component's own defence-in-depth guard refuses it (R0: no wildcard cast).
    const seeded: ClientInsightResponse = fullInsight({
      optional_cta: { label: 'Open something', deep_link: 'tgp://placeholder' },
    });
    if (seeded.optional_cta) {
      Object.assign(seeded.optional_cta, { deep_link: 'javascript:alert(1)' });
    }
    mockUseClientInsight.mockReturnValue(queryState({ data: seeded }));
    const { getByTestId } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    fireEvent.press(getByTestId('client-insight-cta'));
    expect(openURL).not.toHaveBeenCalled();
    openURL.mockRestore();
  });

  it('re-enables the CTA after a successful open (latch reset in .finally)', async () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined);
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
    const { getByTestId } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // First press opens; the .finally re-enables the CTA so a second press
    // opens again (it is NOT permanently latched disabled after success).
    fireEvent.press(getByTestId('client-insight-cta'));
    await flushPromises();
    fireEvent.press(getByTestId('client-insight-cta'));
    await flushPromises();
    expect(openURL).toHaveBeenCalledTimes(2);
    openURL.mockRestore();
  });
});

describe('source_metrics provenance', () => {
  it('renders a labelled provenance row joining the metrics', () => {
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          source_metrics: ['RESTING_HEART_RATE_BPM', 'HEART_RATE_BPM'],
        }),
      }),
    );
    const { getByTestId, getByText, getByLabelText } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('client-insight-source-metrics')).toBeTruthy();
    expect(getByText('Source metrics')).toBeTruthy();
    expect(
      getByText('RESTING_HEART_RATE_BPM, HEART_RATE_BPM'),
    ).toBeTruthy();
    expect(
      getByLabelText(
        'Source metrics: RESTING_HEART_RATE_BPM, HEART_RATE_BPM',
      ),
    ).toBeTruthy();
  });

  it('shows the first three metrics + a "+N more" suffix when there are extras', () => {
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          source_metrics: [
            'STEPS',
            'HEART_RATE_BPM',
            'VO2_MAX',
            'TRAINING_LOAD',
            'BODY_WEIGHT_KG',
          ],
        }),
      }),
    );
    const { getByText } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(
      getByText('STEPS, HEART_RATE_BPM, VO2_MAX +2 more'),
    ).toBeTruthy();
  });
});

describe('long-content clamp + Read more toggle (state #5)', () => {
  it('clamps observation + norm to 3 lines, leaves intervention unclamped, and toggles Read more / Show less', () => {
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          observation: LONG_280,
          norm_comparison: LONG_280,
          intervention: LONG_280,
          optional_cta: {
            label: 'Open plan',
            deep_link: 'tgp://wearables/plan',
          },
        }),
      }),
    );
    const { getByTestId, queryByTestId, getByText } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );

    // All three sections + the CTA render.
    const observation = getByTestId('client-insight-observation');
    const norm = getByTestId('client-insight-norm');
    const intervention = getByTestId('client-insight-intervention');
    expect(getByTestId('client-insight-cta')).toBeTruthy();

    // Collapsed: the two non-emphasized fields are clamped to 3 lines; the
    // emphasized intervention is never clamped.
    expect(observation.props.numberOfLines).toBe(3);
    expect(norm.props.numberOfLines).toBe(3);
    expect(intervention.props.numberOfLines).toBeUndefined();

    // No toggle until onTextLayout reports an overflow (no orphaned Read more).
    expect(queryByTestId('client-insight-readmore')).toBeNull();

    // Report that both clamped fields overflowed 3 lines.
    overflowLayout(observation);
    overflowLayout(norm);

    // Now the single Read more toggle appears.
    const toggle = getByTestId('client-insight-readmore');
    expect(getByText('Read more')).toBeTruthy();

    // Expand: both clamped fields lose their cap; label becomes Show less.
    fireEvent.press(toggle);
    expect(
      getByTestId('client-insight-observation').props.numberOfLines,
    ).toBeUndefined();
    expect(
      getByTestId('client-insight-norm').props.numberOfLines,
    ).toBeUndefined();
    expect(getByText('Show less')).toBeTruthy();

    // Collapse again: re-clamps and returns to Read more.
    fireEvent.press(getByTestId('client-insight-readmore'));
    expect(
      getByTestId('client-insight-observation').props.numberOfLines,
    ).toBe(3);
    expect(
      getByTestId('client-insight-norm').props.numberOfLines,
    ).toBe(3);
    expect(getByText('Read more')).toBeTruthy();
  });

  it('does NOT render the toggle when content fits within 3 lines', () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight() }),
    );
    const { getByTestId, queryByTestId } = render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // Report a within-cap layout (2 lines) for both clamped fields.
    overflowLayout(getByTestId('client-insight-observation'), 2);
    overflowLayout(getByTestId('client-insight-norm'), 2);
    expect(queryByTestId('client-insight-readmore')).toBeNull();
  });
});
