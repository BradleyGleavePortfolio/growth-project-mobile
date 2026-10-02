jest.mock('../api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn() } }));

import { normalizeNotification } from '../notificationsApi';

describe('normalizeNotification (S-SCHED-2 live rows)', () => {
  it('maps a backend booking row to a routable center item', () => {
    const n = normalizeNotification({
      id: 'n-1',
      kind: 'booking_confirmed',
      body: 'Your session on Tue 3 Mar at 10:00 is confirmed.',
      payload: { title: 'Session confirmed', actionScreen: 'CalendarSession', actionParams: { sessionId: 's-1' }, category: 'booking' },
      deep_link: 'tgp://calendar/session/s-1',
      read_at: null,
      created_at: '2027-03-01T10:00:00.000Z',
    });
    expect(n).toEqual({
      id: 'n-1',
      kind: 'coach',
      title: 'Session confirmed',
      body: 'Your session on Tue 3 Mar at 10:00 is confirmed.',
      read: false,
      createdAt: '2027-03-01T10:00:00.000Z',
      actionScreen: 'CalendarSession',
      actionParams: { sessionId: 's-1' },
    });
  });

  it('reminders map to the reminder kind; read_at marks read; missing title gets a plain default', () => {
    const n = normalizeNotification({
      id: 'n-2',
      kind: 'booking_reminder_24h',
      body: 'Your session is tomorrow.',
      payload: { actionScreen: 'CoachBookingInbox', actionParams: { sessionId: 's-2', bad: { nested: true }, 'x y': 'z' } },
      read_at: '2027-03-01T11:00:00.000Z',
      created_at: '2027-03-01T10:00:00.000Z',
    });
    expect(n?.kind).toBe('reminder');
    expect(n?.read).toBe(true);
    expect(n?.title).toBe('Session reminder');
    expect(n?.actionParams).toEqual({ sessionId: 's-2' });
  });

  it('passes AppNotification-shaped items through and drops unusable rows', () => {
    const app = { id: 'a', kind: 'milestone', title: 'Week done', body: 'b', read: true, createdAt: '2027-01-01T00:00:00.000Z' };
    expect(normalizeNotification(app)).toEqual(app);
    expect(normalizeNotification(null)).toBeNull();
    expect(normalizeNotification({ kind: 'coach' })).toBeNull();
    const odd = normalizeNotification({ id: 'z', kind: 'something_new', payload: { actionScreen: 'not a screen' }, created_at: 'nope' });
    expect(odd?.kind).toBe('system');
    expect(odd?.actionScreen).toBeUndefined();
    expect(odd?.createdAt).toBe(new Date(0).toISOString());
  });
});
