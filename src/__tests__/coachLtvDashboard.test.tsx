// src/__tests__/coachLtvDashboard.test.tsx
//
// Tests for CoachLtvDashboard component.
// Uses mock data mode (EXPO_PUBLIC_USE_MOCK_COMMAND_CENTER=true) to
// avoid real network calls.

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import CoachLtvDashboard, { JEWEL_GOLD_STOPS, LtvMetrics } from '../components/command-center/CoachLtvDashboard';
import { brand, colors, gold, lightTokens } from '../theme/tokens';

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
  nrr_is_stub: false,
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

async function renderDashboard(apiGet = makeApiGet(), inlineMode = true) {
  return await render(
    <CoachLtvDashboard apiGet={apiGet} inlineMode={inlineMode} />,
  );
}

  // WCAG 2.x contrast ratio.
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CoachLtvDashboard', () => {
  describe('skeleton loading state', () => {
    it('renders the skeleton while data is loading', async () => {
      // apiGet never resolves so we stay in loading state
      const apiGet = jest.fn((): Promise<{ data: unknown }> => new Promise(() => {}));
      const { getByTestId } = await render(
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
      await renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(screen.getByText('$208')).toBeTruthy();
    });

    it('renders LTV hero number', async () => {
      await renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-ltv')).toBeTruthy();
      });
      expect(screen.getByText('$1,500')).toBeTruthy();
    });

    it('renders zero-churn streak badge when streak > 0', async () => {
      await renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-streak-badge')).toBeTruthy();
      });
    });

    it('does not render streak badge when streak is 0', async () => {
      const noStreakData = { ...MOCK_METRICS, zero_churn_streak_months: 0 };
      await renderDashboard(makeApiGet(noStreakData));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(() => screen.getByTestId('ltv-streak-badge')).toThrow();
    });

    it('renders stats card with churn rate', async () => {
      await renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('ltv-stats-card')).toBeTruthy();
      });
      expect(screen.getByText('8.3%')).toBeTruthy();
    });

    it('renders next milestone card', async () => {
      await renderDashboard();
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
      await renderDashboard(makeApiGet(data));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(() => screen.getByTestId('ltv-milestone-card')).toThrow();
    });

    it('renders Record badge when is_new_rpcm_record is true', async () => {
      const data = { ...MOCK_METRICS, is_new_rpcm_record: true };
      await renderDashboard(makeApiGet(data));
      await waitFor(() => {
        expect(screen.getByText('RECORD')).toBeTruthy();
      });
    });

    it('does not render Record badge when not a new record', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, is_new_rpcm_record: false }));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(() => screen.getByText('RECORD')).toThrow();
    });
  });

  describe('RECORD badge colours (owner #185 option 2, jewelry gold)', () => {
    const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
    const textColor = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style).color;

    it('paints the RPCM card deep forest with readable text, and leaves the LTV card on cream', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, is_new_rpcm_record: true }));
      await waitFor(() => expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy());
      expect(flat('ltv-hero-rpcm').backgroundColor).toBe(brand[800]);
      expect(textColor('Rev / client / mo')).toBe(brand[100]);
      expect(textColor('$208')).toBe(lightTokens.textOnAccent);
      expect(textColor('MRR: $2,500')).toBe(brand[100]);
      expect(flat('ltv-hero-ltv').backgroundColor).toBe(colors.cream);
      expect(textColor('Avg client LTV')).toBe('#2C2C2C');
      for (const c of [brand[100], lightTokens.textOnAccent]) expect(ratio(c, brand[800])).toBeGreaterThanOrEqual(4.5);
    });

    it('draws RECORD in deep forest on gold, and every gold stop keeps 4.5:1', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, is_new_rpcm_record: true }));
      await waitFor(() => expect(screen.getByTestId('ltv-record-badge')).toBeTruthy());
      expect(textColor('RECORD')).toBe(brand[800]);
      const ratios = JEWEL_GOLD_STOPS.map((s) => ratio(s.color, brand[800]));
      expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('gold STREAK and gain chips (owner 10-23: "Use the shiny gold on the STREAK and "+$200" chips? yes")', () => {
    type Node = ReturnType<typeof screen.getByTestId>;
    const GOLD = JEWEL_GOLD_STOPS.map((s) => ({ offset: s.offset, color: s.color.toUpperCase() }));
    // react-native-svg hands the native gradient [offset, ARGB, offset, ARGB, ...].
    const goldIn = (node: Node) =>
      node.queryAll((n) => Array.isArray(n.props.gradient)).map((g) => {
        const raw: number[] = g.props.gradient;
        return raw.flatMap((v, i) =>
          i % 2 ? [] : [{ offset: v, color: `#${(raw[i + 1] & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}` }],
        );
      });
    const words = (node: Node) => node.queryAll((n) => n.type === 'Text').map((t) => StyleSheet.flatten(t.props.style));

    it('draws the STREAK badge on jewel gold with solid deep-forest words', async () => {
      await renderDashboard();
      await waitFor(() => expect(screen.getByTestId('ltv-streak-pill')).toBeTruthy());
      const pill = screen.getByTestId('ltv-streak-pill');
      expect(goldIn(pill)).toEqual([GOLD]);
      expect(StyleSheet.flatten(pill.props.style).backgroundColor).toBeUndefined();
      const styles = words(pill);
      expect(styles).toHaveLength(3);
      for (const s of styles) {
        expect(s.color).toBe(brand[800]);
        expect(s.opacity ?? 1).toBe(1);
      }
    });

    it('draws the gain chip ("+$200") on jewel gold with deep-forest words and no outline', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'up' }));
      await waitFor(() => expect(screen.getByText('+$200')).toBeTruthy());
      const chip = screen.getByTestId('ltv-trend-chip');
      expect(goldIn(chip)).toEqual([GOLD]);
      expect(StyleSheet.flatten(chip.props.style).borderWidth).toBe(0);
      expect(words(chip).map((s) => s.color)).toEqual([brand[800], brand[800]]);
    });

    it.each([
      ['flat', gold[800]],
      ['down', colors.error],
    ] as const)('keeps the %s chip in its outline colours, with no gold', async (trend, color) => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: trend }));
      await waitFor(() => expect(screen.getByTestId('ltv-trend-chip')).toBeTruthy());
      const chip = screen.getByTestId('ltv-trend-chip');
      expect(goldIn(chip)).toEqual([]);
      expect(StyleSheet.flatten(chip.props.style)).toMatchObject({ borderWidth: 1, borderColor: color });
      expect(words(chip).map((s) => s.color)).toEqual([color, color]);
    });
  });

  describe('readable flat chip, and a minus on the falling chip (owner D5 - A)', () => {
    const chipWords = () =>
      screen.getByTestId('ltv-trend-chip').queryAll((n) => n.type === 'Text').map((t) => StyleSheet.flatten(t.props.style).color);

    it.each(['flat', 'down'] as const)('draws the %s chip words at 4.5:1 or more on the bone screen', async (trend) => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: trend }));
      await waitFor(() => expect(screen.getByTestId('ltv-trend-chip')).toBeTruthy());
      const [arrow, label] = chipWords();
      expect(arrow).toBe(label);
      expect(ratio(label, lightTokens.bgPrimary)).toBeGreaterThanOrEqual(4.5);
    });

    it('no longer draws the flat chip in muted gold (2.3:1 on bone)', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'flat' }));
      await waitFor(() => expect(screen.getByTestId('ltv-trend-chip')).toBeTruthy());
      expect(chipWords()).not.toContain(colors.mutedGold);
      expect(ratio(colors.mutedGold, lightTokens.bgPrimary)).toBeLessThan(4.5);
    });

    // Owner 10-26 13:5x: "2.) Darker gold" -> gold[800] #6B4F1A, 7.24:1 on bone (warningInk #8A6A2A was 4.78:1).
    it('draws the flat chip in the darker gold, at 7:1 or more on the bone screen', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'flat' }));
      await waitFor(() => expect(screen.getByTestId('ltv-trend-chip')).toBeTruthy());
      expect(gold[800]).toBe('#6B4F1A');
      expect(chipWords()).toEqual([gold[800], gold[800]]);
      expect(chipWords()).not.toContain(colors.warningInk);
      expect(ratio(gold[800], lightTokens.bgPrimary)).toBeGreaterThanOrEqual(7);
      expect(ratio(gold[800], lightTokens.bgPrimary)).toBeCloseTo(7.24, 2);
    });

    it.each([
      ['falling', 'down', 230000, 250000, '−$200'],
      ['rising', 'up', 250000, 230000, '+$200'],
      ['flat, no change', 'flat', 250000, 250000, '+$0'],
      ['flat, a small fall', 'flat', 245000, 250000, '−$50'],
      ['a fall under 50 cents', 'flat', 249960, 250000, '$0'],
    ] as const)('puts the sign before the dollars when %s', async (_name, trend, now, ago, label) => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: trend, mrr_cents: now, mrr_30d_ago_cents: ago }));
      await waitFor(() => expect(screen.getByTestId('ltv-trend-chip')).toBeTruthy());
      const chip = screen.getByTestId('ltv-trend-chip');
      const texts = chip.queryAll((n) => n.type === 'Text').map((t) => t.props.children);
      expect(texts[1]).toBe(label);
    });
  });

  describe('trend colours', () => {
    it('shows "Growing" label for upward trend', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'up' }));
      await waitFor(() => {
        expect(screen.getByText(/Growing/)).toBeTruthy();
      });
    });

    it('shows "Declining" label for downward trend', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'down' }));
      await waitFor(() => {
        expect(screen.getByText(/Declining/)).toBeTruthy();
      });
    });

    it('shows "Holding" label for flat trend', async () => {
      await renderDashboard(makeApiGet({ ...MOCK_METRICS, mrr_trend: 'flat' }));
      await waitFor(() => {
        expect(screen.getByText(/Holding/)).toBeTruthy();
      });
    });
  });

  describe('error state', () => {
    it('shows error message when API call fails', async () => {
      await renderDashboard(makeErrorApiGet());
      await waitFor(() => {
        expect(screen.getByText(/Unable to load LTV metrics/)).toBeTruthy();
      });
    });

    it('shows Retry button on error', async () => {
      await renderDashboard(makeErrorApiGet());
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
      });
    });

    it('retries when Retry button is pressed', async () => {
      const apiGet = makeErrorApiGet();
      await renderDashboard(apiGet);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
      });
      await fireEvent.press(screen.getByRole('button', { name: /Retry/i }));
      // apiGet should be called a second time
      await waitFor(() => {
        expect(apiGet).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('accessibility', () => {
    it('has testID for dashboard root', async () => {
      const { getByTestId } = await renderDashboard();
      expect(getByTestId('ltv-dashboard')).toBeTruthy();
    });

    it('streak badge has accessibility label', async () => {
      await renderDashboard();
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
      await renderDashboard(makeApiGet(data));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-milestone-card')).toBeTruthy();
      });
      expect(screen.getByText(/1 more client[^s]/)).toBeTruthy();
    });

    it('uses plural "clients" when clients_needed > 1', async () => {
      await renderDashboard();
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
      await renderDashboard(makeApiGet(zeroData));
      await waitFor(() => {
        expect(screen.getByTestId('ltv-hero-rpcm')).toBeTruthy();
      });
      expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
    });
  });
});
