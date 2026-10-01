/**
 * S-SCHED coach scheduling settings: appointment types manager (create with
 * welcome marker and meeting link, edit clears a link, archive / restore,
 * validation) and time off (full day / blocked hours, validation, remove).
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionType } from '../../../api/schedulingApi';

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
    },
  };
});
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'c@x', role: 'coach' }),
}));

import { schedulingApi } from '../../../api/schedulingApi';
import CoachAppointmentTypesScreen, { validateDraft, emptyDraft } from '../CoachAppointmentTypesScreen';
import CoachTimeOffScreen, { describeOverride, validateTimeOff } from '../CoachTimeOffScreen';

const api = schedulingApi as jest.Mocked<typeof schedulingApi>;

const T: SessionType = {
  id: 'st-1',
  coach_id: 'coach-1',
  name: 'Quick Q/A Call',
  description: null,
  duration_minutes: 20,
  auto_approve: true,
  default_video_provider: 'manual',
  is_welcome: false,
  default_meeting_url: 'https://meet.example/a',
  archived_at: null,
  created_at: '',
  updated_at: '',
};

function renderQ(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  api.listSessionTypes.mockResolvedValue([T, { ...T, id: 'st-2', name: 'Old', archived_at: '2026-09-01T00:00:00Z' }]);
  api.createSessionType.mockImplementation(async (i) => ({ ...T, ...i, id: 'st-new' }) as SessionType);
  api.updateSessionType.mockImplementation(async (id) => ({ ...T, id }));
  api.listMyAvailabilityOverrides.mockResolvedValue([]);
});

describe('CoachAppointmentTypesScreen', () => {
  it('lists active and archived types (archived included for the coach)', async () => {
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-type-st-1')).toBeTruthy());
    expect(api.listSessionTypes).toHaveBeenCalledWith('coach-1', { includeArchived: true });
    expect(r.getByText('Old (archived)')).toBeTruthy();
  });

  it('creates a welcome type with a meeting link and manual video', async () => {
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-types-add')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-types-add'));
    await fireEvent.changeText(r.getByTestId('coach-type-name'), 'Quick initialization');
    await fireEvent.changeText(r.getByTestId('coach-type-duration'), '15');
    await fireEvent(r.getByTestId('coach-type-auto'), 'valueChange', true);
    await fireEvent(r.getByTestId('coach-type-welcome'), 'valueChange', true);
    await fireEvent.changeText(r.getByTestId('coach-type-url'), 'https://meet.example/welcome');
    await fireEvent.press(r.getByTestId('coach-type-save'));
    await waitFor(() => expect(api.createSessionType).toHaveBeenCalledTimes(1));
    expect(api.createSessionType.mock.calls[0][0]).toEqual({
      name: 'Quick initialization',
      description: '',
      duration_minutes: 15,
      auto_approve: true,
      is_welcome: true,
      default_video_provider: 'manual',
      default_meeting_url: 'https://meet.example/welcome',
    });
  });

  it('editing and clearing the link sends null; archive and restore toggle', async () => {
    const r = await renderQ(<CoachAppointmentTypesScreen />);
    await waitFor(() => expect(r.getByTestId('coach-type-edit-st-1')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-type-edit-st-1'));
    await fireEvent.changeText(r.getByTestId('coach-type-url'), '');
    await fireEvent.press(r.getByTestId('coach-type-save'));
    await waitFor(() =>
      expect(api.updateSessionType).toHaveBeenCalledWith('st-1', expect.objectContaining({ default_meeting_url: null })),
    );
    await fireEvent.press(r.getByTestId('coach-type-archive-st-1'));
    await waitFor(() => expect(api.updateSessionType).toHaveBeenCalledWith('st-1', { archived: true }));
    await fireEvent.press(r.getByTestId('coach-type-archive-st-2'));
    await waitFor(() => expect(api.updateSessionType).toHaveBeenCalledWith('st-2', { archived: false }));
  });

  it('validates name, length and https link', () => {
    expect(validateDraft({ ...emptyDraft(), name: '' })).toMatch(/name/);
    expect(validateDraft({ ...emptyDraft(), name: 'A', duration: '2' })).toMatch(/between 5 and 480/);
    expect(validateDraft({ ...emptyDraft(), name: 'A', meetingUrl: 'http://x.y' })).toMatch(/https/);
    expect(validateDraft({ ...emptyDraft(), name: 'A', meetingUrl: 'https://x.y/z' })).toBeNull();
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
    expect(describeOverride({ id: 'x', coach_id: 'c', date: '2030-12-26', start_minute: 780, end_minute: 900, kind: 'block', note: null })).toBe(
      '2030-12-26, off 13:00 to 15:00',
    );
  });
});
