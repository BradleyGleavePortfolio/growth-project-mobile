/**
 * S-SCHED coach settings: create/edit appointment types (S-SCHED-2 welcome
 * marker + default call link), archive/restore from the server list
 * (include_archived), agenda call-link entry and status, server-zone weekly
 * hours, and time off (blocked hours, date validation, confirmed removal).
 */
import React from 'react';
import { Alert } from 'react-native';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionType } from '../../../api/schedulingApi';

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
import CoachAppointmentTypesScreen, { validateDraft, emptyDraft, isHttpsLink } from '../CoachAppointmentTypesScreen';
import CoachTimeOffScreen, { describeOverride, validateTimeOff } from '../CoachTimeOffScreen';
import CoachBookingInboxScreen from '../CoachBookingInboxScreen';
import CoachAvailabilityEditorScreen from '../CoachAvailabilityEditorScreen';
import type { CoachingSession } from '../../../api/schedulingApi';

const api = schedulingApi as jest.Mocked<typeof schedulingApi>;

const T: SessionType = {
  id: 'st-1',
  coach_id: 'coach-1',
  name: 'Quick Q/A Call',
  description: null,
  duration_minutes: 20,
  auto_approve: true,
  default_video_provider: 'manual',
  archived_at: null,
  created_at: '',
  updated_at: '',
};

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

beforeEach(() => {
  jest.clearAllMocks();
  api.listSessionTypes.mockResolvedValue([T]);
  api.createSessionType.mockImplementation(async (i) => ({ ...T, ...i, id: 'st-new' }) as SessionType);
  api.updateSessionType.mockImplementation(async (id, input) => ({ ...T, ...input, id, archived_at: input.archived ? '2026-10-01T00:00:00Z' : null }));
  api.listMyAvailabilityOverrides.mockResolvedValue([]);
  api.getOpenSlots.mockResolvedValue({ coach_id: 'coach-1', timezone: 'America/Los_Angeles', generated_at: '', slots: [] });
  api.getAvailability.mockResolvedValue([]);
});

describe('Coach native scheduling agenda', () => {
  const scheduled: CoachingSession = {
    id: 's1', coach_id: 'coach-1', client_id: 'client-1', session_type_id: 'st-1',
    status: 'scheduled', start_at: '2030-10-05T16:00:00Z', end_at: '2030-10-05T16:20:00Z',
    title: 'Quick Q/A Call', coach_notes_md: null, client_recap_md: null,
    video_provider: 'manual', video_url: null, video_meeting_id: null,
    calendar_provider: 'stub', calendar_event_id: null, approved_at: null,
    ended_at: null, end_reason: null, created_at: '', updated_at: '',
  };

  it('gives the coach a real call-link entry point and rejects invalid links', async () => {
    api.listMySessions.mockResolvedValue([scheduled]);
    api.attachManualVideoLink.mockResolvedValue({ ...scheduled, video_url: 'https://meet.example/room' });
    const r = await renderQ(<CoachBookingInboxScreen />);
    await waitFor(() => expect(r.getByTestId('coach-call-link-s1')).toBeTruthy());
    await fireEvent.changeText(r.getByTestId('coach-call-link-s1'), 'http://unsafe.example');
    await fireEvent.press(r.getByTestId('coach-save-link-s1'));
    expect(api.attachManualVideoLink).not.toHaveBeenCalled();
    expect(r.getByText(/Enter a complete https/)).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('coach-call-link-s1'), 'https://meet.example/room');
    await fireEvent.press(r.getByTestId('coach-save-link-s1'));
    await waitFor(() => expect(api.attachManualVideoLink).toHaveBeenCalledWith('s1', { video_url: 'https://meet.example/room' }));
    await waitFor(() => expect(r.getByText(/Call link saved/)).toBeTruthy());
  });

  it('uses the server scheduling time zone in the weekly editor', async () => {
    const r = await renderQ(<CoachAvailabilityEditorScreen route={{ key: 'a', name: 'CoachAvailabilityEditor', params: { coachId: 'coach-1' } }} />);
    await waitFor(() => expect(r.getByText(/coach calendar time zone: America/)).toBeTruthy());
    expect(api.getOpenSlots).toHaveBeenCalledWith('coach-1', expect.objectContaining({ durationMinutes: 60 }));
  });
});

describe('CoachAppointmentTypesScreen', () => {
  it('lists every type of the coach, archived ones included, for restore', async () => {
    api.listSessionTypes.mockResolvedValue([T, { ...T, id: 'st-old', name: 'Old call', archived_at: '2026-09-01T00:00:00Z' }]);
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-type-st-1')).toBeTruthy());
    expect(api.listSessionTypes).toHaveBeenCalledWith('coach-1', { includeArchived: true });
    expect(r.getByText('Old call (archived)')).toBeTruthy();
    expect(r.getByText(/Archived types stay here so you can restore them/)).toBeTruthy();
  });

  it('marks a type as the welcome call and sets a default call link; empty clears it', async () => {
    api.listSessionTypes.mockResolvedValue([{ ...T, default_meeting_url: 'https://meet.example/old' }]);
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-type-edit-st-1')).toBeTruthy());
    expect(r.getByText('Default call link set.')).toBeTruthy();
    await fireEvent.press(r.getByTestId('coach-type-edit-st-1'));
    await fireEvent(r.getByTestId('coach-type-welcome'), 'valueChange', true);
    expect(r.getByText(/Only one type can be the welcome call/)).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('coach-type-link'), 'http://unsafe.example');
    await fireEvent.press(r.getByTestId('coach-type-save'));
    expect(api.updateSessionType).not.toHaveBeenCalled();
    expect(r.getByText(/Enter a complete https call link without a password, or leave the call link empty/)).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('coach-type-link'), '');
    await fireEvent.press(r.getByTestId('coach-type-save'));
    await waitFor(() =>
      expect(api.updateSessionType).toHaveBeenCalledWith('st-1', expect.objectContaining({ is_welcome: true, default_meeting_url: null })),
    );
  });

  it('an unchanged edit does not send the welcome or link fields', async () => {
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-type-edit-st-1')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-type-edit-st-1'));
    await fireEvent.press(r.getByTestId('coach-type-save'));
    await waitFor(() => expect(api.updateSessionType).toHaveBeenCalledTimes(1));
    const input = api.updateSessionType.mock.calls[0][1];
    expect(input).not.toHaveProperty('is_welcome');
    expect(input).not.toHaveProperty('default_meeting_url');
  });

  it('validates the default call link', () => {
    expect(isHttpsLink('https://meet.example/room')).toBe(true);
    expect(isHttpsLink('http://meet.example/room')).toBe(false);
    expect(isHttpsLink('https://user:pw@meet.example/room')).toBe(false);
    expect(isHttpsLink('not a link')).toBe(false);
    expect(validateDraft({ ...emptyDraft(), name: 'A', defaultLink: '' })).toBeNull();
    expect(validateDraft({ ...emptyDraft(), name: 'A', defaultLink: 'https://meet.example/a' })).toBeNull();
  });

  it('creates an editable appointment with manual video on the existing DTO', async () => {
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-types-add')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-types-add'));
    await fireEvent.changeText(r.getByTestId('coach-type-name'), 'Quick initialization');
    await fireEvent.changeText(r.getByTestId('coach-type-duration'), '15');
    await fireEvent(r.getByTestId('coach-type-auto'), 'valueChange', true);
    await fireEvent.press(r.getByTestId('coach-type-save'));
    await waitFor(() => expect(api.createSessionType).toHaveBeenCalledTimes(1));
    expect(api.createSessionType.mock.calls[0][0]).toEqual({
      name: 'Quick initialization',
      description: '',
      duration_minutes: 15,
      auto_approve: true,
      default_video_provider: 'manual',
    });
  });

  it('editing saves settings; archive and restore toggle against the server list', async () => {
    let rows: SessionType[] = [T];
    api.listSessionTypes.mockImplementation(async () => rows);
    api.updateSessionType.mockImplementation(async (id, input) => {
      const saved = { ...T, ...input, id, archived_at: input.archived ? '2026-10-01T00:00:00Z' : null };
      rows = rows.map((row) => (row.id === id ? saved : row));
      return saved;
    });
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-type-edit-st-1')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-type-edit-st-1'));
    await fireEvent.changeText(r.getByTestId('coach-type-name'), 'Edited call');
    await fireEvent.press(r.getByTestId('coach-type-save'));
    await waitFor(() =>
      expect(api.updateSessionType).toHaveBeenCalledWith('st-1', expect.objectContaining({ name: 'Edited call' })),
    );
    await fireEvent.press(r.getByTestId('coach-type-archive-st-1'));
    await waitFor(() => expect(api.updateSessionType).toHaveBeenCalledWith('st-1', { archived: true }));
    await waitFor(() => expect(r.getByText('Quick Q/A Call (archived)')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-type-archive-st-1'));
    await waitFor(() => expect(api.updateSessionType).toHaveBeenCalledWith('st-1', { archived: false }));
  });

  it('validates name, length and description', () => {
    expect(validateDraft({ ...emptyDraft(), name: '' })).toMatch(/name/);
    expect(validateDraft({ ...emptyDraft(), name: 'A', duration: '2' })).toMatch(/between 5 and 480/);
    expect(validateDraft({ ...emptyDraft(), name: 'A', description: 'x'.repeat(2001) })).toMatch(/2000/);
    expect(validateDraft({ ...emptyDraft(), name: 'A' })).toBeNull();
  });
});

describe('CoachTimeOffScreen', () => {
  it('adds a blocked stretch of hours and lists existing time off', async () => {
    api.listMyAvailabilityOverrides.mockResolvedValue([
      { id: 'ov-1', coach_id: 'coach-1', date: '2030-12-24T00:00:00.000Z', start_minute: null, end_minute: null, kind: 'holiday', note: null },
    ]);
    api.createAvailabilityOverride.mockResolvedValue({
      id: 'ov-2', coach_id: 'coach-1', date: '2030-12-26', start_minute: 780, end_minute: 900, kind: 'block', note: null,
    });
    const r = await renderQ(<CoachTimeOffScreen />);
    await waitFor(() => expect(r.getByText('2030-12-24, full day off')).toBeTruthy());
    await fireEvent.changeText(r.getByTestId('time-off-date'), '2030-12-26');
    await fireEvent(r.getByTestId('time-off-full-day'), 'valueChange', false);
    await fireEvent.changeText(r.getByTestId('time-off-start'), '13:00');
    await fireEvent.changeText(r.getByTestId('time-off-end'), '15:00');
    await fireEvent.press(r.getByTestId('time-off-add'));
    await waitFor(() =>
      expect(api.createAvailabilityOverride).toHaveBeenCalledWith({
        date: '2030-12-26',
        kind: 'block',
        start_time: '13:00',
        end_time: '15:00',
      }),
    );
  });

  it('removes time off after a confirm', async () => {
    api.listMyAvailabilityOverrides.mockResolvedValue([
      { id: 'ov-1', coach_id: 'coach-1', date: '2030-12-24T00:00:00.000Z', start_minute: null, end_minute: null, kind: 'holiday', note: null },
    ]);
    api.deleteAvailabilityOverride.mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.find((x) => x.style === 'destructive')?.onPress?.());
    const r = await renderQ(<CoachTimeOffScreen />);
    await waitFor(() => expect(r.getByTestId('time-off-remove-ov-1')).toBeTruthy());
    await fireEvent.press(r.getByTestId('time-off-remove-ov-1'));
    await waitFor(() => expect(api.deleteAvailabilityOverride).toHaveBeenCalledWith('ov-1'));
    alert.mockRestore();
  });

  it('validates date and times', () => {
    expect(validateTimeOff('12/26/2030', true, '', '', '2030-01-01')).toMatch(/YYYY-MM-DD/);
    expect(validateTimeOff('2029-01-01', true, '', '', '2030-01-01')).toMatch(/today or a later/);
    expect(validateTimeOff('2030-12-26', false, '15:00', '13:00', '2030-01-01')).toMatch(/after the start/);
    expect(validateTimeOff('2030-12-26', false, '9:00', '13:00', '2030-01-01')).toMatch(/HH:MM/);
    expect(validateTimeOff('2030-12-26', true, '', '', '2030-01-01')).toBeNull();
    expect(validateTimeOff('2030-02-30', true, '', '', '2030-01-01')).toMatch(/does not exist/);
    expect(describeOverride({ id: 'x', coach_id: 'c', date: '2030-12-26', start_minute: 780, end_minute: 900, kind: 'block', note: null })).toBe(
      '2030-12-26, off 13:00 to 15:00',
    );
  });
});
