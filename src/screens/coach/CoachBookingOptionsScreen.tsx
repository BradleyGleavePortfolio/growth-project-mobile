/**
 * CoachBookingOptionsScreen — S-AVAIL-122 coach booking options.
 *
 * Backend #735: GET/PATCH /scheduling/coach/booking-options (coach only, own
 * data). One set of rules for every appointment type: minimum notice, how far
 * ahead clients can book, buffers before and after each session, and an
 * optional daily maximum. Validation mirrors the backend ranges so a refusal
 * is rare; a 400 INVALID_BOOKING_OPTIONS names the field and is shown under it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type {
  BookingOptionKey,
  BookingOptionLimits,
  BookingOptions,
} from '../../api/schedulingApi';
import { schedulingErrorCode, schedulingErrorStatus } from '../../api/schedulingApi';
import {
  bookingOptionsUnavailable,
  useBookingOptions,
  useUpdateBookingOptions,
} from '../../hooks/useCalendar';
import { calendarErrorMessage } from '../../calendar/schedulingErrors';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

/** Mirrors backend BOOKING_OPTION_LIMITS; the server's own limits win when sent. */
export const BOOKING_OPTION_LIMITS: BookingOptionLimits = {
  min_notice_minutes: { min: 5, max: 43_200 },
  booking_window_days: { min: 1, max: 365 },
  buffer_before_minutes: { min: 0, max: 240 },
  buffer_after_minutes: { min: 0, max: 240 },
  daily_max_sessions: { min: 1, max: 50 },
};

export const DEFAULT_BOOKING_OPTIONS: BookingOptions = {
  min_notice_minutes: 5,
  booking_window_days: 120,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  daily_max_sessions: null,
};

export type NoticeUnit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<NoticeUnit, number> = { minutes: 1, hours: 60, days: 1440 };
const UNITS: NoticeUnit[] = ['minutes', 'hours', 'days'];
const UNIT_LABELS: Record<NoticeUnit, string> = { minutes: 'Minutes', hours: 'Hours', days: 'Days' };

export interface BookingDraft {
  noticeValue: string;
  noticeUnit: NoticeUnit;
  windowDays: string;
  bufferBefore: string;
  bufferAfter: string;
  dailyMaxOn: boolean;
  dailyMax: string;
}

export type BookingFieldErrors = Partial<Record<BookingOptionKey, string>>;

/** "5 minutes", "2 hours", "1 day", "90 minutes" (same wording as the backend). */
export function formatDuration(minutes: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (minutes >= 1440 && minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes >= 60 && minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

export function draftFromOptions(o: BookingOptions): BookingDraft {
  const n = o.min_notice_minutes;
  const noticeUnit: NoticeUnit = n % 1440 === 0 ? 'days' : n % 60 === 0 ? 'hours' : 'minutes';
  return {
    noticeValue: String(n / UNIT_MINUTES[noticeUnit]),
    noticeUnit,
    windowDays: String(o.booking_window_days),
    bufferBefore: String(o.buffer_before_minutes),
    bufferAfter: String(o.buffer_after_minutes),
    dailyMaxOn: o.daily_max_sessions !== null,
    dailyMax: o.daily_max_sessions === null ? '' : String(o.daily_max_sessions),
  };
}

function wholeNumber(text: string): number | null {
  const t = text.trim();
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

/** Checks a draft against the backend ranges; options is set only when there are no errors. */
export function validateBookingDraft(
  d: BookingDraft,
  limits: BookingOptionLimits = BOOKING_OPTION_LIMITS,
): { options: BookingOptions | null; errors: BookingFieldErrors } {
  const errors: BookingFieldErrors = {};
  const L = limits;
  const noticeCount = wholeNumber(d.noticeValue);
  const notice = noticeCount === null ? null : noticeCount * UNIT_MINUTES[d.noticeUnit];
  if (notice === null || notice < L.min_notice_minutes.min || notice > L.min_notice_minutes.max) {
    errors.min_notice_minutes = `Enter a whole number for a minimum notice from ${formatDuration(L.min_notice_minutes.min)} to ${formatDuration(L.min_notice_minutes.max)}.`;
  }
  const windowDays = wholeNumber(d.windowDays);
  if (windowDays === null || windowDays < L.booking_window_days.min || windowDays > L.booking_window_days.max) {
    errors.booking_window_days = `Enter a whole number of days from ${L.booking_window_days.min} to ${L.booking_window_days.max}.`;
  }
  const before = wholeNumber(d.bufferBefore);
  if (before === null || before < L.buffer_before_minutes.min || before > L.buffer_before_minutes.max) {
    errors.buffer_before_minutes = `Enter a whole number of minutes from ${L.buffer_before_minutes.min} to ${L.buffer_before_minutes.max}.`;
  }
  const after = wholeNumber(d.bufferAfter);
  if (after === null || after < L.buffer_after_minutes.min || after > L.buffer_after_minutes.max) {
    errors.buffer_after_minutes = `Enter a whole number of minutes from ${L.buffer_after_minutes.min} to ${L.buffer_after_minutes.max}.`;
  }
  let dailyMax: number | null = null;
  if (d.dailyMaxOn) {
    dailyMax = wholeNumber(d.dailyMax);
    if (dailyMax === null || dailyMax < L.daily_max_sessions.min || dailyMax > L.daily_max_sessions.max) {
      errors.daily_max_sessions = `Enter a whole number of sessions from ${L.daily_max_sessions.min} to ${L.daily_max_sessions.max}, or turn off the daily maximum.`;
    }
  }
  if (!errors.min_notice_minutes && !errors.booking_window_days && notice !== null && windowDays !== null && notice >= windowDays * 1440) {
    errors.min_notice_minutes = `Minimum notice must be shorter than how far ahead clients can book (${formatDuration(windowDays * 1440)}).`;
  }
  if (Object.keys(errors).length > 0) return { options: null, errors };
  return {
    options: {
      min_notice_minutes: notice as number,
      booking_window_days: windowDays as number,
      buffer_before_minutes: before as number,
      buffer_after_minutes: after as number,
      daily_max_sessions: dailyMax,
    },
    errors,
  };
}

const SERVER_FIELD_PREFIXES: [RegExp, BookingOptionKey][] = [
  [/^minimum notice/i, 'min_notice_minutes'],
  [/^how far ahead/i, 'booking_window_days'],
  [/^buffer before/i, 'buffer_before_minutes'],
  [/^buffer after/i, 'buffer_after_minutes'],
  [/^daily maximum/i, 'daily_max_sessions'],
];

/** A 400 refusal whose sentence names a field: { field, message } for that field. */
export function serverFieldError(err: unknown): { field: BookingOptionKey; message: string } | null {
  if (schedulingErrorStatus(err) !== 400) return null;
  const raw = (err as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  const messages = (Array.isArray(raw) ? raw : [raw]).filter((m): m is string => typeof m === 'string');
  for (const message of messages) {
    const hit = SERVER_FIELD_PREFIXES.find(([re]) => re.test(message.trim()));
    if (hit) return { field: hit[1], message: message.trim().slice(0, 240) };
  }
  return null;
}

export default function CoachBookingOptionsScreen() {
  const { colors } = useTheme();
  const q = useBookingOptions();
  const save = useUpdateBookingOptions();
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [errors, setErrors] = useState<BookingFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (q.data) setDraft((current) => current ?? draftFromOptions(q.data));
  }, [q.data]);

  const limits = q.data?.limits ?? BOOKING_OPTION_LIMITS;
  const defaults = q.data?.defaults ?? DEFAULT_BOOKING_OPTIONS;

  const edit = (patch: Partial<BookingDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSavedNote(null);
    setFormError(null);
  };

  const onSave = () => {
    if (!draft || saving.current) return;
    const result = validateBookingDraft(draft, limits);
    setErrors(result.errors);
    setSavedNote(null);
    if (!result.options) {
      setFormError('Fix the options marked below, then save again.');
      return;
    }
    setFormError(null);
    saving.current = true;
    save.mutate(result.options, {
      onSuccess: (saved) => {
        setDraft(draftFromOptions(saved));
        setSavedNote('Booking options saved. New bookings and client moves follow them from now on.');
      },
      onError: (err) => {
        const field = serverFieldError(err);
        if (field) {
          const next: BookingFieldErrors = {};
          next[field.field] = field.message;
          setErrors(next);
          setFormError('Booking options were not saved. Fix the option marked below, then save again.');
        } else if (schedulingErrorStatus(err) === 404 && schedulingErrorCode(err) === 'COACH_NOT_FOUND') {
          setFormError('Booking options were not saved. Finish coach profile setup first, then save again.');
        } else {
          setFormError(`Booking options were not saved. ${calendarErrorMessage(err, 'save booking options', 'coach')}`);
        }
      },
      onSettled: () => {
        saving.current = false;
      },
    });
  };

  const muted = { color: colors.textMuted };
  const inputStyle = [styles.input, { color: colors.textPrimary, borderColor: colors.border }];
  const fieldError = (key: BookingOptionKey) =>
    errors[key] ? (
      <Text style={[typography.bodySmall, styles.fieldError, { color: colors.error }]} testID={`booking-options-error-${key}`} accessibilityLiveRegion="polite">
        {errors[key]}
      </Text>
    ) : null;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" testID="coach-booking-options">
      <Text style={[typography.h2, { color: colors.textPrimary }]} accessibilityRole="header">
        Booking options
      </Text>
      <Text style={[typography.bodySmall, muted, { marginTop: spacing.sm }]}>
        These rules apply to every appointment type, for new bookings and client moves. Sessions already booked stay as they are.
      </Text>

      {q.isLoading ? <Text style={[typography.body, muted, { marginTop: spacing.lg }]}>Loading booking options.</Text> : null}
      {q.isError ? (
        <View style={{ marginTop: spacing.lg }}>
          <Text style={[typography.body, muted]} testID="booking-options-load-error">
            {bookingOptionsUnavailable(q.error)
              ? 'Booking options are not available for this account yet. Open hours and time off still control open times.'
              : calendarErrorMessage(q.error, 'load booking options', 'coach')}
          </Text>
          {!bookingOptionsUnavailable(q.error) ? (
            <Pressable onPress={() => void q.refetch()} accessibilityRole="button" accessibilityLabel="Refresh booking options" style={[styles.secondary, { borderColor: colors.border }]}>
              <Text style={[typography.body, { color: colors.textPrimary }]}>Refresh booking options</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {draft ? (
        <View>
          <Text style={[styles.label, muted]}>Minimum notice</Text>
          <Text style={[typography.bodySmall, muted]}>Clients cannot book a time sooner than this from now.</Text>
          <View style={styles.row}>
            <TextInput value={draft.noticeValue} onChangeText={(t) => edit({ noticeValue: t })} keyboardType="number-pad" maxLength={6} accessibilityLabel="Minimum notice" style={[inputStyle, styles.flex]} testID="booking-options-notice" />
            {UNITS.map((unit) => {
              const selected = draft.noticeUnit === unit;
              return (
                <Pressable key={unit} onPress={() => edit({ noticeUnit: unit })} accessibilityRole="button" accessibilityLabel={`Minimum notice in ${unit}`} accessibilityState={{ selected }} style={[styles.unit, { borderColor: selected ? colors.textPrimary : colors.border, backgroundColor: selected ? colors.textPrimary : 'transparent' }]} testID={`booking-options-unit-${unit}`}>
                  <Text style={[typography.bodySmall, { color: selected ? colors.background : colors.textPrimary }]}>{UNIT_LABELS[unit]}</Text>
                </Pressable>
              );
            })}
          </View>
          {fieldError('min_notice_minutes')}

          <Text style={[styles.label, muted]}>How far ahead clients can book (days)</Text>
          <Text style={[typography.bodySmall, muted]}>Open times are offered up to this many days from today.</Text>
          <TextInput value={draft.windowDays} onChangeText={(t) => edit({ windowDays: t })} keyboardType="number-pad" maxLength={3} accessibilityLabel="How far ahead clients can book, in days" style={inputStyle} testID="booking-options-window" />
          {fieldError('booking_window_days')}

          <Text style={[styles.label, muted]}>Buffer before each session (minutes)</Text>
          <Text style={[typography.bodySmall, muted]}>Free time kept before a booked session, so clients cannot book right up to it.</Text>
          <TextInput value={draft.bufferBefore} onChangeText={(t) => edit({ bufferBefore: t })} keyboardType="number-pad" maxLength={3} accessibilityLabel="Buffer before each session, in minutes" style={inputStyle} testID="booking-options-buffer-before" />
          {fieldError('buffer_before_minutes')}

          <Text style={[styles.label, muted]}>Buffer after each session (minutes)</Text>
          <Text style={[typography.bodySmall, muted]}>Free time kept after a booked session before the next one can start.</Text>
          <TextInput value={draft.bufferAfter} onChangeText={(t) => edit({ bufferAfter: t })} keyboardType="number-pad" maxLength={3} accessibilityLabel="Buffer after each session, in minutes" style={inputStyle} testID="booking-options-buffer-after" />
          {fieldError('buffer_after_minutes')}

          <View style={[styles.row, { marginTop: spacing.lg }]}>
            <Text style={[typography.body, styles.flex, { color: colors.textPrimary }]}>Daily maximum</Text>
            <Switch value={draft.dailyMaxOn} onValueChange={(on) => edit({ dailyMaxOn: on, dailyMax: on && !draft.dailyMax ? '4' : draft.dailyMax })} accessibilityLabel="Daily maximum" testID="booking-options-daily-max-on" />
          </View>
          <Text style={[typography.bodySmall, muted]}>
            {draft.dailyMaxOn ? 'A day stops taking bookings once it has this many sessions, requests included.' : 'Off: no limit on sessions per day.'}
          </Text>
          {draft.dailyMaxOn ? (
            <TextInput value={draft.dailyMax} onChangeText={(t) => edit({ dailyMax: t })} keyboardType="number-pad" maxLength={2} accessibilityLabel="Daily maximum sessions" style={[inputStyle, { marginTop: spacing.sm }]} testID="booking-options-daily-max" />
          ) : null}
          {fieldError('daily_max_sessions')}

          {formError ? (
            <Text style={[typography.bodySmall, { color: colors.error, marginTop: spacing.lg }]} testID="booking-options-form-error" accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}
          {savedNote ? (
            <Text style={[typography.bodySmall, { color: colors.textPrimary, marginTop: spacing.lg }]} testID="booking-options-saved" accessibilityLiveRegion="polite">
              {savedNote}
            </Text>
          ) : null}
          <Pressable onPress={onSave} disabled={save.isPending} accessibilityRole="button" accessibilityLabel="Save booking options" accessibilityState={{ disabled: save.isPending, busy: save.isPending }} style={[styles.primary, { backgroundColor: colors.textPrimary, opacity: save.isPending ? 0.6 : 1 }]} testID="booking-options-save">
            <Text style={[typography.bodyMd, { color: colors.background }]}>{save.isPending ? 'Saving' : 'Save booking options'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setDraft(draftFromOptions(defaults));
              setErrors({});
              setFormError(null);
              setSavedNote(`Standard options filled in: ${formatDuration(defaults.min_notice_minutes)} notice, ${defaults.booking_window_days} days ahead, no buffers, no daily maximum. Save to apply them.`);
            }}
            disabled={save.isPending}
            accessibilityRole="button"
            accessibilityLabel="Use the standard options"
            style={[styles.secondary, { borderColor: colors.border }]}
            testID="booking-options-defaults"
          >
            <Text style={[typography.body, { color: colors.textPrimary }]}>Use the standard options</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  label: { ...typography.caption, marginTop: spacing.xl, marginBottom: spacing.xs },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 2, padding: spacing.md, marginTop: spacing.sm, ...typography.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  unit: { minHeight: 44, borderWidth: 1, borderRadius: 2, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  fieldError: { marginTop: spacing.xs },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  secondary: { minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
});
