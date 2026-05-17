// src/__tests__/coachLtvDashboard.test.tsx
//
// Tests for CoachLtvDashboard component.
// Uses mock data mode (EXPO_PUBLIC_USE_MOCK_COMMAND_CENTER=true) to
// avoid real network calls.

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import CoachLtvDashboard, { LtvMetrics } from '../components/command-center/CoachLtvDashboard';

// Force mock mode for all tests
jest.mock('../services/api', () => ({
  get: jest.fn(),
}));

// ─── Mock LTV data ─────────────────────────────────────────────────────────────

const MOCK_METRICS: LtvMetrics = {
  mrr_cents: 250000,
  mrr_label: '$2,500',
  active_client_count: 12,
  revenue_per_client_month_cents: 20833,
  revenue_per_client_month_label: '$208',
  avg_client_lifespan_months: 7.2,
  estimated_ltv_cents: 150000,
  estimated_ltv_label: '$1,500',
  churn_rate_pct: 8.3,
  net_revenue_retention_pct: 91.7,
  projected_annual_revenue_cents: 3000000,
  projected_annual_revenue_label: '$30,000',
  mrr_trend: 'up',
  mrr_30d_ago_cents: 230000,
  zero_churn_streak_months: 3,
  all_time_peak_rpcm_cents: 22500,
  all_time_peak_rpcm_label: '$225',
  is_new_rpcm_record: false,
  ltv_cac_ratio: null,
  next_milestone: {
    clients_needed: 2,
    mrr_target_cents: 300000,
    mrr_target_label: '$3,000 / mo',
  },
  currency: 'usd',
  computed_at: new Date().toISOString(),
};

// ─── Mock apiGet ───────────────────────────────────────────────────────────────

function makeApiGet(data: LtvMetrics = MOCK_METRICS) {
  return jest.fn().mockResolvedValue({ data });
}

function makeErrorApiGet() {
  return jest.fn().mockRejectedValue(new Error('Network error'));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderDashboard(apiGet = makeApiGet(), inlineMode = true) {
  return render(
    <CoachLtvDashboard apiGet={apiGet} inlineMode={inlineMode} />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CoachLtvDashboard', () => {
  describe('skeleton loading state', () => {
    it('renders the skeleton while data is loading', () => {
      // apiGet never resolves so we stay in loading state
      const apiGet = jest.fn(() => new Promise(() => {}));
      const { getByTestId } = render(
        <CoachLtvDashboard apiGet={apiGet} inlineMode />,
      );
      const dashboard = getByTestId('ltv-dashboard');
      expect(dashboard).toBeTruthy();
      // Skeleton should be visible — no hero numbers yet
      expect(() => screen.getByTestId('ltv-hero-rpcm')).toThrow();
    });
  });

  describe('loaded state', () => {
    it('renders RPCM hero number', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(screen.getByText('$208')).toBeTruthy();
    });

    it('renders LTV hero number', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-ltv')).toBeTruthy();
      });
      expect(screen.getByText('$1,500')).toBeTruthy();
    });

    it('renders zero-churn streak badge when streak > 0', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-streak-badge')).toBeTruthy();
      });
    });

    it('does not render streak badge when streak is 0', async () => {
      const noStreakData = { ...MOCK_METRICS, zero_churn_streak_months: 0 };
      renderDashboard(makeApiGet(noStreakData));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(() => screen.getByTestId('ltv-streak-badge')).toThrow();
    });

    it('renders stats card with churn rate', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-stats-card')).toBeTruthy();
      });
      expect(screen.getByText('8.3%')).toBeTruthy();
    });

    it('renders next milestone card', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-milestone-card')).toBeTruthy();
      });
      // Should mention clients needed
      expect(screen.getByText(/2 more clients/)).toBeTruthy();
    });

    it('does not render milestone card when clients_needed is 0', async () => {
      const data = {
        ...MOCK_METRICS,
        next_milestone: { ...MOCK_METRICS.next_milestone, clients_needed: 0 },
      };
      renderDashboard(makeApiGet(data));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(() => screen.getByTestId('ltv-milestone-card')).toThrow();
    });

    it('renders Record badge when is_new_rpcm_record is true', async () => {
      const data = { ...MOCK_METRICS, is_new_rpcm_record: true };
      renderDashboard(makeApiGet(data));
      await waitFor(() => {
        expect(screen.getByText('★ Record')).toBeTruthy();
      });
    });

    it('does not render Record badge when not a new record', async () => {
      renderDashboard(makeApiGet({ ...MOCK_METRICS, is_new_rpcm_record: false }));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(() => screen.getByText('★ Record')).toThrow();
    });
  });

  describe('trend colours', () => {
    it('shows "Growing" label for upward trend', async () => {
      renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'up' }));
      await waitFor(() => {
        expect(screen.getByText(/Growing/)).toBeTruthy();
      });
    });

    it('shows "Declining" label for downward trend', async () => {
      renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'down' }));
      await waitFor(() => {
        expect(screen.getByText(/Declining/)).toBeTruthy();
      });
    });

    it('shows "Holding" label for flat trend', async () => {
      renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'flat' }));
      await waitFor(() => {
        expect(screen.getByText(/Holding/)).toBeTruthy();
      });
    });
  });

  describe('error state', () => {
    it('shows error message when API call fails', async () => {
      renderDashboard(makeErrorApiGet());
      await waitFor(() => {
        expect(screen.getByText(/Unable to load LTV metrics/)).toBeTruthy();
      });
    });

    it('shows Retry button on error', async () => {
      renderDashboard(makeErrorApiGet());
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
      });
    });

    it('retries when Retry button is pressed', async () => {
      const apiGet = makeErrorApiGet();
      renderDashboard(apiGet);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
      });
      fireEvent.press(screen.getByRole('button', { name: /Retry/i }));
      // apiGet should be called a second time
      await waitFor(() => {
        expect(apiGet).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('accessibility', () => {
    it('has testID for dashboard root', async () => {
      const { getByTestId } = renderDashboard();
      expect(getByTestId('ltv-dashboard')).toBeTruthy();
    });

    it('streak badge has accessibility label', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-streak-badge')).toBeTruthy();
      });
      // ZeroChurnBadge has accessibilityLabel set
      expect(
        screen.getByLabelText(/3-month zero-churn streak/),
      ).toBeTruthy();
    });
  });

  describe('milestone copy', () => {
    it('uses singular "client" when clients_needed is 1', async () => {
      const data = {
        ...MOCK_METRICS,
        next_milestone: { ...MOCK_METRICS.next_milestone, clients_needed: 1 },
      };
      renderDashboard(makeApiGet(data));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-milestone-card')).toBeTruthy();
      });
      expect(screen.getByText(/1 more client[^s]/)).toBeTruthy();
    });

    it('uses plural "clients" when clients_needed > 1', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-milestone-card')).toBeTruthy();
      });
      expect(screen.getByText(/2 more clients/)).toBeTruthy();
    });
  });

  describe('empty revenue state', () => {
    it('renders without error when MRR is 0', async () => {
      const zeroData: LtvMetrics = {
        ...MOCK_METRICS,
        mrr_cents: 0,
        mrr_label: '$0',
        active_client_count: 0,
        revenue_per_client_month_cents: 0,
        revenue_per_client_month_label: '$0',
        estimated_ltv_cents: 0,
        estimated_ltv_label: '$0',
        churn_rate_pct: 0,
        projected_annual_revenue_cents: 0,
        projected_annual_revenue_label: '$0',
        zero_churn_streak_months: 0,
        next_milestone: { clients_needed: 0, mrr_target_cents: 10000, mrr_target_label: '$100 / mo' },
        mrr_trend: 'flat',
      };
      renderDashboard(makeApiGet(zeroData));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
    });
  });
});
