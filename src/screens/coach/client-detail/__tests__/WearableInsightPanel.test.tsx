/**
 * WearableInsightPanel — coach AI panel component tests (PR-HK-5a).
 *
 * The data hooks are mocked so each render path is deterministic. Covers:
 *   - loading skeleton (anti-spinner, R0),
 *   - empty branch literal copy + secondary line, NO confidence chip,
 *   - error branch sanitized copy + Retry,
 *   - expanded state renders all four fields + confidence chip label/%,
 *   - review sheet: open / edit-detection / dismiss,
 *   - approve 'ok' → panel replaced by the forward hook,
 *   - approve 'not_implemented' → sheet stays open with calm copy,
 *   - no banned strings.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockUseCoachInsight = jest.fn();
const mockMutate = jest.fn();
const mockUseApproveDraft = jest.fn();

jest.mock('../../../../hooks/useWearableInsight', () => ({
  useCoachInsight: (args: unknown) => mockUseCoachInsight(args),
  useApproveDraft: () => mockUseApproveDraft(),
}));

import {
  makeAccessibilitySubscription,
} from '../../../client/wearables/testSupport/accessibilityMocks';
import { WearableInsightPanel } from '../WearableInsightPanel';
import type { CoachInsight, EmptyInsight } from '../../../../api/wearableInsightsApi';

function fullInsight(overrides: Partial<CoachInsight> = {}): CoachInsight {
  return {
    observation: 'Deep sleep down 40% vs baseline this week',
    hypothesis: 'Possibly light exposure or late caffeine',
    suggested_action: 'Ask about evening routine changes',
    suggested_message_draft:
      'Hey, noticed your deep sleep dipped — anything change in your evenings recently? Happy to help you tweak the wind-down.',
    confidence_level: 'fairly_sure',
    source_metrics: ['SLEEP_DEEP_MIN', 'HRV_MS'],
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
    ...over,
  };
}

function approveState(over: Record<string, unknown> = {}) {
  return { mutate: mockMutate, isPending: false, ...over };
}

beforeEach(() => {
  mockUseCoachInsight.mockReset();
  mockMutate.mockReset();
  mockUseApproveDraft.mockReset();
  mockUseApproveDraft.mockReturnValue(approveState());
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true); // reduce-motion ON → instant expand, deterministic
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue(makeAccessibilitySubscription());
});

const baseProps = {
  side: 'coach' as const,
  bucket: 'SLEEP_RECOVERY' as const,
  clientId: 'client-1',
};

describe('loading / empty / error states', () => {
  it('renders a skeleton (not a spinner) while loading', () => {
    mockUseCoachInsight.mockReturnValue(queryState({ isLoading: true }));
    const { getByTestId, queryByTestId } = render(
      <WearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('coach-insight-loading')).toBeTruthy();
    expect(queryByTestId('coach-insight-panel')).toBeNull();
  });

  it('renders the literal empty copy + secondary line and NO confidence chip', () => {
    mockUseCoachInsight.mockReturnValue(queryState({ data: emptyInsight() }));
    const { getByTestId, getByText, queryByTestId } = render(
      <WearableInsightPanel {...baseProps} />,
    );
    expect(getByTestId('coach-insight-empty')).toBeTruthy();
    expect(getByText('Not enough data yet — keep syncing.')).toBeTruthy();
    expect(
      getByText('Once we have ~3 days of data, your AI will flag patterns.'),
    ).toBeTruthy();
    expect(queryByTestId('coach-insight-confidence')).toBeNull();
  });

  it('renders sanitized error copy + Retry, and retry refetches', () => {
    const refetch = jest.fn();
    mockUseCoachInsight.mockReturnValue(
      queryState({ isError: true, error: new Error('boom'), refetch }),
    );
    const { getByTestId } = render(<WearableInsightPanel {...baseProps} />);
    expect(getByTestId('coach-insight-error')).toBeTruthy();
    fireEvent.press(getByTestId('coach-insight-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('expanded state', () => {
  it('reveals all four fields and the confidence chip label + percentage', () => {
    mockUseCoachInsight.mockReturnValue(queryState({ data: fullInsight() }));
    const { getByTestId, getByText, queryByTestId } = render(
      <WearableInsightPanel {...baseProps} />,
    );
    // Confidence chip is always visible (collapsed).
    expect(getByText('Fairly sure (70%)')).toBeTruthy();
    // Collapsed: expanded block absent.
    expect(queryByTestId('coach-insight-expanded')).toBeNull();

    fireEvent.press(getByTestId('coach-insight-panel'));

    expect(getByTestId('coach-insight-expanded')).toBeTruthy();
    expect(getByText('Possibly light exposure or late caffeine')).toBeTruthy();
    expect(getByText('Ask about evening routine changes')).toBeTruthy();
    expect(getByText(/noticed your deep sleep dipped/)).toBeTruthy();
    expect(getByTestId('coach-insight-review-cta')).toBeTruthy();
  });
});

describe('review sheet', () => {
  function openSheet() {
    const utils = render(<WearableInsightPanel {...baseProps} />);
    fireEvent.press(utils.getByTestId('coach-insight-panel'));
    fireEvent.press(utils.getByTestId('coach-insight-review-cta'));
    return utils;
  }

  it('opens with the draft prefilled and dismiss calls the mutation with action dismiss', () => {
    mockUseCoachInsight.mockReturnValue(queryState({ data: fullInsight() }));
    const { getByTestId } = openSheet();
    expect(getByTestId('coach-insight-draft-input').props.value).toContain(
      'noticed your deep sleep dipped',
    );
    fireEvent.press(getByTestId('coach-insight-dismiss'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dismiss', draftBody: '' }),
      expect.any(Object),
    );
  });

  it('enables Edit-then-send only after the text is edited', () => {
    mockUseCoachInsight.mockReturnValue(queryState({ data: fullInsight() }));
    const { getByTestId } = openSheet();
    const editBtn = getByTestId('coach-insight-edit-send');
    expect(editBtn.props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(
      getByTestId('coach-insight-draft-input'),
      'A clearly different message from the coach',
    );
    expect(
      getByTestId('coach-insight-edit-send').props.accessibilityState.disabled,
    ).toBe(false);
  });

  it('Approve & send sends the ORIGINAL body with action approve', () => {
    mockUseCoachInsight.mockReturnValue(queryState({ data: fullInsight() }));
    const { getByTestId } = openSheet();
    fireEvent.press(getByTestId('coach-insight-approve'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'approve',
        draftBody: fullInsight().suggested_message_draft,
      }),
      expect.any(Object),
    );
  });

  it('on ok result, replaces the panel with the forward hook', async () => {
    mockUseCoachInsight.mockReturnValue(queryState({ data: fullInsight() }));
    // Drive the mutation's onSuccess with an ok response.
    mockMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess({
        status: 'ok',
        draft_id: '11111111-1111-1111-1111-111111111111',
        materialised_at: '2026-05-20T10:00:00Z',
      });
    });
    const { getByTestId, getByText, unmount } = openSheet();
    fireEvent.press(getByTestId('coach-insight-approve'));
    await waitFor(() => expect(getByTestId('coach-insight-sent')).toBeTruthy());
    expect(getByText('Sent to your client')).toBeTruthy();
    // Unmount clears the forward-hook timer (no dangling handle, #32).
    unmount();
  });

  it('on not_implemented result, keeps the sheet open with calm copy', async () => {
    mockUseCoachInsight.mockReturnValue(queryState({ data: fullInsight() }));
    mockMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess({
        status: 'not_implemented',
        message: 'Approval is rolling out — try again later.',
      });
    });
    const { getByTestId, getByText } = openSheet();
    fireEvent.press(getByTestId('coach-insight-approve'));
    await waitFor(() =>
      expect(getByTestId('coach-insight-pending')).toBeTruthy(),
    );
    expect(
      getByText('Approval is rolling out — try again later.'),
    ).toBeTruthy();
    // Primary CTA disabled while pending.
    expect(
      getByTestId('coach-insight-approve').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('on a thrown error, surfaces sanitized copy + retry beneath the input', async () => {
    mockUseCoachInsight.mockReturnValue(queryState({ data: fullInsight() }));
    mockMutate.mockImplementation((_vars, opts) => {
      opts.onError(new Error('network blew up'));
    });
    const { getByTestId } = openSheet();
    fireEvent.press(getByTestId('coach-insight-approve'));
    await waitFor(() =>
      expect(getByTestId('coach-insight-sheet-error')).toBeTruthy(),
    );
    expect(getByTestId('coach-insight-sheet-retry')).toBeTruthy();
  });
});

describe('R0 hygiene', () => {
  it('never renders the banned "Coming soon" string in any state', () => {
    for (const data of [fullInsight(), emptyInsight()]) {
      mockUseCoachInsight.mockReturnValue(queryState({ data }));
      const { queryByText, unmount } = render(
        <WearableInsightPanel {...baseProps} />,
      );
      expect(queryByText(/coming soon/i)).toBeNull();
      unmount();
    }
  });
});
