/**
 * S-SCHED-3 (mobile #325 fix round), coach side:
 *  - B-325-2: every coach scheduling screen shows coach-worded errors, not
 *    the client's "message your coach" copy (one test per screen).
 *  - B-634-1 pair: Confirm/Decline send the start time on the card; a request
 *    the client moved meanwhile reads SESSION_MOVED copy and the inbox
 *    refreshes.
 *  - C-325-3: requests and the agenda come from the server status filter,
 *    paged on (start_at, id).
 *  - B-325-1: the coach can save a phone number as the call link.
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CoachingSession, SessionType } from '../../../api/schedulingApi';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

jest.mock('../../../api/schedulingApi', () => {
  const actual = jest.requireActual('../../../api/schedulingApi');
  return {
    ...actual,
    schedulingApi: {
      listSessionTypes: jest.fn(),
      createSessionType: jest.fn(),
      updateSessionType: jest.fn(),
      listMyAvailabilityOverrides: jest.fn(),
      createAvailabilityOverride: jest.fn(),
      deleteAvailabilityOverride: jest.fn(),
      getOpenSlots: jest.fn(),
      listMySessions: jest.fn(),
      approveSession: jest.fn(),
      declineSession: jest.fn(),
      attachManualVideoLink: jest.fn(),
      cancelSession: jest.fn(),
      getAvailability: jest.fn(),
      setAvailability: jest.fn(),
    },
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'c@x', role: 'coach' }),
}));

import { schedulingApi } from '../../../api/schedulingApi';
import { COACH_CODE_MESSAGES } from '../../../calendar/schedulingErrors';
import CoachAppointmentTypesScreen from '../CoachAppointmentTypesScreen';
import CoachTimeOffScreen from '../CoachTimeOffScreen';
import CoachBookingInboxScreen from '../CoachBookingInboxScreen';
import CoachAvailabilityEditorScreen from '../CoachAvailabilityEditorScreen';

const api = schedulingApi as jest.Mocked<typeof schedulingApi>;

const T: SessionType = {
  id: 'st-1', coach_id: 'coach-1', name: 'Quick Q/A Call', description: null, duration_minutes: 20,
  auto_approve: false, default_video_provider: 'manual', archived_at: null, created_at: '', updated_at: '',
};

function session(over: Partial<CoachingSession> = {}): CoachingSession {
  return {
    id: 'rq-1', coach_id: 'coach-1', client_id: 'client-1', session_type_id: 'st-1',
    status: 'requested', start_at: '2030-10-06T17:00:00.000Z', end_at: '2030-10-06T17:20:00.000Z',
    title: 'Quick Q/A Call', coach_notes_md: null, client_recap_md: null,
    video_provider: 'manual', video_url: null, video_meeting_id: null,
    calendar_provider: 'stub', calendar_event_id: null, approved_at: null,
    ended_at: null, end_reason: null, created_at: '', updated_at: '',
    ...over,
  };
}

const coded = (status: number, code: string) => ({ response: { status, data: { code, message: 'server text' } } });
const CLIENT_ONLY = /message your coach|assigned coach|choose an available time|Refresh Calendar/i;

const clients: QueryClient[] = [];
afterEach(async () => {
  await cleanup();
  for (const client of clients.splice(0)) client.clear();
});
function renderQ(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** listMySessions answers by the status filter the screen asks for. */
function serveByStatus(rows: CoachingSession[]) {
  api.listMySessions.mockImplementation(async (_limit, opts) => {
    const wanted = opts?.status;
    return wanted ? rows.filter((r) => wanted.includes(r.status)) : rows;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.listSessionTypes.mockResolvedValue([T]);
  api.listMyAvailabilityOverrides.mockResolvedValue([]);
  api.getOpenSlots.mockResolvedValue({ coach_id: 'coach-1', timezone: 'America/Los_Angeles', generated_at: '', slots: [] });
  api.getAvailability.mockResolvedValue([]);
  serveByStatus([]);
});

describe('CoachBookingInboxScreen (S-SCHED-3)', () => {
  it('asks the server for requests and confirmed sessions separately, then confirms with the start time on the card', async () => {
    serveByStatus([session(), session({ id: 'ok-1', status: 'scheduled', start_at: '2030-10-06T18:00:00.000Z', end_at: '2030-10-06T18:20:00.000Z' })]);
    api.approveSession.mockResolvedValue(session({ status: 'scheduled' }));
    const r = await renderQ(<CoachBookingInboxScreen />);
    await waitFor(() => expect(r.getByLabelText('Confirm session Quick Q/A Call')).toBeTruthy());
    expect(api.listMySessions).toHaveBeenCalledWith(50, { status: ['requested'], after: undefined, afterId: undefined });
    expect(api.listMySessions).toHaveBeenCalledWith(50, { status: ['scheduled', 'pending_provider'], after: undefined, afterId: undefined });
    expect(r.getByTestId('coach-agenda-ok-1')).toBeTruthy();
    await fireEvent.press(r.getByLabelText('Confirm session Quick Q/A Call'));
    await waitFor(() =>
      expect(api.approveSession).toHaveBeenCalledWith('rq-1', { expected_start_at: '2030-10-06T17:00:00.000Z' }),
    );
  });

  it('a request the client moved meanwhile reads coach copy and the inbox refreshes', async () => {
    serveByStatus([session()]);
    api.declineSession.mockRejectedValue(coded(409, 'SESSION_MOVED'));
    const r = await renderQ(<CoachBookingInboxScreen />);
    await waitFor(() => expect(r.getByLabelText('Decline session Quick Q/A Call')).toBeTruthy());
    const before = api.listMySessions.mock.calls.length;
    await fireEvent.press(r.getByLabelText('Decline session Quick Q/A Call'));
    await waitFor(() => expect(r.getByText(COACH_CODE_MESSAGES.SESSION_MOVED)).toBeTruthy());
    expect(api.declineSession).toHaveBeenCalledWith('rq-1', { expected_start_at: '2030-10-06T17:00:00.000Z' });
    expect(COACH_CODE_MESSAGES.SESSION_MOVED).not.toMatch(CLIENT_ONLY);
    await waitFor(() => expect(api.listMySessions.mock.calls.length).toBeGreaterThan(before));
  });

  it('a full page of requests offers Show more, which pages with after + after_id', async () => {
    const page = Array.from({ length: 50 }, (_, i) =>
      session({ id: `rq-${String(i).padStart(2, '0')}`, start_at: '2030-10-06T17:00:00.000Z' }),
    );
    api.listMySessions.mockImplementation(async (_l, opts) => {
      if (!opts?.status?.includes('requested')) return [];
      return opts.afterId ? [session({ id: 'rq-last', start_at: '2030-10-07T17:00:00.000Z', end_at: '2030-10-07T17:20:00.000Z', title: 'Last request' })] : page;
    });
    const r = await renderQ(<CoachBookingInboxScreen />);
    await waitFor(() => expect(r.getByTestId('coach-requests-more')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-requests-more'));
    await waitFor(() => expect(r.getByText('Last request')).toBeTruthy());
    expect(api.listMySessions).toHaveBeenCalledWith(50, {
      status: ['requested'],
      after: '2030-10-06T17:00:00.000Z',
      afterId: 'rq-49',
    });
  });

  it('a coach can save a phone number as the call link; other schemes are refused with a next step', async () => {
    const confirmed = session({ id: 's1', status: 'scheduled' });
    serveByStatus([confirmed]);
    api.attachManualVideoLink.mockResolvedValue({ ...confirmed, video_url: 'tel:+14255550100' });
    const r = await renderQ(<CoachBookingInboxScreen />);
    await waitFor(() => expect(r.getByTestId('coach-call-link-s1')).toBeTruthy());
    await fireEvent.changeText(r.getByTestId('coach-call-link-s1'), 'sms:+14255550100');
    await fireEvent.press(r.getByTestId('coach-save-link-s1'));
    expect(api.attachManualVideoLink).not.toHaveBeenCalled();
    expect(r.getByText(/or a phone number such as \+1 425 555 0100, then tap Save call link\./)).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('coach-call-link-s1'), '+1 425 555 0100');
    await fireEvent.press(r.getByTestId('coach-save-link-s1'));
    await waitFor(() => expect(api.attachManualVideoLink).toHaveBeenCalledWith('s1', { video_url: 'tel:+14255550100' }));
    await waitFor(() => expect(r.getByText('Phone number saved. Your client can call it from their session.')).toBeTruthy());
  });

  it('the agenda reads a saved phone number as ready', async () => {
    serveByStatus([session({ id: 's2', status: 'scheduled', video_url: 'tel:+1 425 555 0100', meeting_link_status: 'ready', client_name: 'Jamie' })]);
    const r = await renderQ(<CoachBookingInboxScreen />);
    await waitFor(() => expect(r.getByText('Confirmed with Jamie. Phone call on +1 425 555 0100.')).toBeTruthy());
  });
});

describe('B-325-2: coach-worded errors on every coach scheduling screen', () => {
  it('CoachAppointmentTypesScreen: an archive that lost a race reads coach copy', async () => {
    api.updateSessionType.mockRejectedValue(coded(409, 'SESSION_STATE_CHANGED'));
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-type-archive-st-1')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-type-archive-st-1'));
    await waitFor(() => expect(r.getByText(COACH_CODE_MESSAGES.SESSION_STATE_CHANGED)).toBeTruthy());
    expect(r.queryByText(/Refresh Calendar/)).toBeNull();
  });

  it('CoachAppointmentTypesScreen: an unavailable type tells the coach where to restore it', async () => {
    api.updateSessionType.mockRejectedValue(coded(404, 'SESSION_TYPE_UNAVAILABLE'));
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-type-archive-st-1')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-type-archive-st-1'));
    await waitFor(() => expect(r.getByText(/Open Appointment types to restore it/)).toBeTruthy());
  });

  it('CoachTimeOffScreen: a load failure gives a coach next step', async () => {
    api.listMyAvailabilityOverrides.mockRejectedValue({ response: { status: 403, data: {} } });
    const r = await renderQ(<CoachTimeOffScreen />);
    await waitFor(() => expect(r.getAllByText(/Refresh your schedule, or contact support\./).length).toBeGreaterThan(0));
    expect(r.queryAllByText(CLIENT_ONLY)).toHaveLength(0);
  });

  it('CoachAvailabilityEditorScreen: a load failure gives a coach next step', async () => {
    api.getAvailability.mockRejectedValue({ response: { status: 403, data: {} } });
    const r = await renderQ(
      <CoachAvailabilityEditorScreen route={{ key: 'a', name: 'CoachAvailabilityEditor', params: { coachId: 'coach-1' } }} />,
    );
    await waitFor(() => expect(r.getAllByText(/Refresh your schedule, or contact support\./).length).toBeGreaterThan(0));
    expect(r.queryAllByText(CLIENT_ONLY)).toHaveLength(0);
  });

  it('CoachBookingInboxScreen: a session that already started reads coach copy', async () => {
    serveByStatus([session()]);
    api.approveSession.mockRejectedValue(coded(409, 'SESSION_STARTED'));
    const r = await renderQ(<CoachBookingInboxScreen />);
    await waitFor(() => expect(r.getByLabelText('Confirm session Quick Q/A Call')).toBeTruthy());
    await fireEvent.press(r.getByLabelText('Confirm session Quick Q/A Call'));
    await waitFor(() => expect(r.getByText(COACH_CODE_MESSAGES.SESSION_STARTED)).toBeTruthy());
    expect(r.queryByText(/Message your coach/)).toBeNull();
  });
});
