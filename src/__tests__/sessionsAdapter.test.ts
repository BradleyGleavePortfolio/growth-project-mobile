// Verifies the stub adapter returns safe empty state and that destructive
// methods refuse to silently succeed without a backend.

describe('sessions adapter (stub mode)', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_SESSIONS_ENABLED;
  });

  it('returns empty arrays for list operations', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSessionsAdapter } = require('../services/sessions/sessionsClient');
    const a = getSessionsAdapter();
    await expect(a.listUpcomingForClient('c1')).resolves.toEqual([]);
    await expect(a.listAvailabilityForClient('co1')).resolves.toEqual([]);
    await expect(a.listRequestsForCoach('co1')).resolves.toEqual([]);
    await expect(a.listUpcomingForCoach('co1')).resolves.toEqual([]);
  });

  it('returns null for individual lookups when nothing exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSessionsAdapter } = require('../services/sessions/sessionsClient');
    const a = getSessionsAdapter();
    await expect(a.getPrepPrompt('s1')).resolves.toBeNull();
    await expect(a.getRecap('s1')).resolves.toBeNull();
    await expect(a.getBrief('s1')).resolves.toBeNull();
  });

  it('reports calendar as not connected by default', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSessionsAdapter } = require('../services/sessions/sessionsClient');
    const a = getSessionsAdapter();
    await expect(a.getCalendarConnection('co1')).resolves.toBe('not_connected');
  });

  it('refuses destructive operations rather than silently succeeding', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSessionsAdapter } = require('../services/sessions/sessionsClient');
    const a = getSessionsAdapter();
    await expect(
      a.requestSession({
        clientId: 'c1',
        coachId: 'co1',
        type: 'check_in',
        preferredStart: new Date().toISOString(),
        preferredEnd: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toThrow(/backend not deployed/i);
    await expect(a.approveSession('s1')).rejects.toThrow(
      /backend not deployed/i,
    );
    await expect(a.markComplete('s1')).rejects.toThrow(/backend not deployed/i);
    await expect(a.markNoShow('s1', 'client')).rejects.toThrow(
      /backend not deployed/i,
    );
  });
});