/**
 * COACH-HOME-134: the reads behind the coach Home hero, stat row and "Your
 * clients today", on existing endpoints only: GET /v1/coach/money/summary
 * (the calendar month so far), /coach/connect/payouts (Stripe's next payout),
 * /coach/command-center/ltv-metrics (monthly churn) and .../at-risk (most
 * urgent first). Every read throws on failure; the Home says so in words.
 */
import api from '../../../services/api';
import { coachMoneyApi, nextPayout, toSummary } from '../../../api/coachMoneyApi';
import { commandCenterApi } from '../../../services/commandCenterApi';
import { monthWindow } from './coachHomeCopy';

export const coachHomeSources = {
  async monthSoFar(now: Date = new Date()) {
    const w = monthWindow(now);
    const params = { from: w.from.toISOString(), to: w.to.toISOString(), compare_from: w.compareFrom.toISOString(), compare_to: w.compareTo.toISOString() };
    const res = await api.get('/v1/coach/money/summary', { params });
    // toSummary rejects an answer for any other window (B-332-1).
    return toSummary(res.data, { window: { from: w.from, to: w.to }, currency: null }, (res as { headers?: unknown }).headers);
  },
  nextPayout: async () => nextPayout(await coachMoneyApi.payouts(10)),
  ltv: async () => (await commandCenterApi.getLtvMetrics()).data,
  atRisk: async () => {
    const res = await commandCenterApi.getAtRisk();
    return Array.isArray(res?.data?.items) ? res.data.items : [];
  },
};

export type CoachHomeSources = typeof coachHomeSources;
