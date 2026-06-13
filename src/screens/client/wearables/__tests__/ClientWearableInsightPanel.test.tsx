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
import { AccessibilityInfo, Linking, StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

// ── Inline WCAG 2.1 contrast helper (P2 dark-mode AA regression) ──────────────
// Colocated here on purpose: the dark-mode AA assertions must not depend on the
// workspace `_contrast_hk5b_r2.py` script. ~10 lines of the standard relative
// luminance + contrast-ratio formulas, exercised against the resolved style.
function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** The dark card surface (`darkTokens.bgSurface`) every on-surface ink sits on. */
const DARK_SURFACE = '#1C1A18';

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

// Drive the panel's resolved colour scheme deterministically. The component
// reads `useTheme().colorScheme` to pick the scheme-reactive tone; mocking the
// hook lets us mount it under dark mode without standing up the full
// ThemeProvider (which pulls AsyncStorage + the founding-number query). The
// real `darkTokens` are returned so `bgSurface` is the genuine #1C1A18 surface.
const mockColorScheme = { current: 'light' as 'light' | 'dark' };
jest.mock('../../../../theme/useTheme', () => {
  const { lightTokens, darkTokens } = jest.requireActual('../../../../theme/tokens');
  return {
    useTheme: () => ({
      colorScheme: mockColorScheme.current,
      semanticColors:
        mockColorScheme.current === 'dark' ? darkTokens : lightTokens,
    }),
  };
});

import { makeAccessibilitySubscription } from '../testSupport/accessibilityMocks';
import { ClientWearableInsightPanel } from '../ClientWearableInsightPanel';
import { logger } from '../../../../utils/logger';
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
async function overflowLayout(node: TestInstance, lineCount = 5): Promise<void> {
  // v14: the onTextLayout handler calls setState, so the event must be fired
  // inside act(...) for the resulting Read-more toggle state to flush before
  // the next query. Awaiting keeps the assertion order deterministic.
  await act(async () => {
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
  mockColorScheme.current = 'light'; // default; dark-mode suite opts in per-test
  jest.restoreAllMocks();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true); // reduce-motion ON → static skeleton, deterministic
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue(makeAccessibilitySubscription());
});

const baseProps = { bucket: 'HEALTH_FITNESS' as const };

describe('loading / empty / error states', () => {
  it('renders a skeleton (not a spinner) while loading', async () => {
    mockUseClientInsight.mockReturnValue(queryState({ isLoading: true }));
    const { getByTestId, queryByTestId, queryByRole } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('client-insight-loading')).toBeTruthy();
    expect(queryByTestId('client-insight-panel')).toBeNull();
    // No spinner anywhere in the tree (R0 / brief test #1). v14 drops
    // UNSAFE_queryAllByType; ActivityIndicator exposes the 'progressbar'
    // accessibility role, so its absence is asserted via a user-visible query.
    expect(queryByRole('progressbar')).toBeNull();
  });

  it('renders the literal empty copy + secondary line, NO chip, NO CTA', async () => {
    mockUseClientInsight.mockReturnValue(queryState({ data: emptyInsight() }));
    const { getByTestId, getByText, queryByTestId } = await render(
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

  it('renders sanitized error copy + Retry, and Retry refetches', async () => {
    const refetch = jest.fn();
    mockUseClientInsight.mockReturnValue(
      queryState({ isError: true, error: new Error('internal db path leak'), refetch }),
    );
    const { getByTestId, getByText, getByLabelText, queryByText } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('client-insight-error')).toBeTruthy();
    // Raw error text must never reach the surface (#12).
    expect(queryByText('internal db path leak')).toBeNull();
    expect(getByText("We couldn't load this insight.")).toBeTruthy();
    await fireEvent.press(getByLabelText('Retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('loaded state', () => {
  it('renders observation / norm / intervention but NO CTA when optional_cta is null', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight({ optional_cta: null }) }),
    );
    const { getByTestId, getByText, queryByTestId } = await render(
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

  it('renders a safe CTA and fires onCtaPress with the deep link on press', async () => {
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
    const { getByTestId, getByText } = await render(
      <ClientWearableInsightPanel {...baseProps} onCtaPress={onCtaPress} />,
    );
    expect(getByText('Open sleep tips')).toBeTruthy();
    await fireEvent.press(getByTestId('client-insight-cta'));
    expect(onCtaPress).toHaveBeenCalledTimes(1);
    expect(onCtaPress).toHaveBeenCalledWith('tgp://wearables/sleep-tips');
  });

  it('refuses to open an UNSAFE deep link — onCtaPress is NOT called', async () => {
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
    const { getByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} onCtaPress={onCtaPress} />,
    );
    await fireEvent.press(getByTestId('client-insight-cta'));
    expect(onCtaPress).not.toHaveBeenCalled();
  });

  it('renders the confidence chip text for two confidence levels', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight({ confidence_level: 'confident' }) }),
    );
    const { getByText, rerender } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // confident → 85%
    expect(getByText('Confident · 85%')).toBeTruthy();

    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight({ confidence_level: 'verified' }) }),
    );
    await rerender(<ClientWearableInsightPanel {...baseProps} />);
    // verified → 100%
    expect(getByText('Verified · 100%')).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('exposes accessibility labels on the root, chip, CTA and Retry', async () => {
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
    const { getByLabelText } = await render(
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

  it('exposes a Retry accessibility label in the error state', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ isError: true, error: new Error('x'), refetch: jest.fn() }),
    );
    const { getByLabelText } = await render(
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
    const { getByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    await fireEvent.press(getByTestId('client-insight-cta'));
    await flushPromises();
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('tgp://wearables/sleep-tips');
    openURL.mockRestore();
  });

  it('does NOT call Linking.openURL for an unsafe deep link (refusal logged)', async () => {
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
    const { getByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    await fireEvent.press(getByTestId('client-insight-cta'));
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
    const { getByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // First press opens; the .finally re-enables the CTA so a second press
    // opens again (it is NOT permanently latched disabled after success).
    await fireEvent.press(getByTestId('client-insight-cta'));
    await flushPromises();
    await fireEvent.press(getByTestId('client-insight-cta'));
    await flushPromises();
    expect(openURL).toHaveBeenCalledTimes(2);
    openURL.mockRestore();
  });
});

describe('source_metrics provenance', () => {
  it('renders a labelled provenance row joining the metrics', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          source_metrics: ['RESTING_HEART_RATE_BPM', 'HEART_RATE_BPM'],
        }),
      }),
    );
    const { getByTestId, getByText, getByLabelText } = await render(
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

  it('shows the first three metrics + a "+N more" suffix when there are extras', async () => {
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
    const { getByText } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(
      getByText('STEPS, HEART_RATE_BPM, VO2_MAX +2 more'),
    ).toBeTruthy();
  });
});

describe('long-content clamp + Read more toggle (state #5)', () => {
  it('clamps observation + norm to 3 lines, leaves intervention unclamped, and toggles Read more / Show less', async () => {
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
    const { getByTestId, queryByTestId, getByText } = await render(
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
    await overflowLayout(observation);
    await overflowLayout(norm);

    // Now the single Read more toggle appears.
    const toggle = getByTestId('client-insight-readmore');
    expect(getByText('Read more')).toBeTruthy();

    // Expand: both clamped fields lose their cap; label becomes Show less.
    await fireEvent.press(toggle);
    expect(
      getByTestId('client-insight-observation').props.numberOfLines,
    ).toBeUndefined();
    expect(
      getByTestId('client-insight-norm').props.numberOfLines,
    ).toBeUndefined();
    expect(getByText('Show less')).toBeTruthy();

    // Collapse again: re-clamps and returns to Read more.
    await fireEvent.press(getByTestId('client-insight-readmore'));
    expect(
      getByTestId('client-insight-observation').props.numberOfLines,
    ).toBe(3);
    expect(
      getByTestId('client-insight-norm').props.numberOfLines,
    ).toBe(3);
    expect(getByText('Read more')).toBeTruthy();
  });

  it('does NOT render the toggle when content fits within 3 lines', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight() }),
    );
    const { getByTestId, queryByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // Report a within-cap layout (2 lines) for both clamped fields.
    await overflowLayout(getByTestId('client-insight-observation'), 2);
    await overflowLayout(getByTestId('client-insight-norm'), 2);
    expect(queryByTestId('client-insight-readmore')).toBeNull();
  });
});

/**
 * Resolve the effective `color` / `borderColor` of a rendered node by flattening
 * its style (RN merges arrays + functional styles; the panel applies the ink
 * inline as the last array entry, so the flattened value is the one painted).
 */
function flatColor(node: TestInstance, key: 'color' | 'borderColor'): string {
  const flat = StyleSheet.flatten(node.props.style) as Record<string, unknown>;
  const value = flat[key];
  expect(typeof value).toBe('string');
  return value as string;
}

describe('dark-mode on-surface AA (P1 regression guard)', () => {
  // Parametrised over BOTH buckets — warm and cool resolve to DIFFERENT inks
  // (gold[300] #D4B96B vs brand[300] #6E9479) so each must be guarded.
  const buckets = [
    { bucket: 'HEALTH_FITNESS' as const, name: 'warm / Health & Fitness' },
    { bucket: 'SLEEP_RECOVERY' as const, name: 'cool / Sleep & Recovery' },
  ];

  it.each(buckets)(
    'Read more toggle ink clears 4.5:1 on the dark surface ($name)',
    async ({ bucket }) => {
      mockColorScheme.current = 'dark';
      mockUseClientInsight.mockReturnValue(
        queryState({
          data: fullInsight({
            observation: LONG_280,
            norm_comparison: LONG_280,
          }),
        }),
      );
      const { getByTestId } = await render(
        <ClientWearableInsightPanel bucket={bucket} />,
      );
      // Surface the toggle so its resolved ink can be measured.
      await overflowLayout(getByTestId('client-insight-observation'));
      const toggle = getByTestId('client-insight-readmore');
      // The inner Text carries the inline color; read it off the rendered child.
      const textNode = toggle.children.find(
        (c): c is TestInstance => typeof c !== 'string',
      ) as TestInstance;
      const color = flatColor(textNode, 'color');
      expect(contrastRatio(color, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(buckets)(
    'Retry text + border ink clears AA on the dark surface ($name)',
    async ({ bucket }) => {
      mockColorScheme.current = 'dark';
      mockUseClientInsight.mockReturnValue(
        queryState({ isError: true, error: new Error('x'), refetch: jest.fn() }),
      );
      const { getByTestId } = await render(
        <ClientWearableInsightPanel bucket={bucket} />,
      );
      const retry = getByTestId('client-insight-retry');
      // Border lives on the Pressable; text colour on the inner Text. Both must
      // clear their respective AA thresholds (text 4.5:1, UI border 3:1).
      const borderColor = flatColor(retry, 'borderColor');
      const textNode = retry.children.find(
        (c): c is TestInstance => typeof c !== 'string',
      ) as TestInstance;
      const textColor = flatColor(textNode, 'color');
      expect(contrastRatio(borderColor, DARK_SURFACE)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(textColor, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('Read more stale-state on refetch (#28)', () => {
  it('drops the toggle when long content is replaced by short content', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          observation: LONG_280,
          norm_comparison: LONG_280,
        }),
      }),
    );
    const { getByTestId, queryByTestId, rerender } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // Long content overflows → toggle appears.
    await overflowLayout(getByTestId('client-insight-observation'));
    await overflowLayout(getByTestId('client-insight-norm'));
    expect(getByTestId('client-insight-readmore')).toBeTruthy();

    // Refetch swaps in short content; the keyed effect collapses + clears flags.
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          observation: 'Short now',
          norm_comparison: 'Also short',
        }),
      }),
    );
    await rerender(<ClientWearableInsightPanel {...baseProps} />);
    // The fresh layout pass reports a within-cap measurement; the always-assign
    // handler flips the flag back to false so the toggle is gone (not stuck on).
    await overflowLayout(getByTestId('client-insight-observation'), 2);
    await overflowLayout(getByTestId('client-insight-norm'), 2);
    expect(queryByTestId('client-insight-readmore')).toBeNull();
  });
});

describe('edge-case section omission', () => {
  it('omits the provenance row when source_metrics is empty', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({ data: fullInsight({ source_metrics: [] }) }),
    );
    const { queryByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(queryByTestId('client-insight-source-metrics')).toBeNull();
  });

  it('omits blank-after-trim sections but renders the real intervention (no EmptyPanel)', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          observation: '   ',
          norm_comparison: '',
          intervention: 'real content',
        }),
      }),
    );
    const { getByText, queryByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    // The two blank sections do NOT render…
    expect(queryByTestId('client-insight-observation')).toBeNull();
    expect(queryByTestId('client-insight-norm')).toBeNull();
    // …the real intervention DOES…
    expect(queryByTestId('client-insight-intervention')).toBeTruthy();
    expect(getByText('real content')).toBeTruthy();
    // …and because at least one field is real, this is NOT the empty state.
    expect(queryByTestId('client-insight-empty')).toBeNull();
  });

  it('falls back to the EmptyPanel when all three text fields are blank', async () => {
    mockUseClientInsight.mockReturnValue(
      queryState({
        data: fullInsight({
          observation: '   ',
          norm_comparison: '',
          intervention: '\t\n',
          optional_cta: {
            label: 'Open plan',
            deep_link: 'tgp://wearables/plan',
          },
        }),
      }),
    );
    const { getByTestId, queryByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('client-insight-empty')).toBeTruthy();
    // No CTA / chip / Read more leak through the all-blank fallback.
    expect(queryByTestId('client-insight-cta')).toBeNull();
    expect(queryByTestId('client-insight-confidence')).toBeNull();
    expect(queryByTestId('client-insight-readmore')).toBeNull();
  });
});

describe('unsafe deep-link refusal is logged (P2)', () => {
  it('warns via logger when refusing a non-tgp deep link', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const seeded: ClientInsightResponse = fullInsight({
      optional_cta: { label: 'Open something', deep_link: 'tgp://placeholder' },
    });
    if (seeded.optional_cta) {
      Object.assign(seeded.optional_cta, { deep_link: 'javascript:alert(1)' });
    }
    mockUseClientInsight.mockReturnValue(queryState({ data: seeded }));
    const { getByTestId } = await render(
      <ClientWearableInsightPanel {...baseProps} />,
    );
    await fireEvent.press(getByTestId('client-insight-cta'));
    expect(openURL).not.toHaveBeenCalled();
    // The refusal must leave a breadcrumb naming the unsafe-link refusal.
    expect(warn).toHaveBeenCalledTimes(1);
    const [context, message] = warn.mock.calls[0];
    expect(context).toBe('ClientWearableInsightPanel');
    expect(String(message)).toMatch(/refused to open a non-tgp deep link/);
  });
});
