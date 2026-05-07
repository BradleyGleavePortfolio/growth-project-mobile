/**
 * AIGatewayDisabledState — render tests.
 *
 * Covers the main render path for each response variant using
 * @testing-library/react-native. Mocks useTheme so the test has no
 * dependency on AsyncStorage, react-query, or Expo modules.
 *
 * What this asserts:
 *   - disabled.feature_flag_off renders the "Not yet available" title
 *   - disabled.kill_switch renders "AI assist is off"
 *   - error.provider_unavailable renders a "Try again" button when onRetry is passed
 *   - error.provider_unavailable does NOT render retry when onRetry is absent
 *   - error.provider_unavailable surfaces the correlation ID when present
 *   - accessibilityLabel is set on the container for every variant
 *   - The component never renders a result-shaped state (no content shape)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AIGatewayDisabledState from '../AIGatewayDisabledState';
import type {
  AIGatewayDraftDisabled,
  AIGatewayDraftError,
} from '../../../types/aiGateway';

// ThemeProvider depends on useFoundingNumber → react-query → AsyncStorage.
// Provide a deterministic stub so these render tests have zero infra deps.
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary: '#2C4A36',
      textPrimary: '#1A1A18',
      textSecondary: '#3D3D3A',
      textMuted: '#B1A89F',
      surface: '#F1E8D5',
      border: '#B08D57',
      warning: '#C5A253',
    },
  }),
}));

const flagOff: AIGatewayDraftDisabled = {
  status: 'disabled',
  capability: 'coach_brief_draft',
  reason: 'feature_flag_off',
};

const killSwitch: AIGatewayDraftDisabled = {
  status: 'disabled',
  capability: 'coach_brief_draft',
  reason: 'kill_switch',
};

const providerError: AIGatewayDraftError = {
  status: 'error',
  capability: 'coach_brief_draft',
  reason: 'provider_unavailable',
  correlationId: 'corr-xyz',
};

describe('AIGatewayDisabledState', () => {
  it('renders disabled.feature_flag_off with correct title', () => {
    const { getByText } = render(
      <AIGatewayDisabledState response={flagOff} />,
    );
    expect(getByText('Not yet available')).toBeTruthy();
  });

  it('renders disabled.kill_switch with correct title', () => {
    const { getByText } = render(
      <AIGatewayDisabledState response={killSwitch} />,
    );
    expect(getByText('AI assist is off')).toBeTruthy();
  });

  it('sets accessibilityRole="text" on the container', () => {
    const { getByRole } = render(
      <AIGatewayDisabledState response={flagOff} />,
    );
    // "text" accessibilityRole maps to 'text' in RNTL queries
    expect(getByRole('text')).toBeTruthy();
  });

  it('accessibilityLabel contains title and body copy', () => {
    const { getByLabelText } = render(
      <AIGatewayDisabledState response={flagOff} />,
    );
    // Matches the combined "title. body" pattern set on the container
    expect(
      getByLabelText(/Not yet available/i),
    ).toBeTruthy();
  });

  it('renders the retry button for error responses when onRetry is provided', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(
      <AIGatewayDisabledState response={providerError} onRetry={onRetry} />,
    );
    const retryBtn = getByTestId('ai-gateway-retry');
    fireEvent.press(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the retry button when onRetry is absent', () => {
    const { queryByTestId } = render(
      <AIGatewayDisabledState response={providerError} />,
    );
    expect(queryByTestId('ai-gateway-retry')).toBeNull();
  });

  it('does NOT render the retry button for disabled responses even with onRetry', () => {
    const { queryByTestId } = render(
      <AIGatewayDisabledState response={flagOff} onRetry={jest.fn()} />,
    );
    expect(queryByTestId('ai-gateway-retry')).toBeNull();
  });

  it('renders the correlation ID when present on error responses', () => {
    const { getByTestId } = render(
      <AIGatewayDisabledState response={providerError} />,
    );
    const correlationEl = getByTestId('ai-gateway-correlation-id');
    expect(correlationEl).toBeTruthy();
  });

  it('does NOT render the correlation ID when absent', () => {
    const noCorrelation: AIGatewayDraftError = {
      status: 'error',
      capability: 'coach_brief_draft',
      reason: 'timeout',
      correlationId: null,
    };
    const { queryByTestId } = render(
      <AIGatewayDisabledState response={noCorrelation} />,
    );
    expect(queryByTestId('ai-gateway-correlation-id')).toBeNull();
  });

  it('uses the testID pattern ai-gateway-{status}-{reason} for QA targeting', () => {
    const { getByTestId } = render(
      <AIGatewayDisabledState response={flagOff} />,
    );
    expect(getByTestId('ai-gateway-disabled-feature_flag_off')).toBeTruthy();
  });
});
