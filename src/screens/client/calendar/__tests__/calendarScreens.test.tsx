/**
 * S-SCHED client Calendar screens: types per attached coach, calm empty
 * states, booking (auto-approve vs request), one tap books once, a taken
 * slot refreshes, welcome mode resolves the seeded offering by name and
 * emits the tutorial signal, fallback when there is nothing to book, and
 * the session view (Join only with a link near the start, cancel explains
 * manual phone-calendar copy removal, recap shown).
 */
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, Linking, StyleSheet } from 'react-native';
import type { CoachingSession, SessionType } from '../../../../api/schedulingApi';

jest.mock('../../../../services/sentry', () => ({ captureError: jest.fn() }));

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
  phoneCalendarResultMessage: () => 'Saved to your phone calendar.',
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
const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a: unknown[]) => mockSetString(...a) }));

import { schedulingApi } from '../../../../api/schedulingApi';
import { addSessionToPhoneCalendar } from '../../../../calendar/phoneCalendar';
import type { CalendarStackParamList } from '../../../../navigation/calendarRoutes';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { emitTutorialSignal } from '../../../../tutorial/tutorialEvents';
import CalendarHomeScreen from '../CalendarHomeScreen';
import CalendarBookScreen, { bookedMessage, bookingErrorMessage, firstPageSpan, moveNeedsApprovalWarning, openTimesPage } from '../CalendarBookScreen';
import CalendarSessionScreen, { canJoin, clientLinkLine } from '../CalendarSessionScreen';
import { pickWelcomeType } from '../CalendarBookScreen';
import { statusLabel } from '../calendarUi';

describe('pickWelcomeType', () => {
  const list = [
    { id: 'a', name: 'Quick initialization' },
    { id: 'b', name: 'Renamed welcome', is_welcome: true },
    { id: 'c', name: 'Other' },
  ];
  it('marker id first, then is_welcome, then the seed name', () => {
    expect(pickWelcomeType(list, 'c')?.id).toBe('c');
    expect(pickWelcomeType(list, null)?.id).toBe('b');
    expect(pickWelcomeType([list[0], list[2]], undefined)?.id).toBe('a');
    expect(pickWelcomeType([list[2]], 'missing')).toBeNull();
  });
});

const api = schedulingApi as jest.Mocked<typeof schedulingApi>;

const COACH = { coach_id: 'coach-1', name: 'Bradley', timezone: 'America/New_York' };
const WELCOME = {
  session_type_id: 'st-w',
  name: 'Quick initialization',
  duration_minutes: 15,
  active_session_id: null,
  active_session_status: null,
  active_session_start_at: null,
  completed_at: null,
};
function type(over: Partial<SessionType> = {}): SessionType {
  return {
    id: 'st-1',
    coach_id: 'coach-1',
    name: 'Quick Q/A Call',
    description: null,
    duration_minutes: 20,
    auto_approve: true,
    default_video_provider: 'manual',
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

const clients: QueryClient[] = [];
afterEach(async () => {
  await cleanup();
  for (const client of clients.splice(0)) client.clear();
});

async function renderQ(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  api.listMyCoaches.mockResolvedValue([COACH]);
  api.listSessionTypes.mockResolvedValue([type()]);
  api.getOpenSlots.mockResolvedValue({ coach_id: 'coach-1', timezone: 'America/New_York', generated_at: '', slots: [SLOT_A, SLOT_B] });
  api.listMySessions.mockResolvedValue([]);
});

function testNavigation<RouteName extends keyof CalendarStackParamList>(
  n: ReturnType<typeof nav>,
): NativeStackNavigationProp<CalendarStackParamList, RouteName> {
  // @ts-expect-error R0 partial navigator test double supplies the only two navigation methods these screens use; no real navigation container runs.
  return n;
}
const homeProps = (n = nav()) => ({ navigation: testNavigation<'CalendarHome'>(n), route: { key: 'h', name: 'CalendarHome' as const } });
const bookProps = (params: CalendarStackParamList['CalendarBook'], n = nav()) => ({ navigation: testNavigation<'CalendarBook'>(n), route: { key: 'b', name: 'CalendarBook' as const, params } });
const sessionProps = (n = nav()) => ({ navigation: testNavigation<'CalendarSession'>(n), route: { key: 's', name: 'CalendarSession' as const, params: { sessionId: 'sess-1' } } });

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

  it('S-SCHED-5 merge (#324): no coach -> Contact support opens the one support draft; no email app -> address, Copy, Try again', async () => {
    api.listMyCoaches.mockResolvedValue([]);
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('No email app')).mockResolvedValue(true);
    mockSetString.mockResolvedValue(true);
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-no-coach')).toBeTruthy());
    expect(r.queryByTestId('calendar-support-fallback')).toBeNull();
    await fireEvent.press(r.getByTestId('calendar-contact-support'));
    expect(open).toHaveBeenCalledWith('mailto:Bradleyapple1031@gmail.com?subject=Calendar%20help');
    await waitFor(() => expect(r.getByTestId('calendar-support-fallback-status')).toBeTruthy());
    expect(r.getByTestId('calendar-support-fallback-address').props.children).toBe('Bradleyapple1031@gmail.com');
    await fireEvent.press(r.getByTestId('calendar-support-fallback-copy'));
    await waitFor(() => expect(mockSetString).toHaveBeenCalledWith('Bradleyapple1031@gmail.com'));
    await fireEvent.press(r.getByTestId('calendar-support-fallback-retry'));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    open.mockRestore();
  });

  it('shows upcoming with status using the existing list contract', async () => {
    api.listMySessions.mockResolvedValue([sess({ status: 'requested' })]);
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-session-sess-1')).toBeTruthy());
    expect(r.getByText('Requested, waiting for your coach')).toBeTruthy();
    expect(api.listMySessions).toHaveBeenCalledWith(50);
  });

  it('welcome card: not booked yet -> books in welcome mode', async () => {
    api.listMyCoaches.mockResolvedValue([{ ...COACH, welcome: WELCOME }]);
    const n = nav();
    const r = await renderQ(<CalendarHomeScreen {...homeProps(n)} />);
    await waitFor(() => expect(r.getByTestId('calendar-welcome-book-coach-1')).toBeTruthy());
    expect(r.getByText('Book your welcome call with Bradley')).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-welcome-book-coach-1'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarBook', { coachId: 'coach-1', welcome: true });
  });

  it('welcome card: booked -> shows its status and opens the session; done -> no card', async () => {
    api.listMyCoaches.mockResolvedValue([
      { ...COACH, welcome: { ...WELCOME, active_session_id: 'sess-w', active_session_status: 'requested', active_session_start_at: '2030-10-07T16:00:00.000Z' } },
    ]);
    const n = nav();
    const r = await renderQ(<CalendarHomeScreen {...homeProps(n)} />);
    await waitFor(() => expect(r.getByTestId('calendar-welcome-booked-coach-1')).toBeTruthy());
    expect(r.getByText(/Requested, waiting for your coach/)).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-welcome-booked-coach-1'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarSession', { sessionId: 'sess-w' });
    await cleanup();

    api.listMyCoaches.mockResolvedValue([{ ...COACH, welcome: { ...WELCOME, completed_at: '2030-09-01T10:00:00.000Z' } }]);
    const r2 = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r2.getByTestId('calendar-type-st-1')).toBeTruthy());
    expect(r2.queryByTestId('calendar-welcome-book-coach-1')).toBeNull();
    expect(r2.queryByTestId('calendar-welcome-booked-coach-1')).toBeNull();
  });

  it('a confirmed session without a call link reads calm, not broken', async () => {
    api.listMySessions.mockImplementation(async (_l, opts) => (opts?.scope === 'past' ? [] : [sess({ meeting_link_status: 'pending' })]));
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-session-sess-1')).toBeTruthy());
    expect(r.getByText('Call link not added yet.')).toBeTruthy();
  });

  it('past sessions: newest first, Show earlier pages with the before cursor', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) =>
      sess({ id: `past-${i}`, status: 'completed', start_at: new Date(Date.UTC(2026, 8, 30 - i, 16)).toISOString(), end_at: new Date(Date.UTC(2026, 8, 30 - i, 17)).toISOString() }),
    );
    const page2 = [sess({ id: 'past-old', status: 'completed', start_at: '2026-08-01T16:00:00.000Z', end_at: '2026-08-01T17:00:00.000Z', client_recap_md: 'Nice work.' })];
    api.listMySessions.mockImplementation(async (_l, opts) => {
      if (opts?.scope !== 'past') return [];
      return opts.before ? page2 : page1;
    });
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-past-past-0')).toBeTruthy());
    expect(api.listMySessions).toHaveBeenCalledWith(20, { scope: 'past', before: undefined, beforeId: undefined });
    await fireEvent.press(r.getByTestId('calendar-past-more'));
    await waitFor(() => expect(r.getByTestId('calendar-past-past-old')).toBeTruthy());
    // S-SCHED-3 (B-634-4 pair): the cursor carries the last row's id too.
    expect(api.listMySessions).toHaveBeenCalledWith(20, { scope: 'past', before: page1[19].start_at, beforeId: page1[19].id });
    expect(r.getByText('Recap from your coach inside.')).toBeTruthy();
    expect(r.queryByTestId('calendar-past-more')).toBeNull();
  });

  it('no past sessions -> a plain note', async () => {
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-past-empty')).toBeTruthy());
  });

  it('failed sessions never pretend to be an empty schedule', async () => {
    api.listMySessions.mockImplementation((_l, opts) =>
      opts?.scope === 'past' ? Promise.resolve([]) : Promise.reject({ response: { status: 401 } }),
    );
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-sessions-error')).toBeTruthy());
    expect(r.getByText(/login expired/)).toBeTruthy();
    expect(r.queryByTestId('calendar-upcoming-empty')).toBeNull();
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
    });
    await act(async () => resolve(sess()));
    await waitFor(() => expect(r.getByTestId('calendar-book-done')).toBeTruthy());
    expect(r.getByText('Booked. Bradley will see it in the booking inbox.')).toBeTruthy();
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
    expect(r.getByText('Someone just booked that time. Refresh open times and pick another time.')).toBeTruthy();
    await waitFor(() => expect(api.getOpenSlots.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('welcome mode preselects the seeded type and uses its approved duration', async () => {
    api.listSessionTypes.mockResolvedValue([
      type({ id: 'st-qa', name: 'Quick Q/A Call' }),
      type({ id: 'st-w', name: 'Quick initialization', duration_minutes: 15 }),
    ]);
    api.requestSession.mockResolvedValue(sess({ session_type_id: 'st-w' }));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ welcome: true })} />);
    await waitFor(() => expect(r.getByText('Book your welcome call with Bradley')).toBeTruthy());
    expect(api.getOpenSlots).toHaveBeenCalledWith('coach-1', expect.objectContaining({ durationMinutes: 15 }));
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(emitTutorialSignal).toHaveBeenCalledWith('welcome_call_booked'));
  });

  it('welcome mode follows the server marker even when the type was renamed', async () => {
    api.listMyCoaches.mockResolvedValue([{ ...COACH, welcome: { ...WELCOME, session_type_id: 'st-renamed', name: 'First chat', duration_minutes: 25 } }]);
    api.listSessionTypes.mockResolvedValue([
      type({ id: 'st-qa', name: 'Quick Q/A Call' }),
      type({ id: 'st-renamed', name: 'First chat', duration_minutes: 25, is_welcome: true }),
    ]);
    const r = await renderQ(<CalendarBookScreen {...bookProps({ welcome: true })} />);
    await waitFor(() => expect(r.getByText('Book your welcome call with Bradley')).toBeTruthy());
    expect(api.getOpenSlots).toHaveBeenCalledWith('coach-1', expect.objectContaining({ durationMinutes: 25, sessionTypeId: 'st-renamed' }));
  });

  it('welcome already booked -> shows it, satisfies the tutorial step, offers no second booking', async () => {
    api.listMyCoaches.mockResolvedValue([
      { ...COACH, welcome: { ...WELCOME, active_session_id: 'sess-w', active_session_status: 'scheduled', active_session_start_at: '2030-10-07T16:00:00.000Z' } },
    ]);
    api.listSessionTypes.mockResolvedValue([type({ id: 'st-w', name: 'Quick initialization', duration_minutes: 15, is_welcome: true })]);
    const n = nav();
    const r = await renderQ(<CalendarBookScreen {...bookProps({ welcome: true }, n)} />);
    await waitFor(() => expect(r.getByTestId('calendar-welcome-done')).toBeTruthy());
    expect(r.getByText(/It is booked for/)).toBeTruthy();
    expect(emitTutorialSignal).toHaveBeenCalledWith('welcome_call_booked');
    expect(r.queryByTestId('calendar-submit')).toBeNull();
    await fireEvent.press(r.getByTestId('calendar-welcome-open'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarSession', { sessionId: 'sess-w' });
  });

  it('welcome already done -> plain note and the tutorial step is satisfied', async () => {
    api.listMyCoaches.mockResolvedValue([{ ...COACH, welcome: { ...WELCOME, completed_at: '2030-09-01T10:00:00.000Z' } }]);
    const r = await renderQ(<CalendarBookScreen {...bookProps({ welcome: true })} />);
    await waitFor(() => expect(r.getByTestId('calendar-welcome-done')).toBeTruthy());
    expect(r.getByText(/You have had your welcome call with Bradley/)).toBeTruthy();
    expect(emitTutorialSignal).toHaveBeenCalledWith('welcome_call_booked');
    expect(r.queryByTestId('calendar-welcome-open')).toBeNull();
  });

  it('pending request limit and busy calendar get their own next step', async () => {
    api.requestSession.mockRejectedValueOnce({ response: { status: 409, data: { code: 'PENDING_REQUEST_LIMIT' } } });
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(r.getByText(/several requests waiting for your coach/)).toBeTruthy());
    expect(bookingErrorMessage({ response: { status: 503, data: { code: 'CALENDAR_BUSY' } } })).toMatch(/Wait a few seconds/);
  });

  it('a booking with no call link yet says the coach will add it', async () => {
    api.requestSession.mockResolvedValue(sess({ meeting_link_status: 'pending' }));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(r.getByText('Booked. Bradley will see it in the booking inbox. Bradley will add the call link before it starts.')).toBeTruthy());
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
    await waitFor(() =>
      expect(
        r.getByText(
          'Moved. Bradley has the new time. If you copied this session to your phone calendar, update that copy in your calendar app.',
        ),
      ).toBeTruthy(),
    );
  });

  it('error copy: offline, payment, forbidden', () => {
    expect(bookingErrorMessage(new Error('Network Error'))).toMatch(/connection dropped/);
    expect(bookingErrorMessage({ response: { status: 402, data: {} } })).toMatch(/coaching plan/);
    expect(bookingErrorMessage({ response: { status: 403, data: {} } })).toMatch(/assigned coach/);
  });

  it('unknown booking outcome prevents repeat submission and asks to verify Calendar', async () => {
    api.requestSession.mockRejectedValue({ response: { status: 503, data: { request_id: 'req_1234567890123456' } } });
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(r.getByTestId('calendar-verify-booking')).toBeTruthy());
    expect(r.getByText(/reference req_12345678/)).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-submit'));
    expect(api.requestSession).toHaveBeenCalledTimes(1);
  });
});

describe('CalendarSessionScreen', () => {
  it('an incomplete session link gives a working Calendar fallback instead of crashing', async () => {
    const n = nav();
    const malformed = sessionProps(n);
    // @ts-expect-error R0 deliberately exercise missing runtime notification params despite the typed navigation contract.
    malformed.route.params = undefined;
    const r = await renderQ(<CalendarSessionScreen {...malformed} />);
    expect(r.getByText(/This session link is incomplete/)).toBeTruthy();
    expect(api.getSession).not.toHaveBeenCalled();
    await fireEvent.press(r.getByText('See Calendar'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarHome');
  });

  it('Join shows only with a real link inside the join window', () => {
    const start = Date.parse('2030-10-07T16:00:00.000Z');
    const withLink = sess({ video_url: 'https://meet.example/room' });
    expect(canJoin(withLink, start - 10 * 60_000)).toBe(true);
    expect(canJoin(withLink, start - 60 * 60_000)).toBe(false);
    expect(canJoin(sess({ video_url: 'tgp-stub://x' }), start)).toBe(false);
    expect(canJoin(sess({ video_url: 'https://meet.example/room', status: 'requested' }), start)).toBe(false);
  });

  it('opens the link on Join and shows the recap', async () => {
    const now = Date.now();
    api.getSession.mockResolvedValue(
      sess({
        start_at: new Date(now + 5 * 60_000).toISOString(),
        end_at: new Date(now + 25 * 60_000).toISOString(),
        video_url: 'https://meet.example/room',
        client_recap_md: 'Keep protein steady this week.',
      }),
    );
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-join')).toBeTruthy());
    expect(r.getByTestId('calendar-recap')).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-join'));
    expect(open).toHaveBeenCalledWith('https://meet.example/room');
    expect(r.queryByTestId('calendar-cancel')).toBeNull();
    open.mockRestore();
  });

  it('cancels after confirmation and discloses manual calendar-copy removal', async () => {
    api.getSession.mockResolvedValue(sess({ cancellable: true }));
    api.cancelSession.mockResolvedValue(sess({ status: 'canceled' }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-cancel')).toBeTruthy());
    await fireEvent.press(r.getByTestId('calendar-cancel'));
    expect(alert).toHaveBeenCalledWith('Cancel this session?', 'Bradley will be told.',
      expect.arrayContaining([expect.objectContaining({ text: 'Keep it', style: 'cancel' })]));
    await waitFor(() => expect(api.cancelSession).toHaveBeenCalledWith('sess-1', undefined));
    await waitFor(() => expect(r.getByText(/remove that copy/)).toBeTruthy());
    alert.mockRestore();
  });

  it('server flags: cancel allowed, reschedule not; pending link reads calm', async () => {
    api.getSession.mockResolvedValue(sess({ cancellable: true, reschedulable: false, meeting_link_status: 'pending' }));
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-cancel')).toBeTruthy());
    expect(r.queryByTestId('calendar-reschedule')).toBeNull();
    expect(r.getByTestId('calendar-session-link-pending')).toBeTruthy();
    expect(r.getByText('Call link not added yet.')).toBeTruthy();
  });

  it('a started session (server says not cancellable) explains why it is locked', async () => {
    api.getSession.mockResolvedValue(sess({ cancellable: false, reschedulable: false }));
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-session-status')).toBeTruthy());
    expect(r.getByText(/has started, so it can no longer be changed here/)).toBeTruthy();
    expect(r.queryByTestId('calendar-cancel')).toBeNull();
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

describe('DES-AF calendar hierarchy, truthful states and action parity', () => {
  it('retains every list recovery action and pull-to-refresh', async () => {
    api.listMyCoaches.mockRejectedValueOnce(new Error('Network Error'));
    api.listSessionTypes.mockRejectedValueOnce(new Error('Network Error'));
    const failed = new Set(['upcoming', 'past']);
    api.listMySessions.mockImplementation(async (_l, opts) => {
      if (failed.delete(opts?.scope === 'past' ? 'past' : 'upcoming')) throw new Error('Network Error');
      return [];
    });
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    for (const label of ['Refresh your coach', 'Refresh sessions', 'Refresh past sessions', 'Refresh appointment types']) {
      await waitFor(() => expect(r.getByText(label)).toBeTruthy());
      await fireEvent.press(r.getByText(label));
    }
    await waitFor(() => expect(r.getByTestId('calendar-type-st-1')).toBeTruthy());
    const count = api.listMySessions.mock.calls.length;
    await act(async () => r.getByTestId('calendar-home').props.refreshControl.props.onRefresh());
    await waitFor(() => expect(api.listMySessions.mock.calls.length).toBeGreaterThan(count));
  });

  it('retains recovery when a session read fails', async () => {
    api.getSession.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(sess());
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-session-missing')).toBeTruthy());
    await fireEvent.press(r.getByText('Try again'));
    await waitFor(() => expect(r.getByTestId('calendar-session-status')).toBeTruthy());
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it('puts the earliest live session above booking, with coach and real duration; later and past rows still open', async () => {
    const next = sess({ id: 'next', start_at: '2030-10-06T16:00:00.000Z', end_at: '2030-10-06T16:20:00.000Z' });
    api.listMySessions.mockImplementation(async (_l, opts) => opts?.scope === 'past'
      ? [sess({ id: 'past', status: 'completed' })] : [sess({ id: 'later' }), next]);
    const n = nav();
    const r = await renderQ(<CalendarHomeScreen {...homeProps(n)} />);
    await waitFor(() => expect(r.getByTestId('calendar-next-session')).toBeTruthy());
    expect(within(r.getByTestId('calendar-next-session')).getByTestId('calendar-session-next')).toBeTruthy();
    expect(r.getAllByText('With Bradley. 20 minutes.').length).toBeGreaterThan(0);
    const headings = r.getAllByRole('header').map((node) => node.props.children);
    expect(headings.indexOf('Next session')).toBeLessThan(headings.indexOf('Your coach'));
    for (const id of ['next', 'later', 'past']) {
      await fireEvent.press(r.getByTestId(id === 'past' ? 'calendar-past-past' : `calendar-session-${id}`));
      expect(n.navigate).toHaveBeenCalledWith('CalendarSession', { sessionId: id });
    }
  });

  it('keeps one real booking primary on an empty schedule and no coach-only message action without a coach', async () => {
    const n = nav();
    const r = await renderQ(<CalendarHomeScreen {...homeProps(n)} />);
    await waitFor(() => expect(r.getByText('Book a session')).toBeTruthy());
    await fireEvent.press(r.getByText('Book a session'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarBook', { coachId: 'coach-1', sessionTypeId: 'st-1' });
    await fireEvent.press(r.getByTestId('calendar-empty-message'));
    expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
    await cleanup();
    api.listMyCoaches.mockResolvedValue([]);
    const empty = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(empty.getByTestId('calendar-no-coach')).toBeTruthy());
    expect(empty.queryByTestId('calendar-empty-message')).toBeNull();
    expect(empty.queryByText('Book a session')).toBeNull();
  });

  it('offers a real Join from the next-session hero and keeps the link action', async () => {
    const now = Date.now();
    api.listMySessions.mockImplementation(async (_l, opts) => opts?.scope === 'past' ? [] : [sess({
      start_at: new Date(now + 5 * 60_000).toISOString(), end_at: new Date(now + 25 * 60_000).toISOString(),
      video_url: 'https://meet.example/room',
    })]);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-home-join')).toBeTruthy());
    expect(r.queryByText('Book a session')).toBeNull();
    await fireEvent.press(r.getByTestId('calendar-home-join'));
    expect(open).toHaveBeenCalledWith('https://meet.example/room');
    open.mockRestore();
  });

  it('preserves session calendar export, reschedule and messages with readable, tabular hero type', async () => {
    const s = sess({ cancellable: true, reschedulable: true });
    api.getSession.mockResolvedValue(s);
    const n = nav();
    const r = await renderQ(<CalendarSessionScreen {...sessionProps(n)} />);
    await waitFor(() => expect(r.getByTestId('calendar-reschedule')).toBeTruthy());
    expect(r.getByText('20 minutes.')).toBeTruthy();
    expect(StyleSheet.flatten(r.getByTestId('calendar-time-hero').props.style)).toMatchObject({
      fontFamily: 'CormorantGaramond_400Regular', fontVariant: ['tabular-nums'],
    });
    await fireEvent.press(r.getByTestId('calendar-add-phone'));
    await waitFor(() => expect(addSessionToPhoneCalendar).toHaveBeenCalledWith(s, 'Bradley'));
    await fireEvent.press(r.getByTestId('calendar-reschedule'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarBook', { coachId: 'coach-1', sessionTypeId: 'st-1', rescheduleSessionId: 'sess-1' });
    await fireEvent.press(r.getByTestId('calendar-session-message'));
    expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  });

  it('never promises a future link; ready and ended states make no missing-link claim', () => {
    for (const status of ['requested', 'scheduled'] as const) {
      expect(clientLinkLine(sess({ status }), 'Bradley', false)).toBe('Call link not added yet.');
      expect(clientLinkLine(sess({ status }), 'Bradley', true)).toBeNull();
    }
    expect(clientLinkLine(sess({ status: 'completed' }), 'Bradley', false)).toBeNull();
  });
});

// ─── S-SCHED-3 fix round (mobile #325 @ b0c02156 audit repros) ──────────────

describe('S-SCHED-3 B-325-1: a phone-call link is usable end to end', () => {
  const soon = () => {
    const now = Date.now();
    return { start_at: new Date(now + 5 * 60_000).toISOString(), end_at: new Date(now + 25 * 60_000).toISOString() };
  };

  it('a ready phone-call session offers Call, which opens the dialer with the number', async () => {
    api.getSession.mockResolvedValue(sess({ ...soon(), video_url: 'tel:+1 425 555 0100', meeting_link_status: 'ready' }));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-join')).toBeTruthy());
    expect(r.getByText('Call +1 425 555 0100')).toBeTruthy();
    expect(r.queryByTestId('calendar-session-link-pending')).toBeNull();
    await fireEvent.press(r.getByTestId('calendar-join'));
    expect(open).toHaveBeenCalledWith('tel:+14255550100');
    open.mockRestore();
  });

  it('a device that refuses the dialer gets the number and a next step', async () => {
    api.getSession.mockResolvedValue(sess({ ...soon(), video_url: 'tel:+1 425 555 0100' }));
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('Unable to open URL: tel:+14255550100'));
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-join')).toBeTruthy());
    await fireEvent.press(r.getByTestId('calendar-join'));
    await waitFor(() =>
      expect(r.getByTestId('calendar-session-msg').props.children).toBe(
        'This device could not start the call. Call +1 425 555 0100 from a phone, or message Bradley.',
      ),
    );
    open.mockRestore();
  });

  it('before the window the phone number is shown with when Call opens', async () => {
    api.getSession.mockResolvedValue(sess({ video_url: 'tel:+1 425 555 0100' }));
    const r = await renderQ(<CalendarSessionScreen {...sessionProps()} />);
    await waitFor(() => expect(r.getByTestId('calendar-join-later')).toBeTruthy());
    expect(r.getByText('This is a phone call on +1 425 555 0100. Call opens 15 minutes before the start.')).toBeTruthy();
  });

  it('other schemes never become a Join or Call action', () => {
    const start = Date.parse('2030-10-07T16:00:00.000Z');
    expect(canJoin(sess({ video_url: 'tel:+14255550100' }), start)).toBe(true);
    for (const url of ['javascript:alert(1)', 'sms:+14255550100', 'http://meet.example/room', 'https://u:p@meet.example/room', 'tel:call-me']) {
      expect(canJoin(sess({ video_url: url }), start)).toBe(false);
    }
  });
});

describe('S-SCHED-3 C-325-4: moving a confirmed approval-type session warns first', () => {
  it('shows the warning for a confirmed session whose type needs approval', async () => {
    api.listSessionTypes.mockResolvedValue([type({ auto_approve: false })]);
    api.getSession.mockResolvedValue(sess({ status: 'scheduled' }));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1', rescheduleSessionId: 'sess-1' })} />);
    await waitFor(() => expect(r.getByTestId('calendar-move-approval-warning')).toBeTruthy());
    expect(
      r.getByText(
        'This session is confirmed. Moving it sends the new time to Bradley for approval and gives up your current time. If Bradley declines, you will need to pick another time.',
      ),
    ).toBeTruthy();
  });

  it('no warning for instant-confirm types or for a move of a request', async () => {
    api.getSession.mockResolvedValue(sess({ status: 'scheduled' }));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1', rescheduleSessionId: 'sess-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_B.start_at}`)).toBeTruthy());
    expect(r.queryByTestId('calendar-move-approval-warning')).toBeNull();
    expect(moveNeedsApprovalWarning(sess({ status: 'requested' }), false, 'Bradley')).toBeNull();
  });

  it('a moved request repeats the phone-calendar note too', () => {
    expect(bookedMessage(sess({ status: 'requested' }), 'Bradley', true)).toMatch(/update that copy in your calendar app\.$/);
    expect(bookedMessage(sess({ status: 'scheduled' }), 'Bradley', false)).not.toMatch(/phone calendar/);
  });
});

// ─── B-SCH2-122 fix round (m#367 @ 6418e759 lens repros) ───────────────────

describe('Sol B-367-1: a regular type picked from the welcome fallback is not a welcome call', () => {
  it('a regular appointment selected from the welcome fallback is labelled as that appointment', async () => {
    api.listMyCoaches.mockResolvedValue([{ ...COACH, welcome: null }]);
    api.listSessionTypes.mockResolvedValue([type({ is_welcome: false })]);
    const r = await renderQ(<CalendarBookScreen {...bookProps({ welcome: true })} />);
    await waitFor(() => expect(r.getByTestId('calendar-book-fallback')).toBeTruthy());
    expect(r.getByText('Welcome call with Bradley')).toBeTruthy();
    await fireEvent.press(r.getByText('Quick Q/A Call, 20 minutes'));
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    expect(r.queryByText('Book your welcome call with Bradley')).toBeNull();
    expect(r.getByText('Quick Q/A Call')).toBeTruthy();
  });

  it('booking a regular appointment from the welcome fallback does not report a welcome call booked', async () => {
    api.listMyCoaches.mockResolvedValue([{ ...COACH, welcome: null }]);
    api.listSessionTypes.mockResolvedValue([type({ is_welcome: false })]);
    api.requestSession.mockResolvedValue(sess({
      session_type: {
        id: 'st-1', name: 'Quick Q/A Call', duration_minutes: 20,
        auto_approve: true, is_welcome: false, archived: false,
      },
    }));
    const r = await renderQ(<CalendarBookScreen {...bookProps({ welcome: true })} />);
    await waitFor(() => expect(r.getByTestId('calendar-book-fallback')).toBeTruthy());
    await fireEvent.press(r.getByText('Quick Q/A Call, 20 minutes'));
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    await fireEvent.press(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`));
    await fireEvent.press(r.getByTestId('calendar-submit'));
    await waitFor(() => expect(r.getByTestId('calendar-book-done')).toBeTruthy());
    expect(api.requestSession).toHaveBeenCalledWith(expect.objectContaining({ session_type_id: 'st-1' }));
    expect(emitTutorialSignal).not.toHaveBeenCalledWith('welcome_call_booked');
  });
});

describe('Opus B-367-1: a request the coach did not answer in time reads as closed', () => {
  it('statusLabel names the expired status instead of the unknown-status default', () => {
    expect(statusLabel('expired')).toBe('Request closed, your coach did not answer in time');
    expect(statusLabel('expired')).not.toMatch(/Status unavailable/);
  });

  it('Calendar lists an expired request as closed', async () => {
    api.listMySessions.mockResolvedValue([sess({ status: 'expired' })]);
    const r = await renderQ(<CalendarHomeScreen {...homeProps()} />);
    await waitFor(() => expect(r.getAllByText(/Request closed, your coach did not answer in time/).length).toBeGreaterThan(0));
    expect(r.queryByText(/Status unavailable/)).toBeNull();
  });

  it('the session view (push tap target) says the request closed and offers another time', async () => {
    api.getSession.mockResolvedValue(sess({ status: 'expired' }));
    const n = nav();
    const r = await renderQ(<CalendarSessionScreen {...sessionProps(n)} />);
    await waitFor(() => expect(r.getByTestId('calendar-session-status')).toBeTruthy());
    expect(r.getByText('Request closed, your coach did not answer in time')).toBeTruthy();
    expect(r.queryByText(/Status unavailable/)).toBeNull();
    expect(r.queryByTestId('calendar-cancel')).toBeNull();
    expect(r.queryByTestId('calendar-reschedule')).toBeNull();
    await fireEvent.press(r.getByTestId('calendar-expired-rebook'));
    expect(n.navigate).toHaveBeenCalledWith('CalendarBook', { coachId: 'coach-1', sessionTypeId: 'st-1' });
  });
});

describe('CalendarBookScreen open times beyond two weeks (U-04-2)', () => {
  const LATER = { start_at: '2030-11-04T16:00:00.000Z', end_at: '2030-11-04T16:20:00.000Z' };
  const DAY = 24 * 60 * 60 * 1000;

  it('pages 14 days at a time inside the booking window', () => {
    const base = '2026-10-07T16:00:00.000Z';
    expect(openTimesPage(base, 0, 120, 'America/Los_Angeles')).toMatchObject({ fromIso: base, hasEarlier: false, hasLater: true });
    expect(Date.parse(openTimesPage(base, 1, 120, 'America/Los_Angeles').fromIso) - Date.parse(base)).toBe(14 * DAY);
    expect(openTimesPage(base, 8, 120, 'America/Los_Angeles')).toMatchObject({ hasEarlier: true, hasLater: false });
    expect(openTimesPage(base, 0, 7, 'America/Los_Angeles')).toMatchObject({
      hasLater: false,
      rangeLabel: 'Wednesday, October 7 to Wednesday, October 14',
    });
    // An older backend that does not echo the window: first page only.
    expect(openTimesPage(base, 0, undefined, 'America/Los_Angeles').hasLater).toBe(false);
    expect(firstPageSpan(undefined)).toBe('two weeks');
    expect(firstPageSpan(7)).toBe('7 days');
    expect(firstPageSpan(1)).toBe('1 day');
  });

  it('a 120-day window offers Show later times, which asks for the next 14 days, and Show earlier times goes back', async () => {
    const froms: string[] = [];
    api.getOpenSlots.mockImplementation(async (_coachId, args) => {
      if (!froms.includes(args.from)) froms.push(args.from);
      return {
        coach_id: 'coach-1', timezone: 'America/New_York', generated_at: '', booking_window_days: 120,
        slots: args.from === froms[0] ? [SLOT_A] : [LATER],
      };
    });
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId('calendar-later-times')).toBeTruthy());
    expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy();
    expect(r.queryByTestId('calendar-earlier-times')).toBeNull();
    await fireEvent.press(r.getByTestId('calendar-later-times'));
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${LATER.start_at}`)).toBeTruthy());
    expect(Date.parse(froms[1]) - Date.parse(froms[0])).toBe(14 * DAY);
    expect(r.getByTestId('calendar-times-range')).toBeTruthy();
    await fireEvent.press(r.getByTestId('calendar-earlier-times'));
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
  });

  it('nothing open in the first two weeks of a long window -> the fallback still offers later times', async () => {
    api.getOpenSlots.mockResolvedValue({ coach_id: 'coach-1', timezone: 'UTC', generated_at: '', booking_window_days: 60, slots: [] });
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId('calendar-later-times')).toBeTruthy());
    expect(r.getByTestId('calendar-book-fallback')).toBeTruthy();
    expect(r.getByText(/Show later times to look further ahead/)).toBeTruthy();
  });

  it('a backend without booking_window_days keeps the first two weeks and offers no later page', async () => {
    const r = await renderQ(<CalendarBookScreen {...bookProps({ coachId: 'coach-1', sessionTypeId: 'st-1' })} />);
    await waitFor(() => expect(r.getByTestId(`calendar-slot-${SLOT_A.start_at}`)).toBeTruthy());
    expect(r.queryByTestId('calendar-later-times')).toBeNull();
    expect(r.queryByTestId('calendar-times-range')).toBeNull();
  });
});
