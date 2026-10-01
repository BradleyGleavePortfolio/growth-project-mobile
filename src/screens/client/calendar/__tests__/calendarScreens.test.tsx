/**
 * S-SCHED client Calendar screens: types per attached coach, calm empty
 * states, booking (auto-approve vs request), one tap books once, a taken
 * slot refreshes, welcome mode resolves the welcome type by marker and
 * emits the tutorial signal, fallback when there is nothing to book, and
 * the session view (Join only with a link near the start, cancel removes
 * the phone event, recap shown).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, Linking } from 'react-native';
import type { CoachingSession, SessionType } from '../../../../api/schedulingApi';

jest.mock('../../../../api/schedulingApi', () => {
  const actual = jest.requireActual('../../../../api/schedulingApi');
  return {
    ...actual,
    resolveClientTimezone: () => 'America/Los_Angeles',
    schedulingApi: {
      listMyCoaches: jest.fn(),
      listSessionTypes: jest.fn(),
      getOpenSlots: jest.fn(),
      listMySessions: jest.fn(),
      getSession: jest.fn(),
      requestSession: jest.fn(),
      rescheduleSession: jest.fn(),
      cancelSession: jest.fn(),
    },
  };
});
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('../../../../calendar/phoneCalendar', () => ({
  addSessionToPhoneCalendar: jest.fn(async () => ({ kind: 'added', eventId: 'e1' })),
  removeSessionFromPhoneCalendar: jest.fn(async () => true),
  syncPhoneCalendar: jest.fn(async () => ({ removed: 0, updated: 0 })),
}));
jest.mock('react-native-safe-area-context', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      R.createElement(View, { style }, children),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('../../../../tutorial/tutorialEvents', () => ({ emitTutorialSignal: jest.fn() }));

import { schedulingApi } from '../../../../api/schedulingApi';
import { addSessionToPhoneCalendar, removeSessionFromPhoneCalendar } from '../../../../calendar/phoneCalendar';
import { emitTutorialSignal } from '../../../../tutorial/tutorialEvents';
import CalendarHomeScreen from '../CalendarHomeScreen';
import CalendarBookScreen, { bookingErrorMessage } from '../CalendarBookScreen';
import CalendarSessionScreen, { canJoin } from '../CalendarSessionScreen';

const api = schedulingApi as jest.Mocked<typeof schedulingApi>;

const COACH = { coach_id: 'coach-1', name: 'Bradley', timezone: 'America/New_York' };
function type(over: Partial<SessionType> = {}): SessionType {
  return {
    id: 'st-1',
    coach_id: 'coach-1',
    name: 'Quick Q/A Call',
    description: null,
    duration_minutes: 20,
    auto_approve: true,
    default_video_provider: 'manual',
    is_welcome: false,
    default_meeting_url: null,
    archived_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}
function sess(over: Partial<CoachingSession> = {}): CoachingSession {
  return {
    id: 'sess-1',
    coach_id: 'coach-1',
    client_id: 'client-1',
    session_type_id: 'st-1',
    status: 'scheduled',
    start_at: '2030-10-07T16:00:00.000Z',
    end_at: '2030-10-07T16:20:00.000Z',
    title: 'Quick Q/A Call',
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
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}
const SLOT_A = { start_at: '2030-10-07T16:00:00.000Z', end_at: '2030-10-07T16:20:00.000Z' };
const SLOT_B = { start_at: '2030-10-07T17:00:00.000Z', end_at: '2030-10-07T17:20:00.000Z' };

function nav() {
  return { navigate: jest.fn(), goBack: jest.fn() };
}

async function renderQ(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  api.listMyCoaches.mockResolvedValue([COACH]);
  api.listSessionTypes.mockResolvedValue([type()]);
  api.getOpenSlots.mockResolvedValue({ coach_id: 'coach-1', timezone: 'America/New_York', generated_at: '', slots: [SLOT_A, SLOT_B] });
  api.listMySessions.mockResolvedValue([]);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const homeProps = (n = nav()) => ({ navigation: n as any, route: { key: 'h', name: 'CalendarHome' } as any });
const bookProps = (params: object, n = nav()) => ({ navigation: n as any, route: { key: 'b', name: 'CalendarBook', params } as any });
const sessionProps = (n = nav()) => ({ navigation: n as any, route: { key: 's', name: 'CalendarSession', params: { sessionId: 'sess-1' } } as any });
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('CalendarHomeScreen', () => {
  it('lists the coach and their appointment types; tapping one opens booking', async () => {
    const n = nav();
    const r = await renderQ(<CalendarHomeScreen {...homeProps(n)} />);
    await waitFor(() => expect(r.getByTestId('calendar-type-st-1')).toBeTruthy());
    expect(r.getByText('Bradley')).toBeTruthy();
    expect(r.getByText(/works in America\/New York/)).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-type-st-1'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarBook', { coachId: 'coach-1', sessionTypeId: 'st-1' });
  });

  it('no types yet -> calm note and Message your coach', async () => {
    api.listSessionTypes.mockResolvedValue([]);
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-types-empty')).toBeTruthy());
    await fireEvent.press(r.getByTestId('calendar-message-coach'));
    expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  });

  it('no coach -> calm note, no booking', async () => {
    api.listMyCoaches.mockResolvedValue([]);
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-no-coach')).toBeTruthy());
  });

  it('shows upcoming with status, and past on the Past tab', async () => {
    api.listMySessions.mockImplementation(async (_l, scope) =>
      scope === 'past' ? [sess({ id: 'old', status: 'completed', title: 'Old call' })] : [sess({ status: 'requested' })],
    );
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-session-sess-1')).toBeTruthy());
    expect(r.getByText('Requested, waiting for your coach')).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-tab-past'));
    await waitFor(() => expect(r.getByText('Old call')).toBeTruthy());
    expect(r.getByText('Completed')).toBeTruthy();
  });
});

describe('CalendarBookScreen', () => {
  it('auto-approve: one tap books once and reads Booked', async () => {
    let resolve: (s: CoachingSession) => void = () => undefined;
    api.requestSession.mockImplementation(() => new Promise((res) => (resolve = res)));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    // Client sees their own clock (PDT) and the coach clock (EDT).
    expect(r.getByText('9:00 AM')).toBeTruthy();
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    expect(r.getByText('12:00 PM EDT coach time')).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    expect(api.requestSession).toHaveBeenCalledTimes(1);
    expect(api.requestSession.mock.calls[0][0]).toMatchObject({
      coach_id: 'coach-1',
      session_type_id: 'st-1',
      start_at: SLOT_A.start_at,
      end_at: SLOT_A.end_at,
      client_timezone: 'America/Los_Angeles',
    });
    await act(async () => resolve(sess()));
    await waitFor(() => expect(r.getByTestId('calendar-book-done')).toBeTruthy());
    expect(r.getByText('Booked. Bradley will see it in Calendar.')).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-add-phone'));
    await waitFor(() => expect(addSessionToPhoneCalendar).toHaveBeenCalled());
    expect(emitTutorialSignal).not.toHaveBeenCalled();
  });

  it('needs approval: reads Requested, waiting for your coach', async () => {
    api.listSessionTypes.mockResolvedValue([type({ auto_approve: false, name: 'Tele-Health Dietary/Fitness Check-in', duration_minutes: 45 })]);
    api.requestSession.mockResolvedValue(sess({ status: 'requested' }));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    expect(r.getByText('Request this time')).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(r.getByText(/Requested, waiting for your coach\./)).toBeTruthy());
  });

  it('a slot taken a moment earlier: calm message and the list refreshes', async () => {
    api.requestSession.mockRejectedValue({ response: { status: 409, data: { error: 'SLOT_TAKEN' } } });
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(r.getByTestId('calendar-book-error')).toBeTruthy());
    expect(r.getByText('That time was just taken or is no longer open. Please pick another.')).toBeTruthy();
    await waitFor(() => expect(api.getOpenSlots.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('welcome mode picks the type with the welcome marker (not by name) and emits the tutorial signal', async () => {
    api.listSessionTypes.mockResolvedValue([
      type({ id: 'st-qa', name: 'Quick initialization' }),
      type({ id: 'st-w', name: 'Hello', is_welcome: true, duration_minutes: 15 }),
    ]);
    api.requestSession.mockResolvedValue(sess({ session_type_id: 'st-w' }));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ welcome: true })} />);
    await waitFor(() => expect(r.getByText('Book your welcome call with Bradley')).toBeTruthy());
    expect(api.getOpenSlots).toHaveBeenCalledWith('coach-1', expect.objectContaining({ sessionTypeId: 'st-w' }));
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(emitTutorialSignal).toHaveBeenCalledWith('welcome_call_booked'));
  });

  it('welcome mode without a welcome type falls back to Calendar and Message your coach', async () => {
    api.listSessionTypes.mockResolvedValue([type()]);
    const n = nav();
    const r = await renderQ(<CalendarBookScreen {...bookProps({ welcome: true }, n)} />);
    await waitFor(() => expect(r.getByTestId('calendar-book-fallback')).toBeTruthy());
    await fireEvent.press(r.getByTestId('calendar-fallback-home'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarHome');
    await fireEvent.press(r.getByTestId('calendar-fallback-message'));
    expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  });

  it('no open times -> fallback, nothing to submit', async () => {
    api.getOpenSlots.mockResolvedValue({ coach_id: 'coach-1', timezone: 'UTC', generated_at: '', slots: [] });
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId('calendar-book-fallback')).toBeTruthy());
    expect(r.queryByTestId('calendar-submit')).toBeNull();
  });

  it('reschedule moves the existing session', async () => {
    api.getSession.mockResolvedValue(sess());
    api.rescheduleSession.mockResolvedValue(sess({ start_at: SLOT_B.start_at, end_at: SLOT_B.end_at }));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1', rescheduleSessionId: 'sess-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_B.start_at}`)).toBeTruthy());
    // The session's own current slot is not offered.
    expect(r.queryByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeNull();
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_B.start_at}`));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(api.rescheduleSession).toHaveBeenCalledWith('sess-1', expect.objectContaining({ start_at: SLOT_B.start_at })));
    await waitFor(() => expect(r.getByText('Moved. Bradley has the new time.')).toBeTruthy());
  });

  it('error copy: offline, payment, forbidden', () => {
    expect(bookingErrorMessage(new Error('Network Error'))).toMatch(/No connection/);
    expect(bookingErrorMessage({ response: { status: 402, data: {} } })).toMatch(/coaching plan/);
    expect(bookingErrorMessage({ response: { status: 403, data: {} } })).toMatch(/own coach/);
  });
});

describe('CalendarSessionScreen', () => {
  it('Join shows only with a real link inside the join window', () => {
    const start = Date.parse('2030-10-07T16:00:00.000Z');
    const withLink = sess({ video_url: 'https://meet.example/room' });
    expect(canJoin(withLink, start - 10 * 60_000)).toBe(true);
    expect(canJoin(withLink, start - 60 * 60_000)).toBe(false);
    expect(canJoin(sess({ video_url: 'tgp-stub://x' }), start)).toBe(false);
    expect(canJoin(sess({ video_url: 'https://meet.example/room', status: 'requested' }), start)).toBe(false);
  });

  it('opens the link on Join, shows the recap, and cancel removes the phone event', async () => {
    const now = Date.now();
    api.getSession.mockResolvedValue(
      sess({
        start_at: new Date(now + 5 * 60_000).toISOString(),
        end_at: new Date(now + 25 * 60_000).toISOString(),
        video_url: 'https://meet.example/room',
        client_recap_md: 'Keep protein steady this week.',
      }),
    );
    api.cancelSession.mockResolvedValue(sess({ status: 'canceled' }));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-join')).toBeTruthy());
    expect(r.getByTestId('calendar-recap')).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-join'));
    expect(open).toHaveBeenCalledWith('https://meet.example/room');
    await fireEvent.press(r.getByTestId('calendar-cancel'));
    await waitFor(() => expect(api.cancelSession).toHaveBeenCalledWith('sess-1', undefined));
    await waitFor(() => expect(removeSessionFromPhoneCalendar).toHaveBeenCalledWith('sess-1'));
    alert.mockRestore();
    open.mockRestore();
  });

  it('a past or cancelled session offers no reschedule or cancel', async () => {
    api.getSession.mockResolvedValue(sess({ status: 'canceled' }));
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-session-status')).toBeTruthy());
    expect(r.getByText('Cancelled')).toBeTruthy();
    expect(r.queryByTestId('calendar-reschedule')).toBeNull();
    expect(r.queryByTestId('calendar-cancel')).toBeNull();
    expect(r.queryByTestId('calendar-add-phone')).toBeNull();
  });
});
