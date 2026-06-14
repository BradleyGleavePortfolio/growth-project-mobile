/**
 * WearablePromptSourcePill — render + helper regression tests (v3-4).
 *
 * Pins the coach-only source-attribution chip's contract:
 *   - The pure helpers map an allowlisted metric key to its human label and
 *     format the observed value with the right unit suffix (rounded to 1dp).
 *   - The chip renders the label + formatted value and folds both into a single
 *     screen-reader read ("Source: <label> <value>") with role "text".
 *   - It is a calm, non-interactive audit cue (no button affordance, no badge
 *     theater) — it exists so a coach can see the prompt is grounded in the
 *     client's real opted-in data.
 *
 * The theme is mocked to the light token set (repo pattern) so the component
 * renders without a ThemeProvider, mirroring the v3-2 LessonCard harness.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import WearablePromptSourcePill, {
  formatMetricLabel,
  formatObservedValue,
} from '../WearablePromptSourcePill';
import type { PromptSourceView } from '../../../api/communityWearablePromptsApi';

function source(overrides: Partial<PromptSourceView> = {}): PromptSourceView {
  return {
    sampleId: 'sample-1',
    metricKey: 'HRV_MS',
    observedValue: 62,
    ...overrides,
  };
}

describe('WearablePromptSourcePill — pure helpers', () => {
  it('formatMetricLabel maps allowlisted keys to human labels', () => {
    expect(formatMetricLabel('HRV_MS')).toBe('HRV');
    expect(formatMetricLabel('RECOVERY_SCORE')).toBe('Recovery');
    expect(formatMetricLabel('SLEEP_TOTAL_MIN')).toBe('Sleep');
  });

  it('formatMetricLabel falls back to the raw key when unknown', () => {
    expect(formatMetricLabel('SOME_FUTURE_KEY')).toBe('SOME_FUTURE_KEY');
  });

  it('formatObservedValue appends the right unit suffix and rounds to 1dp', () => {
    expect(formatObservedValue(source({ metricKey: 'HRV_MS', observedValue: 62 }))).toBe(
      '62 ms',
    );
    expect(
      formatObservedValue(
        source({ metricKey: 'SLEEP_EFFICIENCY_PCT', observedValue: 91.27 }),
      ),
    ).toBe('91.3%');
    expect(
      formatObservedValue(
        source({ metricKey: 'RESTING_HEART_RATE_BPM', observedValue: 54 }),
      ),
    ).toBe('54 bpm');
  });

  it('formatObservedValue emits a unitless value for score metrics', () => {
    expect(
      formatObservedValue(
        source({ metricKey: 'RECOVERY_SCORE', observedValue: 88 }),
      ),
    ).toBe('88');
  });
});

describe('WearablePromptSourcePill — render', () => {
  it('renders the metric label and the formatted value', async () => {
    await render(<WearablePromptSourcePill source={source()} testID="pill" />);
    expect(screen.getByText('HRV')).toBeTruthy();
    expect(screen.getByText('62 ms')).toBeTruthy();
  });

  it('folds the full state into a single a11y read with role "text"', async () => {
    await render(<WearablePromptSourcePill source={source()} testID="pill" />);
    const pill = screen.getByTestId('pill');
    expect(pill.props.accessibilityRole).toBe('text');
    expect(pill.props.accessibilityLabel).toBe('Source: HRV 62 ms');
  });

  it('defaults the testID to a sample-scoped id when none is passed', async () => {
    await render(<WearablePromptSourcePill source={source({ sampleId: 'abc' })} />);
    expect(screen.getByTestId('wearable-prompt-source-abc')).toBeTruthy();
  });
});
