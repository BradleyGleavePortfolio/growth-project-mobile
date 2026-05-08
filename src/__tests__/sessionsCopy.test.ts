// Sessions copy tests — enforce concierge tone and per-actor labels.

import {
  statusLabelFor,
  videoProviderLabel,
  sessionTypeLabel,
  calendarConnectionLabel,
  SESSIONS_DISABLED_PLACEHOLDER,
  SESSIONS_EMPTY_NO_SESSIONS_CLIENT,
  SESSION_REQUEST_FORM,
  SESSION_PREPARE,
  COACH_AVAILABILITY,
  COACH_REQUEST_QUEUE,
  COACH_BRIEF,
} from '../constants/sessionsCopy';
import {
  ALL_SESSION_STATUSES,
  ALL_VIDEO_PROVIDERS,
  ALL_CALENDAR_CONNECTION_STATUSES,
} from '../types/sessions';

describe('sessions copy', () => {
  it('returns a non-empty label for every session status, per actor', () => {
    for (const status of ALL_SESSION_STATUSES) {
      const c = statusLabelFor(status, 'client');
      const co = statusLabelFor(status, 'coach');
      expect(typeof c).toBe('string');
      expect(c.length).toBeGreaterThan(0);
      expect(typeof co).toBe('string');
      expect(co.length).toBeGreaterThan(0);
    }
  });

  it('uses different copy for client vs coach on at least the high-trust statuses', () => {
    // The client/coach actors see different psychological framing — these
    // should NOT be identical strings.
    expect(statusLabelFor('requested', 'client')).not.toBe(
      statusLabelFor('requested', 'coach'),
    );
    expect(statusLabelFor('cancelled_by_coach', 'client')).not.toBe(
      statusLabelFor('cancelled_by_coach', 'coach'),
    );
    expect(statusLabelFor('no_show_coach', 'client')).not.toBe(
      statusLabelFor('no_show_coach', 'coach'),
    );
  });

  it('returns labels for every video provider and calendar connection state', () => {
    for (const v of ALL_VIDEO_PROVIDERS) {
      expect(videoProviderLabel(v).length).toBeGreaterThan(0);
    }
    for (const c of ALL_CALENDAR_CONNECTION_STATUSES) {
      expect(calendarConnectionLabel(c).length).toBeGreaterThan(0);
    }
  });

  it('returns labels for every session type', () => {
    expect(sessionTypeLabel('check_in')).toMatch(/check/i);
    expect(sessionTypeLabel('intro_consult')).toMatch(/intro/i);
  });

  it('avoids generic-booking vocabulary across all sessions copy', () => {
    // Doctrine: this is concierge access, not a marketplace booking app.
    // We allow these words ONLY if they don't appear; the test fails on hit.
    const banned = [
      'book now',
      'available slots',
      'marketplace',
      'instant booking',
      'appointment',
    ];
    const haystacks: string[] = [
      SESSIONS_DISABLED_PLACEHOLDER.title,
      SESSIONS_DISABLED_PLACEHOLDER.body,
      SESSIONS_EMPTY_NO_SESSIONS_CLIENT.title,
      SESSIONS_EMPTY_NO_SESSIONS_CLIENT.body,
      SESSION_REQUEST_FORM.title,
      SESSION_REQUEST_FORM.intro,
      SESSION_REQUEST_FORM.submit,
      SESSION_REQUEST_FORM.submittedBody,
      SESSION_PREPARE.title,
      SESSION_PREPARE.intro,
      COACH_AVAILABILITY.title,
      COACH_AVAILABILITY.intro,
      COACH_AVAILABILITY.emptyBody,
      COACH_REQUEST_QUEUE.title,
      COACH_REQUEST_QUEUE.emptyBody,
      COACH_BRIEF.preparingBody,
      COACH_BRIEF.noBriefBody,
    ];
    for (const word of banned) {
      for (const text of haystacks) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('uses concierge framing in the request flow', () => {
    expect(SESSION_REQUEST_FORM.intro.toLowerCase()).toContain('confirm');
    expect(SESSION_REQUEST_FORM.intro.toLowerCase()).not.toContain('book');
    expect(SESSION_REQUEST_FORM.submit.toLowerCase()).toContain('request');
  });
});
