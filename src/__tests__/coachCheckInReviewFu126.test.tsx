/**
 * FU-CHECKIN-126: coach marks a check-in reviewed from the Timeline (U4,
 * AUDIT-06-125); Coach Home leftovers U-A13-5..8 (AUDIT-13-125).
 */
import React from 'react';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';

const mockMarkReviewed = jest.fn();
const mockGetTimeline = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  coachApi: {
    markCheckInReviewed: (...a: unknown[]) => mockMarkReviewed(...a),
    getClientTimeline: (...a: unknown[]) => mockGetTimeline(...a),
  },
}));
jest.mock('../utils/haptics', () => ({
  successTap: jest.fn(),
  warningTap: jest.fn(),
}));
jest.mock('../services/commandCenterApi', () => {
  const original = jest.requireActual('../services/commandCenterApi');
  return {
    ...original,
    __USING_MOCK_DATA: false,
    commandCenterApi: {
      getOverview: jest.fn(),
      getAtRisk: jest.fn(),
      getLtvMetrics: jest.fn(() => new Promise(() => {})),
    },
  };
});
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { draftId: 'd-1', clientId: 'c-1', clientName: 'Ana Lopez' } }),
}));
const mockGetDraft = jest.fn();
jest.mock('../api/coachAi', () => ({
  __esModule: true,
  default: { getDraft: (...a: unknown[]) => mockGetDraft(...a) },
}));

import { TimelineTab, canMarkReviewed } from '../screens/coach/client-detail/TimelineTab';
import { useClientDetailData } from '../screens/coach/client-detail/useClientDetailData';
import type { TimelineEvent } from '../screens/coach/client-detail/types';
import { commandCenterApi } from '../services/commandCenterApi';
import OverviewScreen from '../screens/coach/command-center/OverviewScreen';
import AtRiskScreen from '../screens/coach/command-center/AtRiskScreen';
import CoachLtvDashboard, { LtvMetrics } from '../components/command-center/CoachLtvDashboard';
import ClientInsightScreen from '../screens/coach/ClientInsightScreen';
import { useTheme } from '../theme/ThemeProvider';

beforeEach(() => {
  jest.clearAllMocks();
});

function checkInEvent(id: string, coachId: string | null, reviewed: boolean): TimelineEvent {
  return {
    id: `checkin_${id}`,
    type: 'checkin',
    title: 'Check-in',
    subtitle: 'Mood 4/5',
    date: '2026-10-05T09:00:00',
    icon: 'chatbubble-ellipses',
    iconColor: '#000000',
    checkIn: { id, coachId, reviewed },
  };
}

describe('U4: coach marks a check-in reviewed from the client Timeline', () => {
  it('offers the action only on unreviewed check-ins attached to this coach', () => {
    expect(canMarkReviewed(checkInEvent('a', 'coach-1', false), 'coach-1')).toBe(true);
    expect(canMarkReviewed(checkInEvent('a', 'coach-1', true), 'coach-1')).toBe(false);
    expect(canMarkReviewed(checkInEvent('a', 'coach-2', false), 'coach-1')).toBe(false);
    expect(canMarkReviewed(checkInEvent('a', null, false), 'coach-1')).toBe(false);
    expect(canMarkReviewed(checkInEvent('a', 'coach-1', false), null)).toBe(false);
  });

  it('shows "Mark reviewed", calls the handler, and shows "Reviewed" rows', async () => {
    const onMarkReviewed = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <TimelineTab
        events={[checkInEvent('ci-1', 'coach-1', false), checkInEvent('ci-2', 'coach-1', true)]}
        onLoad={jest.fn()}
        days={30}
        viewerId="coach-1"
        onMarkReviewed={onMarkReviewed}
      />,
    );
    expect(screen.queryByTestId('timeline-checkin-review-ci-2')).toBeNull();
    expect(screen.getByTestId('timeline-checkin-reviewed-ci-2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('timeline-checkin-review-ci-1'));
    expect(onMarkReviewed).toHaveBeenCalledWith('ci-1');
  });

  it('shows a specific error on the row when the save fails', async () => {
    const onMarkReviewed = jest.fn().mockRejectedValue({ code: 'ERR_NETWORK', message: 'Network Error' });
    const screen = await render(
      <TimelineTab
        events={[checkInEvent('ci-1', 'coach-1', false)]}
        onLoad={jest.fn()}
        days={30}
        viewerId="coach-1"
        onMarkReviewed={onMarkReviewed}
      />,
    );
    await fireEvent.press(screen.getByTestId('timeline-checkin-review-ci-1'));
    expect(
      await screen.findByText('The service could not be reached. Check your connection and try again.'),
    ).toBeTruthy();
  });

  it('the hook posts the review and flips the row to reviewed', async () => {
    mockGetTimeline.mockResolvedValue({
      data: {
        meals: [],
        workouts: [],
        weights: [],
        checkIns: [
          { id: 'ci-9', coach_id: 'coach-1', reviewed_by_coach: false, date: '2026-10-05T00:00:00.000Z', mood: 4 },
        ],
      },
    });
    mockMarkReviewed.mockResolvedValue({ data: { id: 'ci-9', reviewed_by_coach: true } });
    const { result } = await renderHook(() => useClientDetailData('client-1', useTheme().colors));
    await act(async () => {
      await result.current.loadTimeline(30);
    });
    expect(result.current.timeline[0].checkIn).toEqual({ id: 'ci-9', coachId: 'coach-1', reviewed: false });
    await act(async () => {
      await result.current.markCheckInReviewed('ci-9');
    });
    expect(mockMarkReviewed).toHaveBeenCalledWith('client-1', 'ci-9');
    expect(result.current.timeline[0].checkIn?.reviewed).toBe(true);
  });
});

describe('U-A13-5: the Overview tile that opens the Action Queue shows its number', () => {
  it('has no "Pending actions" tile; "Open alerts" opens the Action Queue', async () => {
    (commandCenterApi.getOverview as jest.Mock).mockResolvedValue({
      data: {
        roster_size: 3,
        active_today: 1,
        check_in_rate_7day: 0.5,
        open_alerts: 2,
        at_risk_count: 0,
        win_streak_count: 0,
        unread_messages: 0,
        pending_actions: 14,
      },
    });
    const onNavigateToActionQueue = jest.fn();
    const screen = await render(<OverviewScreen onNavigateToActionQueue={onNavigateToActionQueue} />);
    const tile = await screen.findByTestId('command-center-kpi-open-alerts');
    expect(screen.queryByText('Pending actions')).toBeNull();
    expect(screen.queryByText('14')).toBeNull();
    await fireEvent.press(tile);
    expect(onNavigateToActionQueue).toHaveBeenCalled();
  });
});

const BASE_METRICS: LtvMetrics = {
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
  nrr_is_stub: true,
  next_milestone: { clients_needed: 0, mrr_target_cents: 0, mrr_target_label: '$0' },
  currency: 'usd',
  computed_at: new Date().toISOString(),
};

describe('U-A13-6: Revenue & LTV only claims what exists', () => {
  it('no CAC row or "Add CAC in Settings" link, and no "connect billing" hint', async () => {
    const apiGet = jest.fn().mockResolvedValue({ data: { ...BASE_METRICS, active_client_count: 4, churn_rate_pct: 25, net_revenue_retention_pct: 75 } });
    const screen = await render(<CoachLtvDashboard apiGet={apiGet} inlineMode />);
    await screen.findByTestId('ltv-stats-card');
    expect(screen.queryByText(/CAC/)).toBeNull();
    expect(screen.queryByText(/connect billing/i)).toBeNull();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('a coach with no clients sees a dash, not 0% churn and 100% retention', async () => {
    const apiGet = jest.fn().mockResolvedValue({ data: BASE_METRICS });
    const screen = await render(<CoachLtvDashboard apiGet={apiGet} inlineMode />);
    await screen.findByTestId('ltv-stats-card');
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.getAllByText('Shows once a client has an active package').length).toBe(2);
  });
});

describe('U-A13-7: the weekly insight has no dead "Schedule call" button', () => {
  it('shows "Send check-in" only', async () => {
    mockGetDraft.mockResolvedValue({
      data: {
        id: 'd-1',
        generatedPayload: { summary: 'Solid week', wins: [], concerns: [], suggested_actions: [], questions_for_coach: [] },
        modelUsed: 'model',
        tokensIn: 1,
        tokensOut: 1,
        costCents: 0,
      },
    });
    const screen = await render(<ClientInsightScreen />);
    await waitFor(() => expect(screen.getByTestId('insight-send-checkin')).toBeTruthy());
    expect(screen.queryByTestId('insight-schedule-call')).toBeNull();
    expect(screen.queryByText(/Schedule call/i)).toBeNull();
  });
});

describe('U-A13-8: the At-Risk empty state speaks plainly', () => {
  it('no risk-score numbers or PTM jargon', async () => {
    (commandCenterApi.getAtRisk as jest.Mock).mockResolvedValue({ data: { items: [], total_at_risk: 0 } });
    const screen = await render(<AtRiskScreen />);
    expect(await screen.findByText('No at-risk clients')).toBeTruthy();
    expect(screen.queryByText(/PTM|0\.3/)).toBeNull();
    expect(
      screen.getByText(/Clients who start missing check-ins, workouts or logs appear here\.\s+Risk levels update every night\./),
    ).toBeTruthy();
  });
});
