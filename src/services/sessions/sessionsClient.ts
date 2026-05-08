// Typed API client + mock/stub adapter for the TGP scheduling backend.
//
// The real backend endpoints (availability, OAuth, providers, reminders) are
// listed in src/screens/sessions/README.md. Until they are deployed, this
// module returns realistic mock data so every screen renders a real-looking
// preview rather than a blank placeholder.
//
// Two adapters are exported:
//   - MockSessionsAdapter: returns realistic canned data with
//     __USING_MOCK_DATA: true so screens can show a "preview mode" banner.
//     Used when SESSIONS_ENABLED is ON (flag-flip in dev/preview builds).
//   - StubSessionsAdapter: returns completely empty/null responses.
//     Used when SESSIONS_ENABLED is OFF (the default in production).
//   - HttpSessionsAdapter: thin wrapper that will delegate to real axios
//     calls once /api/sessions/* routes ship. Currently delegates to mock.
//
// The screen layer should ALWAYS go through getSessionsAdapter() and never
// import these classes directly — that lets us swap implementations from
// flags/env without touching screens.

import type {
  CoachAvailability,
  CoachingSession,
  SessionBrief,
  SessionPrepPrompt,
  SessionRecap,
  SessionRequestSummary,
  SessionType,
  UpcomingSessionView,
  CalendarConnectionStatus,
} from '../../types/sessions';
import { sessionsFlags } from '../../config/sessionsFlags';

// When true, every response from the adapter contains mock data, not live
// backend data. Screens use this flag to show the "preview mode" banner.
export const __USING_MOCK_DATA = true;

export interface SessionsAdapter {
  // Client surfaces.
  listUpcomingForClient(clientId: string): Promise<UpcomingSessionView[]>;
  listAvailabilityForClient(coachId: string): Promise<CoachAvailability[]>;
  requestSession(input: {
    clientId: string;
    coachId: string;
    type: SessionType;
    preferredStart: string;
    preferredEnd: string;
    note?: string;
  }): Promise<CoachingSession>;
  cancelSession(sessionId: string): Promise<CoachingSession>;
  getPrepPrompt(sessionId: string): Promise<SessionPrepPrompt | null>;
  acknowledgePrep(sessionId: string): Promise<void>;
  getRecap(sessionId: string): Promise<SessionRecap | null>;

  // Coach surfaces.
  listRequestsForCoach(coachId: string): Promise<SessionRequestSummary[]>;
  listUpcomingForCoach(coachId: string): Promise<CoachingSession[]>;
  approveSession(sessionId: string): Promise<CoachingSession>;
  declineSession(
    sessionId: string,
    reason?: string,
  ): Promise<CoachingSession>;
  markComplete(sessionId: string): Promise<CoachingSession>;
  markNoShow(
    sessionId: string,
    party: 'client' | 'coach',
  ): Promise<CoachingSession>;
  getBrief(sessionId: string): Promise<SessionBrief | null>;
  getCalendarConnection(coachId: string): Promise<CalendarConnectionStatus>;
}

// ─── Shared mock helpers ──────────────────────────────────────────────────────

function isoHoursFromNow(h: number): string {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

function mockSession(
  id: string,
  type: SessionType,
  hoursFromNow: number,
): CoachingSession {
  const startsAt = isoHoursFromNow(hoursFromNow);
  const endsAt = isoHoursFromNow(hoursFromNow + 1);
  const now = new Date().toISOString();
  return {
    id,
    clientId: 'mock-client-1',
    coachId: 'mock-coach-1',
    type,
    status: 'confirmed',
    startsAt,
    endsAt,
    timezone: 'Europe/London',
    videoProvider: 'google_meet',
    // No real join URL — mock data intentionally omits it to trigger the
    // "link coming from your coach" display path, which is the honest copy.
    videoJoinUrl: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Mock adapter — realistic previews, clearly flagged as non-live ──────────

class MockSessionsAdapter implements SessionsAdapter {
  async listUpcomingForClient(_clientId: string): Promise<UpcomingSessionView[]> {
    const session = mockSession('mock-session-1', 'check_in', 48);
    return [
      {
        session,
        prep: {
          sessionId: 'mock-session-1',
          prompts: [
            'What progress have you made toward your main goal this week?',
            'What is the single biggest obstacle you are facing right now?',
            'What would make this call a success for you?',
          ],
          acknowledgedAt: undefined,
        },
        isJoinable: false,
      },
      {
        session: mockSession('mock-session-2', 'plan_review', 168),
        prep: undefined,
        isJoinable: false,
      },
    ];
  }

  async listAvailabilityForClient(_coachId: string): Promise<CoachAvailability[]> {
    const now = Date.now();
    return [
      {
        id: 'mock-avail-1',
        coachId: 'mock-coach-1',
        startsAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(now + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        sessionTypes: ['check_in', 'deep_dive'],
        isHeld: false,
        capacityRemaining: 1,
      },
    ];
  }

  async requestSession(input: {
    clientId: string;
    coachId: string;
    type: SessionType;
    preferredStart: string;
    preferredEnd: string;
    note?: string;
  }): Promise<CoachingSession> {
    // Mock: return a session in "requested" status so the confirmation flow works.
    return {
      id: 'mock-requested-1',
      clientId: input.clientId,
      coachId: input.coachId,
      type: input.type,
      status: 'requested',
      startsAt: input.preferredStart,
      endsAt: input.preferredEnd,
      timezone: 'Europe/London',
      videoProvider: 'unknown',
      clientRequestNote: input.note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async cancelSession(sessionId: string): Promise<CoachingSession> {
    return {
      ...mockSession(sessionId, 'check_in', 0),
      status: 'cancelled_by_client',
    };
  }

  async getPrepPrompt(sessionId: string): Promise<SessionPrepPrompt | null> {
    return {
      sessionId,
      prompts: [
        'What progress have you made toward your main goal this week?',
        'What is the single biggest obstacle you are facing right now?',
        'What would make this call a success for you?',
      ],
      acknowledgedAt: undefined,
    };
  }

  async acknowledgePrep(_sessionId: string): Promise<void> {
    // no-op in mock — acknowledgement is handled optimistically in the screen.
  }

  async getRecap(sessionId: string): Promise<SessionRecap | null> {
    return {
      sessionId,
      state: 'awaiting_coach',
      updatedAt: new Date().toISOString(),
    };
  }

  async listRequestsForCoach(_coachId: string): Promise<SessionRequestSummary[]> {
    return [
      {
        session: { ...mockSession('mock-req-1', 'deep_dive', 72), status: 'requested' },
        ageMinutes: 35,
        clientDisplayName: 'Alex Johnson',
      },
      {
        session: { ...mockSession('mock-req-2', 'check_in', 96), status: 'pending_coach_review' },
        ageMinutes: 120,
        clientDisplayName: 'Sam Davies',
      },
    ];
  }

  async listUpcomingForCoach(_coachId: string): Promise<CoachingSession[]> {
    return [
      mockSession('mock-upcoming-1', 'check_in', 24),
      mockSession('mock-upcoming-2', 'plan_review', 72),
    ];
  }

  async approveSession(sessionId: string): Promise<CoachingSession> {
    return { ...mockSession(sessionId, 'check_in', 48), status: 'confirmed' };
  }

  async declineSession(sessionId: string): Promise<CoachingSession> {
    return { ...mockSession(sessionId, 'check_in', 0), status: 'cancelled_by_coach' };
  }

  async markComplete(sessionId: string): Promise<CoachingSession> {
    return { ...mockSession(sessionId, 'check_in', -2), status: 'completed' };
  }

  async markNoShow(sessionId: string, party: 'client' | 'coach'): Promise<CoachingSession> {
    const status = party === 'client' ? 'no_show_client' : 'no_show_coach';
    return { ...mockSession(sessionId, 'check_in', -2), status };
  }

  async getBrief(sessionId: string): Promise<SessionBrief | null> {
    return {
      sessionId,
      clientDisplayName: 'Alex Johnson',
      highlights: [
        'Completed 5 of 7 check-ins this week — highest streak in 3 months.',
        'Reported lower energy on Thursday and Friday; sleep logged at under 6 hours both nights.',
        'Goal weight is 82 kg. Currently at 84.2 kg. Trend is down 0.4 kg over 14 days.',
      ],
      clientPrepNotes: [
        'Wants to discuss adjusting training days around a work trip next month.',
      ],
      generatedAt: new Date().toISOString(),
      isReady: true,
    };
  }

  async getCalendarConnection(_coachId: string): Promise<CalendarConnectionStatus> {
    return 'not_connected';
  }
}

// ─── Stub adapter — completely empty, used when flags are OFF ─────────────────

class StubSessionsAdapter implements SessionsAdapter {
  async listUpcomingForClient(): Promise<UpcomingSessionView[]> {
    return [];
  }
  async listAvailabilityForClient(): Promise<CoachAvailability[]> {
    return [];
  }
  async requestSession(): Promise<CoachingSession> {
    throw new Error(
      'Sessions backend not deployed. See src/screens/sessions/README.md.',
    );
  }
  async cancelSession(): Promise<CoachingSession> {
    throw new Error('Sessions backend not deployed.');
  }
  async getPrepPrompt(): Promise<SessionPrepPrompt | null> {
    return null;
  }
  async acknowledgePrep(): Promise<void> {
    // no-op in stub
  }
  async getRecap(): Promise<SessionRecap | null> {
    return null;
  }
  async listRequestsForCoach(): Promise<SessionRequestSummary[]> {
    return [];
  }
  async listUpcomingForCoach(): Promise<CoachingSession[]> {
    return [];
  }
  async approveSession(): Promise<CoachingSession> {
    throw new Error('Sessions backend not deployed.');
  }
  async declineSession(): Promise<CoachingSession> {
    throw new Error('Sessions backend not deployed.');
  }
  async markComplete(): Promise<CoachingSession> {
    throw new Error('Sessions backend not deployed.');
  }
  async markNoShow(): Promise<CoachingSession> {
    throw new Error('Sessions backend not deployed.');
  }
  async getBrief(): Promise<SessionBrief | null> {
    return null;
  }
  async getCalendarConnection(): Promise<CalendarConnectionStatus> {
    return 'not_connected';
  }
}

// HTTP adapter — when the backend ships, replace each method body with the
// corresponding axios call. Currently delegates to the mock so every screen
// shows a realistic preview rather than empty state.
class HttpSessionsAdapter extends MockSessionsAdapter {}

let cachedAdapter: SessionsAdapter | null = null;

export function getSessionsAdapter(): SessionsAdapter {
  if (cachedAdapter) return cachedAdapter;
  // When SESSIONS_ENABLED is ON, use the HTTP adapter (currently returns mock
  // data; replace with real calls once /api/sessions/* ships).
  // When SESSIONS_ENABLED is OFF, use the stub so screens render their
  // feature_disabled placeholders.
  cachedAdapter = sessionsFlags.SESSIONS_ENABLED
    ? new HttpSessionsAdapter()
    : new StubSessionsAdapter();
  return cachedAdapter;
}

// Test seam — lets unit tests inject a fake without monkey-patching modules.
export function __setSessionsAdapterForTests(adapter: SessionsAdapter | null) {
  cachedAdapter = adapter;
}
