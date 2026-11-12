/** Existing backend page size is 50; total_pending can exceed the returned items. */
import { coachHomeSources } from '../screens/coach/command-center/coachHomeSources';

const mockQueue = jest.fn();
jest.mock('../services/commandCenterApi', () => ({
  commandCenterApi: { getActionQueue: (...args: unknown[]) => mockQueue(...args) },
}));
jest.mock('../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../api/copilotApi', () => ({ copilotApi: { pathChangeDrafts: jest.fn() } }));

it('reads later queue pages before claiming the full alert count', async () => {
  const first = Array.from({ length: 50 }, (_, i) => ({
    alert_id: `ordinary-${i}`, alert_type: 'missed_checkins', dismissed_at: null,
    client_id: `c-${i}`, client_name: `Client ${i}`, message: 'A check-in waits.',
    created_at: new Date(Date.UTC(2026, 10, 5, 12, 50 - i)).toISOString(),
  }));
  const last = {
    alert_id: 'old-safety', alert_type: 'roman_crisis_reply', dismissed_at: null,
    client_id: 'c-last', client_name: 'Avery', message: 'Safety alert',
    created_at: '2026-11-05T11:00:00Z',
  };
  mockQueue.mockResolvedValueOnce({ data: { items: first, total_pending: 51 } })
    .mockResolvedValueOnce({ data: { items: [last], total_pending: 51 } });
  const alerts = await coachHomeSources.actionQueue!();
  expect(alerts).toHaveLength(51);
  expect(alerts.some((row) => row.alert_id === 'old-safety')).toBe(true);
});
