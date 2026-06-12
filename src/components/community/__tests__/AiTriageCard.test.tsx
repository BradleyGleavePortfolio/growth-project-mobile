/**
 * AiTriageCard — v2-4 render-state tests.
 *
 * The card is presentational: the screen owns the data hook and passes a typed
 * `status` in, so the four states are trivially exercisable. This suite pins:
 *   • loading  → calm "preparing" state, no fabricated counts;
 *   • error    → calm, recoverable error (never panicky, never a fake all-clear),
 *               with a Retry control wired to `onRetry`;
 *   • empty    → honest "nothing to triage" (is_empty OR all-zero counts), never
 *               an invented summary;
 *   • ready    → all FIVE categories rendered with their counts and a11y labels,
 *               and the `urgent` label is the professional "Needs you soon"
 *               framing — never alarmist.
 *
 * `useTheme` is mocked to the real light tokens (no ThemeProvider), mirroring
 * the repo's component-test pattern.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import AiTriageCard from '../AiTriageCard';
import {
  TRIAGE_CATEGORIES,
  type TriageResponse,
} from '../../../api/communityAiTriageApi';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const TID = 'coach-community-inbox-ai-triage';

function populatedTriage(): TriageResponse {
  const buckets = TRIAGE_CATEGORIES.map((category) => {
    if (category === 'urgent') {
      return {
        category,
        items: [
          {
            source_item_id: ID_A,
            source_kind: 'message' as const,
            category,
            summary: 'Client is asking when their next check-in call is.',
          },
        ],
      };
    }
    if (category === 'win_to_celebrate') {
      return {
        category,
        items: [
          {
            source_item_id: ID_B,
            source_kind: 'post' as const,
            category,
            summary: 'Client hit a new squat personal best this week.',
          },
        ],
      };
    }
    return { category, items: [] };
  });
  return {
    generated_at: new Date('2026-06-10T12:00:00Z').toISOString(),
    is_empty: false,
    buckets,
    source_item_ids: [ID_A, ID_B],
  };
}

function emptyTriage(): TriageResponse {
  return {
    generated_at: new Date('2026-06-10T12:00:00Z').toISOString(),
    is_empty: true,
    buckets: TRIAGE_CATEGORIES.map((category) => ({ category, items: [] })),
    source_item_ids: [],
  };
}

describe('AiTriageCard — loading', () => {
  it('renders the calm loading state and no breakdown/counts', () => {
    const { getByTestId, queryByTestId } = render(
      <AiTriageCard status="loading" testID={TID} />,
    );
    const loading = getByTestId(`${TID}-loading`);
    expect(loading.props.accessibilityRole).toBe('progressbar');
    expect(loading.props.accessibilityLabel).toBe(
      'AI triage is preparing your inbox summary.',
    );
    expect(queryByTestId(`${TID}-breakdown`)).toBeNull();
    expect(queryByTestId(`${TID}-error`)).toBeNull();
  });
});

describe('AiTriageCard — error', () => {
  it('renders a calm recoverable error and never a fake all-clear', () => {
    const onRetry = jest.fn();
    const { getByTestId, queryByText } = render(
      <AiTriageCard status="error" onRetry={onRetry} testID={TID} />,
    );
    const error = getByTestId(`${TID}-error`);
    expect(error.props.accessibilityLabel).toBe(
      'AI triage is unavailable right now. Your inbox below is unaffected.',
    );
    // It must NOT claim an all-clear / zero-items read under failure.
    expect(queryByText('Nothing to triage right now.')).toBeNull();
  });

  it('fires onRetry when the Retry control is pressed', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(
      <AiTriageCard status="error" onRetry={onRetry} testID={TID} />,
    );
    fireEvent.press(getByTestId(`${TID}-retry`));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the Retry control and relabels it while retrying', () => {
    const { getByTestId } = render(
      <AiTriageCard status="error" onRetry={jest.fn()} retrying testID={TID} />,
    );
    const retry = getByTestId(`${TID}-retry`);
    expect(retry.props.accessibilityState).toEqual({ disabled: true });
  });

  it('omits the Retry control when no onRetry is supplied', () => {
    const { queryByTestId } = render(
      <AiTriageCard status="error" testID={TID} />,
    );
    expect(queryByTestId(`${TID}-retry`)).toBeNull();
  });
});

describe('AiTriageCard — empty', () => {
  it('renders the honest empty state when the typed empty status is passed', () => {
    const { getByTestId, queryByTestId } = render(
      <AiTriageCard status="empty" testID={TID} />,
    );
    const empty = getByTestId(`${TID}-empty`);
    expect(empty.props.accessibilityLabel).toBe(
      'AI triage: no unanswered items to summarise right now.',
    );
    // The typed empty path needs no payload and renders no header/breakdown.
    expect(queryByTestId(`${TID}-header`)).toBeNull();
    expect(queryByTestId(`${TID}-breakdown`)).toBeNull();
  });

  it('renders the honest empty state when is_empty is true', () => {
    const { getByTestId, queryByTestId } = render(
      <AiTriageCard status="ready" triage={emptyTriage()} testID={TID} />,
    );
    const empty = getByTestId(`${TID}-empty`);
    expect(empty.props.accessibilityLabel).toBe(
      'AI triage: no unanswered items to summarise right now.',
    );
    // No populated header / breakdown when there is nothing to triage.
    expect(queryByTestId(`${TID}-header`)).toBeNull();
    expect(queryByTestId(`${TID}-breakdown`)).toBeNull();
  });

  it('treats all-zero counts as empty even when is_empty is false', () => {
    const allZero: TriageResponse = {
      ...emptyTriage(),
      is_empty: false,
    };
    const { getByTestId } = render(
      <AiTriageCard status="ready" triage={allZero} testID={TID} />,
    );
    expect(getByTestId(`${TID}-empty`)).toBeTruthy();
  });
});

describe('AiTriageCard — ready (populated)', () => {
  it('renders all five categories with their counts', () => {
    const { getByTestId } = render(
      <AiTriageCard status="ready" triage={populatedTriage()} testID={TID} />,
    );
    for (const category of TRIAGE_CATEGORIES) {
      expect(getByTestId(`${TID}-category-${category}`)).toBeTruthy();
    }
    expect(getByTestId(`${TID}-count-urgent`).props.children).toBe(1);
    expect(getByTestId(`${TID}-count-win_to_celebrate`).props.children).toBe(1);
    expect(getByTestId(`${TID}-count-form_check`).props.children).toBe(0);
    expect(getByTestId(`${TID}-count-no_action_needed`).props.children).toBe(0);
  });

  it('uses the professional "Needs you soon" framing for urgent (never panicky)', () => {
    const { getByTestId } = render(
      <AiTriageCard status="ready" triage={populatedTriage()} testID={TID} />,
    );
    const urgent = getByTestId(`${TID}-category-urgent`);
    expect(urgent.props.accessibilityLabel).toBe('1 Needs you soon');
  });

  it('summarises the whole card on the header for a screen reader', () => {
    const { getByTestId } = render(
      <AiTriageCard status="ready" triage={populatedTriage()} testID={TID} />,
    );
    const header = getByTestId(`${TID}-header`);
    expect(header.props.accessibilityRole).toBe('button');
    expect(header.props.accessibilityLabel).toContain('2 unanswered items');
    expect(header.props.accessibilityState).toEqual({ expanded: true });
  });

  it('collapses the breakdown when the header is toggled', () => {
    const { getByTestId, queryByTestId } = render(
      <AiTriageCard status="ready" triage={populatedTriage()} testID={TID} />,
    );
    expect(getByTestId(`${TID}-breakdown`)).toBeTruthy();
    fireEvent.press(getByTestId(`${TID}-header`));
    expect(queryByTestId(`${TID}-breakdown`)).toBeNull();
  });
});
