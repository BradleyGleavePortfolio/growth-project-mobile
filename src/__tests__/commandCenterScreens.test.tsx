/**
 * Command Center — render tests for all 5 screens + shared components.
 *
 * Each screen is tested in:
 *   - loading state (mock pending)
 *   - data state (mock resolved)
 *   - error state (mock rejected)
 *   - empty state (mock resolved with empty list)
 *
 * Shared components (KpiTile, AlertRow, MessagePreviewRow) are tested
 * for correct rendering and accessibility labels.
 */

import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

// ─── Mock the API before any imports resolve ──────────────────────────────────
jest.mock('../services/commandCenterApi', () => {
  const original = jest.requireActual('../services/commandCenterApi');
  return {
    ...original,
    __USING_MOCK_DATA: false, // disable the built-in mock so we control responses
    commandCenterApi: {
      getOverview: jest.fn(),
      getAtRisk: jest.fn(),
      getWinStreaks: jest.fn(),
      getInbox: jest.fn(),
      getActionQueue: jest.fn(),
      dismissAlert: jest.fn(),
      getLtvMetrics: jest.fn().mockResolvedValue({
        data: {
          mrr_cents: 0,
          mrr_label: '$0',
          active_client_count: 0,
          revenue_per_client_month_cents: 0,
          revenue_per_client_month_label: '$0',
          avg_client_lifespan_months: 0,
          estimated_ltv_cents: 0,
          estimated_ltv_label: '$0',
          churn_rate_pct: 0,
          net_revenue_retention_pct: 100,
          projected_annual_revenue_cents: 0,
          projected_annual_revenue_label: '$0',
          mrr_trend: 'flat',
          mrr_30d_ago_cents: 0,
          zero_churn_streak_months: 0,
          all_time_peak_rpcm_cents: 0,
          all_time_peak_rpcm_label: '$0',
          is_new_rpcm_record: false,
          ltv_cac_ratio: null,
          next_milestone: { clients_needed: 0, mrr_target_cents: 0, mrr_target_label: '$0' },
          currency: 'usd',
          computed_at: new Date().toISOString(),
        },
      }),
    },
  };
});

import { commandCenterApi } from '../services/commandCenterApi';
import OverviewScreen from '../screens/coach/command-center/OverviewScreen';
import AtRiskScreen from '../screens/coach/command-center/AtRiskScreen';
import WinStreaksScreen from '../screens/coach/command-center/WinStreaksScreen';
import InboxScreen from '../screens/coach/command-center/InboxScreen';
import ActionQueueScreen from '../screens/coach/command-center/ActionQueueScreen';
import KpiTile from '../components/command-center/KpiTile';
import AlertRow from '../components/command-center/AlertRow';
import MessagePreviewRow from '../components/command-center/MessagePreviewRow';

const mockOverview = {
  roster_size: 12,
  active_today: 8,
  check_in_rate_7day: 0.75,
  open_alerts: 2,
  at_risk_count: 3,
  win_streak_count: 5,
  unread_messages: 1,
  pending_actions: 2,
};

const mockAtRisk = {
  items: [
    {
      user_id: 'u1',
      display_name: 'Test Client A',
      bucket: 'red' as const,
      risk_score: null,
      last_active_at: new Date(Date.now() - 7 * 86400000).toISOString(),
      top_factor: '7 consecutive missed check-ins',
      days_since_checkin: 7,
    },
  ],
  total_at_risk: 1,
};

const mockWinStreaks = {
  items: [
    {
      user_id: 'u2',
      display_name: 'Test Client B',
      streak_days: 14,
      streak_type: 'check_in',
      streak_started_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    },
  ],
  total_active_streaks: 1,
};

const mockInbox = {
  threads: [
    {
      thread_id: 't1',
      client_id: 'u3',
      client_name: 'Test Client C',
      last_message_preview: 'Quick question about training.',
      last_message_at: new Date(Date.now() - 3600000).toISOString(),
      unread_count: 1,
      is_coach_turn: true,
    },
  ],
  total_unread: 1,
};

const mockActionQueue = {
  items: [
    {
      alert_id: 'a1',
      client_id: 'u1',
      client_name: 'Test Client A',
      alert_type: 'missed_checkins' as const,
      message: 'Test Client A has missed 7 consecutive check-ins.',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      dismissed_at: null,
    },
  ],
  total_pending: 1,
};

// Helper: make api return a resolved promise with data
function mockResolved<T>(data: T) {
  return jest.fn().mockResolvedValue({ data });
}

// Helper: make api return a rejected promise
function mockRejected() {
  return jest.fn().mockRejectedValue(new Error('Network error'));
}

afterEach(() => {
  jest.clearAllMocks();
});

// ─── KpiTile ──────────────────────────────────────────────────────────────────
describe('KpiTile', () => {
  it('renders label and value', () => {
    const { getByText } = render(
      <KpiTile label="Active today" value={8} testID="kpi-test" />,
    );
    expect(getByText('Active today')).toBeTruthy();
    expect(getByText('8')).toBeTruthy();
  });

  it('renders subtext when provided', () => {
    const { getByText } = render(
      <KpiTile label="Active today" value={8} subtext="of 12 clients" />,
    );
    expect(getByText('of 12 clients')).toBeTruthy();
  });

  it('exposes correct accessibilityLabel with subtext', () => {
    const { getByLabelText } = render(
      <KpiTile label="Active today" value={8} subtext="of 12 clients" testID="kpi" />,
    );
    expect(getByLabelText('Active today: 8. of 12 clients')).toBeTruthy();
  });
});

// ─── AlertRow ─────────────────────────────────────────────────────────────────
describe('AlertRow', () => {
  it('renders client name and message', () => {
    const { getByText } = render(
      <AlertRow
        clientName="James R."
        message="Missed 7 check-ins"
        bucket="red"
        onPress={jest.fn()}
      />,
    );
    expect(getByText('James R.')).toBeTruthy();
    expect(getByText('Missed 7 check-ins')).toBeTruthy();
    expect(getByText('High risk')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <AlertRow
        clientName="James R."
        message="Test"
        onPress={onPress}
        testID="test-alert-row"
      />,
    );
    fireEvent.press(getByTestId('test-alert-row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders dismiss button when onDismiss is provided', () => {
    const { getByText } = render(
      <AlertRow
        clientName="James R."
        message="Test"
        onPress={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(getByText('Dismiss')).toBeTruthy();
  });
});

// ─── MessagePreviewRow ────────────────────────────────────────────────────────
describe('MessagePreviewRow', () => {
  it('renders client name, preview, and unread badge', () => {
    const { getByText } = render(
      <MessagePreviewRow
        clientName="Hannah T."
        preview="Quick question about training."
        lastMessageAt={new Date(Date.now() - 3600000).toISOString()}
        unreadCount={2}
        isCoachTurn
        onPress={jest.fn()}
      />,
    );
    expect(getByText('Hannah T.')).toBeTruthy();
    expect(getByText('Quick question about training.')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <MessagePreviewRow
        clientName="Hannah T."
        preview="Test"
        lastMessageAt={new Date().toISOString()}
        unreadCount={0}
        isCoachTurn={false}
        onPress={onPress}
        testID="msg-row-test"
      />,
    );
    fireEvent.press(getByTestId('msg-row-test'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

// ─── OverviewScreen ───────────────────────────────────────────────────────────
describe('OverviewScreen', () => {
  it('renders loading state initially', () => {
    (commandCenterApi.getOverview as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<OverviewScreen />);
    expect(getByTestId('command-center-overview')).toBeTruthy();
  });

  it('renders KPI tiles after data loads', async () => {
    (commandCenterApi.getOverview as jest.Mock) = mockResolved(mockOverview);
    const { getByTestId } = render(<OverviewScreen />);
    await waitFor(() => {
      expect(getByTestId('command-center-kpi-roster-size')).toBeTruthy();
      expect(getByTestId('command-center-kpi-active-today')).toBeTruthy();
      expect(getByTestId('command-center-kpi-checkin-rate')).toBeTruthy();
      expect(getByTestId('command-center-kpi-open-alerts')).toBeTruthy();
    });
  });

  it('renders error state when API rejects', async () => {
    (commandCenterApi.getOverview as jest.Mock) = mockRejected();
    const { getByText } = render(<OverviewScreen />);
    await waitFor(() => {
      expect(getByText(/unable to load/i)).toBeTruthy();
    });
  });
});

// ─── AtRiskScreen ─────────────────────────────────────────────────────────────
describe('AtRiskScreen', () => {
  it('renders loading state initially', () => {
    (commandCenterApi.getAtRisk as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<AtRiskScreen />);
    expect(getByTestId('command-center-at-risk')).toBeTruthy();
  });

  it('renders at-risk rows after data loads', async () => {
    (commandCenterApi.getAtRisk as jest.Mock) = mockResolved(mockAtRisk);
    const { getAllByTestId } = render(<AtRiskScreen />);
    await waitFor(() => {
      expect(getAllByTestId('command-center-at-risk-row').length).toBeGreaterThan(0);
    });
  });

  it('renders empty state when no at-risk clients', async () => {
    (commandCenterApi.getAtRisk as jest.Mock) = mockResolved({ items: [], total_at_risk: 0 });
    const { getByText } = render(<AtRiskScreen />);
    await waitFor(() => {
      expect(getByText(/no at-risk clients/i)).toBeTruthy();
    });
  });

  it('renders error state when API rejects', async () => {
    (commandCenterApi.getAtRisk as jest.Mock) = mockRejected();
    const { getByText } = render(<AtRiskScreen />);
    await waitFor(() => {
      expect(getByText(/unable to load/i)).toBeTruthy();
    });
  });
});

// ─── WinStreaksScreen ─────────────────────────────────────────────────────────
describe('WinStreaksScreen', () => {
  it('renders loading state initially', () => {
    (commandCenterApi.getWinStreaks as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<WinStreaksScreen />);
    expect(getByTestId('command-center-win-streaks')).toBeTruthy();
  });

  it('renders streak rows after data loads', async () => {
    (commandCenterApi.getWinStreaks as jest.Mock) = mockResolved(mockWinStreaks);
    const { getAllByTestId } = render(<WinStreaksScreen />);
    await waitFor(() => {
      expect(getAllByTestId('command-center-win-streak-row').length).toBeGreaterThan(0);
    });
  });

  it('renders empty state when no streaks', async () => {
    (commandCenterApi.getWinStreaks as jest.Mock) = mockResolved({ items: [], total_active_streaks: 0 });
    const { getByText } = render(<WinStreaksScreen />);
    await waitFor(() => {
      expect(getByText(/no active streaks/i)).toBeTruthy();
    });
  });

  it('renders error state when API rejects', async () => {
    (commandCenterApi.getWinStreaks as jest.Mock) = mockRejected();
    const { getByText } = render(<WinStreaksScreen />);
    await waitFor(() => {
      expect(getByText(/unable to load/i)).toBeTruthy();
    });
  });
});

// ─── InboxScreen ──────────────────────────────────────────────────────────────
describe('InboxScreen', () => {
  it('renders loading state initially', () => {
    (commandCenterApi.getInbox as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<InboxScreen />);
    expect(getByTestId('command-center-inbox')).toBeTruthy();
  });

  it('renders inbox rows after data loads', async () => {
    (commandCenterApi.getInbox as jest.Mock) = mockResolved(mockInbox);
    const { getAllByTestId } = render(<InboxScreen />);
    await waitFor(() => {
      expect(getAllByTestId('command-center-inbox-row').length).toBeGreaterThan(0);
    });
  });

  it('renders empty state when no threads', async () => {
    (commandCenterApi.getInbox as jest.Mock) = mockResolved({ threads: [], total_unread: 0 });
    const { getByText } = render(<InboxScreen />);
    await waitFor(() => {
      expect(getByText(/no messages/i)).toBeTruthy();
    });
  });

  it('renders error state when API rejects', async () => {
    (commandCenterApi.getInbox as jest.Mock) = mockRejected();
    const { getByText } = render(<InboxScreen />);
    await waitFor(() => {
      expect(getByText(/unable to load/i)).toBeTruthy();
    });
  });
});

// ─── ActionQueueScreen ────────────────────────────────────────────────────────
describe('ActionQueueScreen', () => {
  it('renders loading state initially', () => {
    (commandCenterApi.getActionQueue as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<ActionQueueScreen />);
    expect(getByTestId('command-center-action-queue')).toBeTruthy();
  });

  it('renders action rows after data loads', async () => {
    (commandCenterApi.getActionQueue as jest.Mock) = mockResolved(mockActionQueue);
    const { getAllByTestId } = render(<ActionQueueScreen />);
    await waitFor(() => {
      expect(getAllByTestId('command-center-action-queue-row').length).toBeGreaterThan(0);
    });
  });

  it('renders empty state when no pending actions', async () => {
    (commandCenterApi.getActionQueue as jest.Mock) = mockResolved({ items: [], total_pending: 0 });
    const { getByText } = render(<ActionQueueScreen />);
    await waitFor(() => {
      expect(getByText(/no pending actions/i)).toBeTruthy();
    });
  });

  it('renders error state when API rejects', async () => {
    (commandCenterApi.getActionQueue as jest.Mock) = mockRejected();
    const { getByText } = render(<ActionQueueScreen />);
    await waitFor(() => {
      expect(getByText(/unable to load/i)).toBeTruthy();
    });
  });

  it('optimistically removes item when dismiss is pressed', async () => {
    (commandCenterApi.getActionQueue as jest.Mock) = mockResolved(mockActionQueue);
    (commandCenterApi.dismissAlert as jest.Mock) = mockResolved({ ok: true });

    const { getAllByTestId, queryAllByTestId } = render(<ActionQueueScreen />);
    await waitFor(() => {
      expect(getAllByTestId('command-center-action-queue-row').length).toBe(1);
    });

    const dismissBtn = getAllByTestId('command-center-alert-dismiss')[0];
    await act(async () => {
      fireEvent.press(dismissBtn);
    });

    await waitFor(() => {
      expect(queryAllByTestId('command-center-action-queue-row').length).toBe(0);
    });
  });
});
