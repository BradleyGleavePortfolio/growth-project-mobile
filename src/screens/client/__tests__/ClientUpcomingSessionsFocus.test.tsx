/**
 * B-NOTIF-6: a booking push opens ClientUpcomingSessions with
 * params.sessionId (pushTapRouter CalendarSession). That session is outlined;
 * a session that is no longer scheduled gets one plain line above the list.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientUpcomingSessionsScreen from '../ClientUpcomingSessionsScreen';
import type { CoachingSession } from '../../../api/schedulingApi';

jest.mock('../../../api/schedulingApi', () => ({
  schedulingApi: {
    listMySessions: jest.fn(),
    cancelSession: jest.fn(),
    rescheduleSession: jest.fn(),
    getAvailability: jest.fn(),
  },
  resolveVideoUrl: () => null,
}));
import { schedulingApi } from '../../../api/schedulingApi';
const mockList = schedulingApi.listMySessions as jest.Mock;

function session(id: string, start: string): CoachingSession {
  return {
    id,
    coach_id: 'coach-1',
    client_id: 'client-1',
    session_type_id: null,
    status: 'scheduled',
    start_at: start,
    end_at: start,
    title: `Session ${id}`,
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
  } as CoachingSession;
}

async function renderWith(params?: { sessionId?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={qc}>
      <ClientUpcomingSessionsScreen route={params ? { params } : undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([
    session('sess-1', '2030-06-01T15:00:00.000Z'),
    session('sess-7', '2030-06-02T15:00:00.000Z'),
  ]);
});

describe('ClientUpcomingSessions opened from a booking push', () => {
  it('outlines the session the push named', async () => {
    const screen = await renderWith({ sessionId: 'sess-7' });
    await waitFor(() => expect(screen.getByTestId('upcoming-session-focused')).toBeTruthy());
    expect(screen.getAllByTestId('upcoming-session-focused')).toHaveLength(1);
    expect(screen.queryByTestId('upcoming-session-missing')).toBeNull();
  });

  it('says plainly when that session is no longer scheduled', async () => {
    const screen = await renderWith({ sessionId: 'sess-9' });
    await waitFor(() =>
      expect(
        screen.getByText('That session is no longer scheduled. Your upcoming sessions are below.'),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId('upcoming-session-focused')).toBeNull();
  });

  it('opened from the menu, nothing is outlined and no line is shown', async () => {
    const screen = await renderWith();
    await waitFor(() => expect(screen.getByText('Session sess-7')).toBeTruthy());
    expect(screen.queryByTestId('upcoming-session-focused')).toBeNull();
    expect(screen.queryByTestId('upcoming-session-missing')).toBeNull();
  });
});
