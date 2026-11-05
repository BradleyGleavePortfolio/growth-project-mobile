/**
 * COACH-HOME-134: the reads behind the coach Home hero, stat row and "Your
 * clients today", on existing endpoints only: GET /v1/coach/money/summary
 * (the calendar month so far), /coach/connect/payouts (Stripe's next payout),
 * /coach/command-center/ltv-metrics (monthly churn) and .../at-risk (most
 * urgent first). Every read throws on failure; the Home says so in words.
 * NEEDS-YOU-M: .../action-queue (the open alerts the Needs you card folds in) and Path Copilot's drafts (the workout
 * changes Roman's drafts counts), both existing reads.
 */
import api from '../../../services/api';
import { coachMoneyApi, nextPayout, toSummary } from '../../../api/coachMoneyApi';
import { commandCenterApi, type ActionQueueItem } from '../../../services/commandCenterApi';
import { copilotApi } from '../../../api/copilotApi';
import { monthWindow } from './coachHomeCopy';

const ALERT_PAGE = 100; // the server's largest page
const ALERT_PAGES_MAX = 20; // 2,000 open alerts; past that the read stops (C, edge, deferred to 10k clients)

/**
 * LO-934 B1 / LS-934 B3: every open alert, not only the newest page. The server answers newest first, `limit` rows a
 * page, and `total_pending` for all of them; this follows `before` (the last row's created_at) until it holds that
 * total, a page brings nothing new, or (no total) a page comes back short. Rows are kept once by alert_id. The Home's
 * Needs you card and the Needs you list both read through here, so an older open safety alert reaches both.
 */
export async function readOpenAlerts(): Promise<ActionQueueItem[]> {
  const rows = new Map<string, ActionQueueItem>();
  let before: string | undefined;
  for (let n = 0; n < ALERT_PAGES_MAX; n += 1) {
    const res = await commandCenterApi.getActionQueue(before ? { limit: ALERT_PAGE, before } : { limit: ALERT_PAGE });
    const items: ActionQueueItem[] = Array.isArray(res?.data?.items) ? res.data.items : [];
    const had = rows.size;
    for (const i of items) if (!rows.has(i.alert_id)) rows.set(i.alert_id, i);
    const total = res?.data?.total_pending;
    const done = typeof total === 'number' ? rows.size >= total : items.length < ALERT_PAGE;
    const last = items[items.length - 1]?.created_at;
    if (done || rows.size === had || !last || last === before) break;
    before = last;
  }
  return [...rows.values()];
}

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
  actionQueue: () => readOpenAlerts(),
  pathChangeDrafts: () => copilotApi.pathChangeDrafts(),
};

/** The queue and Path Copilot reads are optional: a Home given no queue counts no alerts, and no workout changes. */
export type CoachHomeSources = Omit<typeof coachHomeSources, 'actionQueue' | 'pathChangeDrafts'>
  & Partial<Pick<typeof coachHomeSources, 'actionQueue' | 'pathChangeDrafts'>>;
