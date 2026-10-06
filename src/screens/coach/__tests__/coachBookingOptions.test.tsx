/**
 * S-AVAIL-122 coach booking options: load, save, field errors (local and the
 * backend's INVALID_BOOKING_OPTIONS sentence), and the Settings entry hidden
 * when the backend does not offer the endpoint.
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BookingOptionsView } from '../../../api/schedulingApi';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

jest.mock('../../../api/schedulingApi', () => {
  const actual = jest.requireActual('../../../api/schedulingApi');
  return {
    ...actual,
    schedulingApi: {
      getMyBookingOptions: jest.fn(),
      updateMyBookingOptions: jest.fn(),
    },
  };
});

import { schedulingApi } from '../../../api/schedulingApi';
import CoachBookingOptionsScreen, {
  NOTICE_TOO_LONG_MESSAGE,
  draftFromOptions,
  serverFieldError,
  validateBookingDraft,
} from '../CoachBookingOptionsScreen';
import { BookingOptionsEntry } from '../settings/BookingOptionsEntry';
import { makeStyles } from '../settings/styles';

const api = schedulingApi as jest.Mocked<typeof schedulingApi>;

const VIEW: BookingOptionsView = {
  coach_id: 'coach-1',
  min_notice_minutes: 120,
  booking_window_days: 30,
  buffer_before_minutes: 10,
  buffer_after_minutes: 15,
  daily_max_sessions: 6,
  defaults: { min_notice_minutes: 5, booking_window_days: 120, buffer_before_minutes: 0, buffer_after_minutes: 0, daily_max_sessions: null },
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
  api.getMyBookingOptions.mockResolvedValue(VIEW);
  api.updateMyBookingOptions.mockImplementation(async (input) => ({ ...VIEW, ...input }));
});

describe('CoachBookingOptionsScreen', () => {
  it('loads the saved options into the form', async () => {
    const r = await renderQ(<CoachBookingOptionsScreen />);
    await waitFor(() => expect(r.getByTestId('booking-options-notice').props.value).toBe('2'));
    expect(r.getByTestId('booking-options-unit-hours').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(r.getByTestId('booking-options-window').props.value).toBe('30');
    expect(r.getByTestId('booking-options-buffer-before').props.value).toBe('10');
    expect(r.getByTestId('booking-options-buffer-after').props.value).toBe('15');
    expect(r.getByTestId('booking-options-daily-max').props.value).toBe('6');
  });

  it('saves the full set and confirms', async () => {
    const r = await renderQ(<CoachBookingOptionsScreen />);
    await waitFor(() => expect(r.getByTestId('booking-options-window')).toBeTruthy());
    await fireEvent.changeText(r.getByTestId('booking-options-window'), '60');
    await fireEvent.press(r.getByTestId('booking-options-unit-days'));
    await fireEvent(r.getByTestId('booking-options-daily-max-on'), 'valueChange', false);
    await fireEvent.press(r.getByTestId('booking-options-save'));
    await waitFor(() =>
      expect(api.updateMyBookingOptions).toHaveBeenCalledWith({
        min_notice_minutes: 2880,
        booking_window_days: 60,
        buffer_before_minutes: 10,
        buffer_after_minutes: 15,
        daily_max_sessions: null,
      }),
    );
    await waitFor(() => expect(r.getByTestId('booking-options-saved').props.children).toMatch(/^Booking options saved\./));
  });

  it('shows a field error and does not save an out-of-range value', async () => {
    const r = await renderQ(<CoachBookingOptionsScreen />);
    await waitFor(() => expect(r.getByTestId('booking-options-window')).toBeTruthy());
    await fireEvent.changeText(r.getByTestId('booking-options-window'), '400');
    await fireEvent.press(r.getByTestId('booking-options-save'));
    expect(r.getByTestId('booking-options-error-booking_window_days').props.children).toBe('Enter a whole number of days from 1 to 365.');
    expect(r.getByTestId('booking-options-form-error')).toBeTruthy();
    expect(api.updateMyBookingOptions).not.toHaveBeenCalled();
  });

  it('B-381-1: the notice stops at 13 days with the sentence, and saves 13 days', async () => {
    const r = await renderQ(<CoachBookingOptionsScreen />);
    await waitFor(() => expect(r.getByTestId('booking-options-notice').props.value).toBe('2'));
    await fireEvent.changeText(r.getByTestId('booking-options-window'), '120');
    await fireEvent.press(r.getByTestId('booking-options-unit-days'));
    await fireEvent.changeText(r.getByTestId('booking-options-notice'), '21');
    expect(r.getByTestId('booking-options-notice').props.value).toBe('13');
    expect(r.getByTestId('booking-options-error-min_notice_minutes').props.children).toBe(
      'Minimum notice must be under 14 days so clients can see open times.',
    );
    await fireEvent.press(r.getByTestId('booking-options-unit-hours'));
    await fireEvent.changeText(r.getByTestId('booking-options-notice'), '400');
    expect(r.getByTestId('booking-options-notice').props.value).toBe('335');
    await fireEvent.press(r.getByTestId('booking-options-unit-days'));
    expect(r.getByTestId('booking-options-notice').props.value).toBe('13');
    await fireEvent.press(r.getByTestId('booking-options-save'));
    await waitFor(() => expect(api.updateMyBookingOptions).toHaveBeenCalledWith(expect.objectContaining({ min_notice_minutes: 18_720, booking_window_days: 120 })));
  });

  it('puts the backend INVALID_BOOKING_OPTIONS sentence under the named field', async () => {
    const message = 'Buffer after each session (minutes) must be a whole number from 0 to 240.';
    api.updateMyBookingOptions.mockRejectedValue({
      response: { status: 400, data: { code: 'INVALID_BOOKING_OPTIONS', error: 'INVALID_BOOKING_OPTIONS', message } },
    });
    const r = await renderQ(<CoachBookingOptionsScreen />);
    await waitFor(() => expect(r.getByTestId('booking-options-save')).toBeTruthy());
    await fireEvent.press(r.getByTestId('booking-options-save'));
    await waitFor(() => expect(r.getByTestId('booking-options-error-buffer_after_minutes').props.children).toBe(message));
    expect(r.getByTestId('booking-options-form-error').props.children).toMatch(/^Booking options were not saved\./);
    expect(r.queryByTestId('booking-options-saved')).toBeNull();
  });
});

describe('booking options rules', () => {
  const base = draftFromOptions(VIEW);

  it('matches the backend ranges and the notice-shorter-than-window rule', () => {
    expect(validateBookingDraft(base).options).toEqual({
      min_notice_minutes: 120, booking_window_days: 30, buffer_before_minutes: 10, buffer_after_minutes: 15, daily_max_sessions: 6,
    });
    expect(validateBookingDraft({ ...base, noticeValue: '4', noticeUnit: 'minutes' }).errors.min_notice_minutes).toBe(
      'Enter a whole number for a minimum notice of at least 5 minutes and under 14 days.',
    );
    expect(validateBookingDraft({ ...base, noticeValue: '31', noticeUnit: 'days' }).errors.min_notice_minutes).toBe(NOTICE_TOO_LONG_MESSAGE);
    expect(validateBookingDraft({ ...base, noticeValue: '1.5' }).errors.min_notice_minutes).toBeTruthy();
    expect(validateBookingDraft({ ...base, noticeValue: '2', noticeUnit: 'days', windowDays: '2' }).errors.min_notice_minutes).toBe(
      'Minimum notice must be shorter than how far ahead clients can book (2 days).',
    );
    expect(validateBookingDraft({ ...base, bufferBefore: '241' }).errors.buffer_before_minutes).toMatch(/0 to 240/);
    expect(validateBookingDraft({ ...base, dailyMax: '0' }).errors.daily_max_sessions).toMatch(/1 to 50, or turn off/);
    expect(validateBookingDraft({ ...base, dailyMaxOn: false, dailyMax: '0' }).options?.daily_max_sessions).toBeNull();
  });

  it('B-381-1: refuses a notice of 14 days or more, because clients only see the next 14 days', () => {
    const wide = { ...base, windowDays: '120' };
    expect(NOTICE_TOO_LONG_MESSAGE).toBe('Minimum notice must be under 14 days so clients can see open times.');
    for (const [noticeValue, noticeUnit] of [['14', 'days'], ['21', 'days'], ['336', 'hours'], ['20160', 'minutes']] as const) {
      const r = validateBookingDraft({ ...wide, noticeValue, noticeUnit });
      expect(r.options).toBeNull();
      expect(r.errors.min_notice_minutes).toBe(NOTICE_TOO_LONG_MESSAGE);
    }
    expect(validateBookingDraft({ ...wide, noticeValue: '13', noticeUnit: 'days' }).options?.min_notice_minutes).toBe(18_720);
    expect(validateBookingDraft({ ...wide, noticeValue: '335', noticeUnit: 'hours' }).options?.min_notice_minutes).toBe(20_100);
    expect(validateBookingDraft({ ...wide, noticeValue: '20159', noticeUnit: 'minutes' }).options?.min_notice_minutes).toBe(20_159);
  });

  it('maps class-validator and range sentences to their field', () => {
    expect(serverFieldError({ response: { status: 400, data: { message: ['Daily maximum must be a whole number of sessions, or empty for no limit.'] } } })?.field).toBe('daily_max_sessions');
    expect(serverFieldError({ response: { status: 400, data: { message: 'Minimum notice (2 days) must be shorter than how far ahead clients may book (1 day).' } } })?.field).toBe('min_notice_minutes');
    expect(serverFieldError({ response: { status: 409, data: { message: 'Buffer before' } } })).toBeNull();
  });
});

describe('Settings entry', () => {
  const colors = { textSecondary: '#ccc', textMuted: '#888' } as never;
  const styles = makeStyles({} as never);

  it('shows the Booking Options row when the backend answers', async () => {
    const onOpen = jest.fn();
    const r = await renderQ(<BookingOptionsEntry styles={styles} colors={colors} onOpen={onOpen} />);
    await waitFor(() => expect(api.getMyBookingOptions).toHaveBeenCalled());
    await fireEvent.press(r.getByTestId('settings-booking-options'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('hides the row when the backend does not offer booking options (404)', async () => {
    api.getMyBookingOptions.mockRejectedValue({ response: { status: 404, data: { message: 'Cannot GET /scheduling/coach/booking-options' } } });
    const r = await renderQ(<BookingOptionsEntry styles={styles} colors={colors} onOpen={jest.fn()} />);
    await waitFor(() => expect(r.queryByTestId('settings-booking-options')).toBeNull());
    expect(api.getMyBookingOptions).toHaveBeenCalledTimes(1);
  });
});
