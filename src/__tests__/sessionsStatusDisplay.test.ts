// Status-display tests: tone, action gating, join URL truthfulness.

import type { CoachingSession } from '../types/sessions';

function makeSession(over: Partial<CoachingSession> = {}): CoachingSession {
  const now = Date.now();
  return {
    id: 's1',
    clientId: 'c1',
    coachId: 'co1',
    type: 'check_in',
    status: 'confirmed',
    startsAt: new Date(now + 60_000).toISOString(),
    endsAt: new Date(now + 60 * 60_000).toISOString(),
    timezone: 'America/Los_Angeles',
    videoProvider: 'google_meet',
    videoJoinUrl: 'https://meet.google.com/abc-defg-hij',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    ...over,
  };
}

describe('sessionsStatusDisplay', () => {
  describe('with video provider flag OFF (default)', () => {
    let mod: typeof import('../lib/sessionsStatusDisplay');

    beforeAll(() => {
      jest.resetModules();
      delete process.env.EXPO_PUBLIC_SESSIONS_VIDEO_PROVIDER_ENABLED;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('../lib/sessionsStatusDisplay');
    });

    it('reports each status with a sensible tone', () => {
      expect(mod.statusTone('confirmed')).toBe('positive');
      expect(mod.statusTone('completed')).toBe('muted');
      expect(mod.statusTone('cancelled_by_coach')).toBe('attention');
      expect(mod.statusTone('no_show_client')).toBe('attention');
      expect(mod.statusTone('requested')).toBe('neutral');
    });

    it('lets a client cancel an in-flight session but not a completed one', () => {
      expect(mod.canCancel(makeSession({ status: 'confirmed' }), 'client')).toBe(
        true,
      );
      expect(mod.canCancel(makeSession({ status: 'requested' }), 'client')).toBe(
        true,
      );
      expect(mod.canCancel(makeSession({ status: 'completed' }), 'client')).toBe(
        false,
      );
      expect(
        mod.canCancel(makeSession({ status: 'cancelled_by_coach' }), 'client'),
      ).toBe(false);
    });

    it('lets a coach mark complete only on confirmed/rescheduled', () => {
      expect(mod.canMarkComplete(makeSession({ status: 'confirmed' }))).toBe(
        true,
      );
      expect(mod.canMarkComplete(makeSession({ status: 'rescheduled' }))).toBe(
        true,
      );
      expect(mod.canMarkComplete(makeSession({ status: 'requested' }))).toBe(
        false,
      );
      expect(mod.canMarkComplete(makeSession({ status: 'completed' }))).toBe(
        false,
      );
    });

    it('returns feature_disabled join display when the video flag is off, even with a real URL', () => {
      const j = mod.joinDisplay(makeSession());
      expect(j.kind).toBe('feature_disabled');
    });
  });

  describe('with video provider flag ON', () => {
    let mod: typeof import('../lib/sessionsStatusDisplay');

    beforeAll(() => {
      jest.resetModules();
      process.env.EXPO_PUBLIC_SESSIONS_VIDEO_PROVIDER_ENABLED = 'true';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('../lib/sessionsStatusDisplay');
    });

    afterAll(() => {
      delete process.env.EXPO_PUBLIC_SESSIONS_VIDEO_PROVIDER_ENABLED;
    });

    it('returns a real join display only for vetted https URLs', () => {
      const real = mod.joinDisplay(makeSession());
      expect(real.kind).toBe('real');
    });

    it('refuses to claim a join URL exists when adapter omits it', () => {
      const pending = mod.joinDisplay(
        makeSession({ videoJoinUrl: undefined }),
      );
      expect(pending.kind).toBe('pending');
    });

    it('rejects placeholder / example URLs as fake', () => {
      expect(
        mod.joinDisplay(
          makeSession({ videoJoinUrl: 'https://example.com/abc' }),
        ).kind,
      ).toBe('pending');
      expect(
        mod.joinDisplay(
          makeSession({ videoJoinUrl: 'https://meet.google.com/PLACEHOLDER' }),
        ).kind,
      ).toBe('pending');
    });

    it('rejects non-https URLs', () => {
      expect(
        mod.joinDisplay(
          makeSession({ videoJoinUrl: 'http://meet.google.com/abc' }),
        ).kind,
      ).toBe('pending');
    });

    it('reports phone calls without inventing a URL', () => {
      const j = mod.joinDisplay(
        makeSession({
          videoProvider: 'phone_call',
          videoJoinUrl: undefined,
        }),
      );
      expect(j.kind).toBe('phone');
    });

    it('refuses to render a fake URL even when provider is unknown', () => {
      const j = mod.joinDisplay(
        makeSession({
          videoProvider: 'unknown',
          videoJoinUrl: 'https://meet.google.com/abc-defg-hij',
        }),
      );
      expect(j.kind).toBe('pending');
    });

    it('opens the join window between T-10m and T+30m', () => {
      const start = new Date('2026-05-01T12:00:00Z');
      const end = new Date('2026-05-01T13:00:00Z');
      const s = makeSession({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });
      expect(mod.joinWindowOpen(s, new Date('2026-05-01T11:51:00Z'))).toBe(
        true,
      );
      expect(mod.joinWindowOpen(s, new Date('2026-05-01T11:49:00Z'))).toBe(
        false,
      );
      expect(mod.joinWindowOpen(s, new Date('2026-05-01T13:31:00Z'))).toBe(
        false,
      );
    });
  });
});
