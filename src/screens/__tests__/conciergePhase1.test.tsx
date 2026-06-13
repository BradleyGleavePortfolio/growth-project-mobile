/**
 * Concierge Phase 1 — screen-logic tests.
 *
 * Four cases:
 *   1. isWithinLockout boundary returns true within 4h, false beyond.
 *   2. CoachBookingInbox confirms a pending session via useApproveSession.
 *   3. CoachBookingInbox declines a pending session via useDeclineSession.
 *   4. ClientBookingRequest renders the empty-state path when the
 *      coach has no availability windows.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CoachBookingInboxScreen from '../coach/CoachBookingInboxScreen';
import ClientBookingRequestScreen from '../client/ClientBookingRequestScreen';
import { isWithinLockout } from '../client/ClientUpcomingSessionsScreen';
import type { CoachingSession } from '../../api/schedulingApi';

// Mock the API module.
jest.mock('../../api/schedulingApi', () => ({
  schedulingApi: {
    listMySessions: jest.fn(),
    getAvailability: jest.fn(),
    approveSession: jest.fn(),
    declineSession: jest.fn(),
    requestSession: jest.fn(),
    cancelSession: jest.fn(),
    rescheduleSession: jest.fn(),
  },
}));
import { schedulingApi } from '../../api/schedulingApi';
const mockApi = schedulingApi as unknown as {
  listMySessions: jest.Mock;
  getAvailability: jest.Mock;
  approveSession: jest.Mock;
  declineSession: jest.Mock;
  requestSession: jest.Mock;
  cancelSession: jest.Mock;
  rescheduleSession: jest.Mock;
};

// Stub useCurrentUser so booking screen has a coach.
jest.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-1', email: 'c@x', coach_id: 'coach-1' }),
}));

function withQc(node: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  );
}

const PENDING: CoachingSession = {
  id: 'sess-pending',
  coach_id: 'coach-1',
  client_id: 'client-1',
  session_type_id: null,
  status: 'requested',
  start_at: '2026-06-01T15:00:00.000Z',
  end_at: '2026-06-01T15:30:00.000Z',
  title: 'Intro call',
  coach_notes_md: null,
  client_recap_md: null,
  video_provider: 'manual',
  video_url: null,
  video_meeting_id: null,
  calendar_provider: 'stub',
  calendar_event_id: null,
  approved_at: null,
  ended_at: null,
  end_reason: null,
  created_at: '2026-05-11T17:30:00.000Z',
  updated_at: '2026-05-11T17:30:00.000Z',
};

describe('isWithinLockout', () => {
  it('returns true when start is less than 4 hours away', () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const start = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
    expect(isWithinLockout(now, start)).toBe(true);
  });

  it('returns false when start is more than 4 hours away', () => {
    const now = new Date('2026-05-11T12:00:00.000Z');
    const start = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
    expect(isWithinLockout(now, start)).toBe(false);
  });
});

describe('CoachBookingInboxScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms a pending session via useApproveSession', async () => {
    mockApi.listMySessions.mockResolvedValue([PENDING]);
    mockApi.approveSession.mockResolvedValue({
      ...PENDING,
      status: 'scheduled',
    });
    const { findByLabelText } = withQc(<CoachBookingInboxScreen />);
    const btn = await findByLabelText('Confirm session Intro call');
    await fireEvent.press(btn);
    await waitFor(() =>
      expect(mockApi.approveSession).toHaveBeenCalledWith('sess-pending'),
    );
  });

  it('declines a pending session via useDeclineSession', async () => {
    mockApi.listMySessions.mockResolvedValue([PENDING]);
    mockApi.declineSession.mockResolvedValue({
      ...PENDING,
      status: 'declined',
    });
    const { findByLabelText } = withQc(<CoachBookingInboxScreen />);
    const btn = await findByLabelText('Decline session Intro call');
    await fireEvent.press(btn);
    await waitFor(() =>
      expect(mockApi.declineSession).toHaveBeenCalledWith(
        'sess-pending',
        undefined,
      ),
    );
  });
});

describe('ClientBookingRequestScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders empty-state when coach has no availability windows', async () => {
    mockApi.getAvailability.mockResolvedValueOnce([]);
    const { findByText } = withQc(<ClientBookingRequestScreen />);
    await findByText(
      'Available times will appear once your coach has set availability.',
    );
  });
});
