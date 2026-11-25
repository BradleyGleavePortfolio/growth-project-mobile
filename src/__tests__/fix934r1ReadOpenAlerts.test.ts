/**
 * FIX-934R1 (agent 198), class-first siblings of LO-934 B1 / LS-934 B3: readOpenAlerts, the one reader the Home's
 * Needs you card and the Needs you list share, asks the server's largest page, follows `before`, keeps each alert
 * once, and always stops.
 */
const mockQueue = jest.fn();
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  commandCenterApi: { getActionQueue: (...a: unknown[]) => mockQueue(...a) },
}));
jest.mock('../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../api/copilotApi', () => ({ copilotApi: { pathChangeDrafts: jest.fn() } }));

import { readOpenAlerts } from '../screens/coach/command-center/coachHomeSources';

const row = (id: string, minute: number) => ({
  alert_id: id, alert_type: 'missed_checkins', client_id: id, client_name: id, message: 'm', dismissed_at: null,
  created_at: new Date(Date.UTC(2026, 10, 5, 12, minute)).toISOString(),
});
const page = (items: unknown[], total?: number) => Promise.resolve({ data: total === undefined ? { items } : { items, total_pending: total } });

beforeEach(() => mockQueue.mockReset());

describe('FIX-934R1: readOpenAlerts pages to the end and always stops', () => {
  it.each([
    ['one short page, no total', [page([row('a', 5), row('b', 4)])], 2, 1],
    ['total reached on page two', [page(Array.from({ length: 100 }, (_, i) => row(`r${i}`, 59 - (i % 59))), 101), page([row('old', 0)], 101)], 101, 2],
    ['a page that brings nothing new (mock data)', [page([row('a', 5)], 9), page([row('a', 5)], 9)], 1, 2],
    ['empty queue', [page([], 0)], 0, 1],
  ] as const)('%s', async (_k, pages, rows, calls) => {
    for (const p of pages) mockQueue.mockReturnValueOnce(p);
    const got = await readOpenAlerts();
    expect([got.length, mockQueue.mock.calls.length]).toEqual([rows, calls]);
  });
  it('asks 100 a page, then before = the last row of the page before', async () => {
    const first = Array.from({ length: 100 }, (_, i) => row(`r${i}`, 59 - (i % 59)));
    mockQueue.mockReturnValueOnce(page(first, 150)).mockReturnValueOnce(page([row('x', 0)], 150)).mockReturnValueOnce(page([], 150));
    await readOpenAlerts();
    expect(mockQueue.mock.calls.slice(0, 2)).toEqual([[{ limit: 100 }], [{ limit: 100, before: first[99].created_at }]]);
  });
  it('a failed page fails the read (the caller keeps its last good rows and says so)', async () => {
    mockQueue.mockReturnValueOnce(page(Array.from({ length: 100 }, (_, i) => row(`r${i}`, 59 - (i % 59))), 150)).mockRejectedValueOnce(new Error('offline'));
    await expect(readOpenAlerts()).rejects.toThrow('offline');
  });
});
