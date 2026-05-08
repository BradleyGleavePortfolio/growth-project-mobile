/**
 * Render tests for all 7 sessions screens.
 *
 * Strategy: static imports, jest.fn() mocks for controllable state.
 * No jest.resetModules() to avoid duplicate-React issues.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../theme/tokens', () => ({
  colors: {
    bone: '#F5EFE4',
    cream: '#F1E8D5',
    ink: '#1A1A18',
    charcoal: '#3D3D3A',
    stone: '#B1A89F',
    forest: '#2C4A36',
    camel: '#B08D57',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  typography: {
    h2: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 24 },
    h3: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 20 },
    body: { fontFamily: 'Inter_400Regular', fontSize: 16 },
    bodyMd: { fontFamily: 'Inter_500Medium', fontSize: 16 },
    bodySmall: { fontFamily: 'Inter_400Regular', fontSize: 14 },
    caption: { fontFamily: 'Inter_500Medium', fontSize: 12 },
    eyebrow: { fontFamily: 'Inter_500Medium', fontSize: 11, textTransform: 'uppercase' },
  },
}));

jest.mock('../components/sessions/MockDataBanner', () => ({
  __esModule: true,
  default: () => null,
}));

// sessionsFlags mock — factory returns a constant-object module.
// Tests mutate the exported sessionsFlags object directly via getSessionsFlags().
jest.mock('../config/sessionsFlags', () => {
  const flags = {
    SESSIONS_ENABLED: false,
    SESSIONS_CLIENT_REQUESTS_ENABLED: false,
    SESSIONS_PREP_ENABLED: false,
    SESSIONS_COACH_AVAILABILITY_ENABLED: false,
    SESSIONS_VIDEO_PROVIDER_ENABLED: false,
    SESSIONS_BRIEF_ENABLED: false,
  };
  return {
    sessionsFlags: flags,
    isSessionsFeatureEnabled: (flag: string) =>
      flags.SESSIONS_ENABLED && (flags as Record<string, boolean>)[flag],
    __flags: flags,
  };
});

// sessionsClient mock — factory closes over an adapter slot that tests replace.
// The slot variable name starts with 'mock' to satisfy babel-jest hoisting rules.
const mockAdapterSlot = { current: null as Record<string, unknown> | null };

jest.mock('../services/sessions/sessionsClient', () => ({
  __USING_MOCK_DATA: true,
  getSessionsAdapter: () => mockAdapterSlot.current ?? {},
  __setSessionsAdapterForTests: (adapter: unknown) => {
    mockAdapterSlot.current = adapter as Record<string, unknown>;
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __flags } = require('../config/sessionsFlags') as {
  __flags: Record<string, boolean>;
};

function setFlagsOff() {
  Object.assign(__flags, {
    SESSIONS_ENABLED: false,
    SESSIONS_CLIENT_REQUESTS_ENABLED: false,
    SESSIONS_PREP_ENABLED: false,
    SESSIONS_COACH_AVAILABILITY_ENABLED: false,
    SESSIONS_VIDEO_PROVIDER_ENABLED: false,
    SESSIONS_BRIEF_ENABLED: false,
  });
}

function setFlagsOn() {
  Object.assign(__flags, {
    SESSIONS_ENABLED: true,
    SESSIONS_CLIENT_REQUESTS_ENABLED: true,
    SESSIONS_PREP_ENABLED: true,
    SESSIONS_COACH_AVAILABILITY_ENABLED: true,
    SESSIONS_VIDEO_PROVIDER_ENABLED: true,
    SESSIONS_BRIEF_ENABLED: true,
  });
}

function makeRoute<T extends object>(params: T) {
  return { params, key: 'test', name: 'test' } as never;
}
const fakeNavigation = {} as never;

// ─── Static screen imports ─────────────────────────────────────────────────────

import SessionsUpcomingScreen from '../screens/client/SessionsUpcomingScreen';
import SessionRequestScreen from '../screens/client/SessionRequestScreen';
import SessionPrepareScreen from '../screens/client/SessionPrepareScreen';
import CoachAvailabilityScreen from '../screens/coach/CoachAvailabilityScreen';
import CoachSessionRequestsScreen from '../screens/coach/CoachSessionRequestsScreen';
import CoachUpcomingCallsScreen from '../screens/coach/CoachUpcomingCallsScreen';
import CoachSessionBriefScreen from '../screens/coach/CoachSessionBriefScreen';

// ─── 1. SessionsUpcomingScreen ────────────────────────────────────────────────

describe('SessionsUpcomingScreen', () => {
  beforeEach(() => { setFlagsOff(); mockAdapterSlot.current = null; });

  it('renders the disabled placeholder when the feature flag is OFF', () => {
    const { getByTestId } = render(
      <SessionsUpcomingScreen
        route={makeRoute({ clientId: 'c1' })}
        navigation={fakeNavigation}
      />,
    );
    expect(getByTestId('sessions-disabled')).toBeTruthy();
  });

  it('renders session cards when mock adapter returns data', async () => {
    setFlagsOn();
    mockAdapterSlot.current = {
      listUpcomingForClient: async () => [
        {
          session: {
            id: 'test-1',
            clientId: 'c1',
            coachId: 'co1',
            type: 'check_in',
            status: 'confirmed',
            startsAt: new Date(Date.now() + 86400000).toISOString(),
            endsAt: new Date(Date.now() + 90000000).toISOString(),
            timezone: 'Europe/London',
            videoProvider: 'google_meet',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          isJoinable: false,
        },
      ],
    };
    const { findByTestId } = render(
      <SessionsUpcomingScreen
        route={makeRoute({ clientId: 'c1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(findByTestId('session-card-test-1')).resolves.toBeTruthy();
  });

  it('renders the error placeholder when the adapter throws', async () => {
    setFlagsOn();
    mockAdapterSlot.current = {
      listUpcomingForClient: async () => { throw new Error('network error'); },
    };
    const { findByTestId } = render(
      <SessionsUpcomingScreen
        route={makeRoute({ clientId: 'c1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(findByTestId('sessions-error')).resolves.toBeTruthy();
  });
});

// ─── 2. SessionRequestScreen ──────────────────────────────────────────────────

describe('SessionRequestScreen', () => {
  beforeEach(() => { setFlagsOff(); mockAdapterSlot.current = null; });

  it('renders the disabled placeholder when the feature flag is OFF', () => {
    const { getByTestId } = render(
      <SessionRequestScreen
        route={makeRoute({ clientId: 'c1', coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    expect(getByTestId('session-request-disabled')).toBeTruthy();
  });

  it('renders the form when the flag is ON', () => {
    setFlagsOn();
    const { getByTestId } = render(
      <SessionRequestScreen
        route={makeRoute({ clientId: 'c1', coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    expect(getByTestId('session-request-submit')).toBeTruthy();
  });
});

// ─── 3. SessionPrepareScreen ──────────────────────────────────────────────────

describe('SessionPrepareScreen', () => {
  beforeEach(() => { setFlagsOff(); mockAdapterSlot.current = null; });

  it('renders the disabled placeholder when the feature flag is OFF', () => {
    const { getByTestId } = render(
      <SessionPrepareScreen
        route={makeRoute({ sessionId: 's1' })}
        navigation={fakeNavigation}
      />,
    );
    expect(getByTestId('session-prepare-disabled')).toBeTruthy();
  });

  it('renders the acknowledge button when prompt data is available', async () => {
    setFlagsOn();
    mockAdapterSlot.current = {
      getPrepPrompt: async (id: string) => ({
        sessionId: id,
        prompts: ['What is your main focus?'],
        acknowledgedAt: undefined,
      }),
    };
    const { findByTestId } = render(
      <SessionPrepareScreen
        route={makeRoute({ sessionId: 's1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(findByTestId('session-prepare-ack-btn')).resolves.toBeTruthy();
  });
});

// ─── 4. CoachAvailabilityScreen ───────────────────────────────────────────────

describe('CoachAvailabilityScreen', () => {
  beforeEach(() => { setFlagsOff(); mockAdapterSlot.current = null; });

  it('renders the disabled placeholder when the feature flag is OFF', () => {
    const { getByTestId } = render(
      <CoachAvailabilityScreen
        route={makeRoute({ coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    expect(getByTestId('coach-availability-disabled')).toBeTruthy();
  });

  it('renders the calendar state box when the flag is ON', async () => {
    setFlagsOn();
    mockAdapterSlot.current = {
      listAvailabilityForClient: async () => [],
      getCalendarConnection: async () => 'not_connected',
    };
    const { findByTestId } = render(
      <CoachAvailabilityScreen
        route={makeRoute({ coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(findByTestId('coach-availability-cal-state')).resolves.toBeTruthy();
  });
});

// ─── 5. CoachSessionRequestsScreen ───────────────────────────────────────────

describe('CoachSessionRequestsScreen', () => {
  beforeEach(() => { setFlagsOff(); mockAdapterSlot.current = null; });

  it('renders the disabled placeholder when the feature flag is OFF', () => {
    const { getByTestId } = render(
      <CoachSessionRequestsScreen
        route={makeRoute({ coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    expect(getByTestId('coach-requests-disabled')).toBeTruthy();
  });

  it('renders the empty state when adapter returns no requests', async () => {
    setFlagsOn();
    mockAdapterSlot.current = { listRequestsForCoach: async () => [] };
    const { findByTestId } = render(
      <CoachSessionRequestsScreen
        route={makeRoute({ coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(findByTestId('coach-requests-empty')).resolves.toBeTruthy();
  });

  it('renders a request card with approve/decline buttons', async () => {
    setFlagsOn();
    mockAdapterSlot.current = {
      listRequestsForCoach: async () => [
        {
          session: {
            id: 'req-1',
            clientId: 'c1',
            coachId: 'co1',
            type: 'check_in',
            status: 'requested',
            startsAt: new Date(Date.now() + 86400000).toISOString(),
            endsAt: new Date(Date.now() + 90000000).toISOString(),
            timezone: 'Europe/London',
            videoProvider: 'unknown',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ageMinutes: 30,
          clientDisplayName: 'Test Client',
        },
      ],
    };
    const { findByTestId } = render(
      <CoachSessionRequestsScreen
        route={makeRoute({ coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(findByTestId('coach-request-req-1')).resolves.toBeTruthy();
    await expect(findByTestId('coach-request-approve-req-1')).resolves.toBeTruthy();
    await expect(findByTestId('coach-request-decline-req-1')).resolves.toBeTruthy();
  });
});

// ─── 6. CoachUpcomingCallsScreen ──────────────────────────────────────────────

describe('CoachUpcomingCallsScreen', () => {
  beforeEach(() => { setFlagsOff(); mockAdapterSlot.current = null; });

  it('renders the disabled placeholder when the feature flag is OFF', () => {
    const { getByTestId } = render(
      <CoachUpcomingCallsScreen
        route={makeRoute({ coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    expect(getByTestId('coach-upcoming-disabled')).toBeTruthy();
  });

  it('renders the empty state when there are no upcoming calls', async () => {
    setFlagsOn();
    mockAdapterSlot.current = { listUpcomingForCoach: async () => [] };
    const { findByTestId } = render(
      <CoachUpcomingCallsScreen
        route={makeRoute({ coachId: 'co1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(findByTestId('coach-upcoming-empty')).resolves.toBeTruthy();
  });
});

// ─── 7. CoachSessionBriefScreen ───────────────────────────────────────────────

describe('CoachSessionBriefScreen', () => {
  beforeEach(() => { setFlagsOff(); mockAdapterSlot.current = null; });

  it('renders the disabled placeholder when the feature flag is OFF', () => {
    const { getByTestId } = render(
      <CoachSessionBriefScreen
        route={makeRoute({ sessionId: 's1' })}
        navigation={fakeNavigation}
      />,
    );
    expect(getByTestId('coach-brief-disabled')).toBeTruthy();
  });

  it('renders a ready brief when adapter returns isReady: true', async () => {
    setFlagsOn();
    mockAdapterSlot.current = {
      getBrief: async (id: string) => ({
        sessionId: id,
        clientDisplayName: 'Test Client',
        highlights: ['Completed 5 of 7 check-ins this week.'],
        clientPrepNotes: ['Wants to discuss goal progress.'],
        generatedAt: new Date().toISOString(),
        isReady: true,
      }),
    };
    const { findByText } = render(
      <CoachSessionBriefScreen
        route={makeRoute({ sessionId: 's1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(
      findByText('Completed 5 of 7 check-ins this week.'),
    ).resolves.toBeTruthy();
  });

  it('renders the not-ready placeholder when isReady is false', async () => {
    setFlagsOn();
    mockAdapterSlot.current = {
      getBrief: async (id: string) => ({
        sessionId: id,
        clientDisplayName: 'Test Client',
        highlights: [],
        generatedAt: new Date().toISOString(),
        isReady: false,
      }),
    };
    const { findByTestId } = render(
      <CoachSessionBriefScreen
        route={makeRoute({ sessionId: 's1' })}
        navigation={fakeNavigation}
      />,
    );
    await expect(findByTestId('coach-brief-not-ready')).resolves.toBeTruthy();
  });
});
