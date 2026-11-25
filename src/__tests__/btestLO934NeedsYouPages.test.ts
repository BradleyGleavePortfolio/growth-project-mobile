/**
 * B-TEST LO-934 B1 (Opus lens, m#934 @ 98258c2b): the Needs you fold reads the action queue one page at a time on the
 * server (backend main command-center.service.ts getActionQueue: newest first, 50 rows unless `limit` asks up to 100,
 * `before` = the last row's created_at for the next page, `total_pending` = every open alert). An open safety alert
 * behind 50 newer open alerts must still reach the Home's Needs you card.
 */
const mockGet = jest.fn();
jest.mock('../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));

import { coachHomeSources } from '../screens/coach/command-center/coachHomeSources';
import { isSafetyAlert } from '../services/commandCenterApi';

type Row = { alert_id: string; client_id: string; client_name: string; alert_type: string; message: string; created_at: string; dismissed_at: null; quote: null; sent_at: string };
const at = (minutesAgo: number) => new Date(Date.parse('2026-11-05T12:00:00Z') - minutesAgo * 60_000).toISOString();
// 120 open alerts: 119 risk alerts from the last two days, then one crisis safety alert, older than all of them.
const rows: Row[] = [
  ...Array.from({ length: 119 }, (_, k) => ({
    alert_id: `r${k}`, client_id: `c${k % 60}`, client_name: `Client ${k % 60}`, alert_type: 'risk_red_transition',
    message: `Client ${k % 60} crossed into the red risk band (81%).`, created_at: at(k * 20), dismissed_at: null, quote: null, sent_at: at(k * 20),
  })),
  { alert_id: 's1', client_id: 'avery', client_name: 'Avery Cole', alert_type: 'roman_crisis_reply', message: 'Roman sent Avery a crisis safety reply. Please check in with them today.', created_at: at(119 * 20 + 30), dismissed_at: null, quote: null, sent_at: at(119 * 20 + 30) },
];

/** The server's answer for a GET .../action-queue, as backend main pages it. */
function server(url: string, config?: { params?: Record<string, unknown> }) {
  const u = new URL(url, 'https://api.example');
  const p = { ...Object.fromEntries(u.searchParams.entries()), ...(config?.params ?? {}) } as Record<string, unknown>;
  const raw = Number(p.limit);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(100, Math.floor(raw)) : 50;
  const before = typeof p.before === 'string' ? Date.parse(p.before) : Infinity;
  const items = rows.filter((r) => Date.parse(r.created_at) < before).slice(0, limit);
  return Promise.resolve({ data: { items, total_pending: rows.length } });
}

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url.split('?')[0].endsWith('/coach/command-center/action-queue')) return server(url, config);
    return Promise.reject(new Error(`unexpected read ${url}`));
  });
});

describe('B-TEST LO-934 B1: the Needs you fold reads every open alert, not the first page', () => {
  it('an open safety alert behind 50 newer open alerts still reaches the Home Needs you card', async () => {
    const items = await coachHomeSources.actionQueue();
    expect(items.filter(isSafetyAlert).map((i) => i.alert_id)).toEqual(['s1']);
    expect(items.length).toBe(120);
  });
});
