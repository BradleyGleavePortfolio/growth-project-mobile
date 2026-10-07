/**
 * Day-1 onboarding persistence.
 *
 * Each step persists immediately on advance (Rule 6 — never kick the can).
 * Transient network errors retry with exponential backoff; surface-level
 * errors return a structured DayOneError that the UI maps to user copy
 * via the i18n strings module (Rule 9 — no raw axios strings).
 */

import { profileApi, authApi, preferencesApi, notificationsApi } from '../../services/api';
import { keepDayOneAnswers } from './answers';
import { patchUserCache } from '../../lib/userCache';
import { logger } from '../../utils/logger';

// ─── Error shape ─────────────────────────────────────────────────────────────

export type DayOneErrorKind =
  | 'invite_invalid'
  | 'invite_revoked'
  | 'invite_expired'
  | 'invite_max_uses'
  | 'coach_unavailable'
  | 'already_paired'
  | 'network'
  | 'server';

export interface DayOneError {
  kind: DayOneErrorKind;
  /** Server-provided message when available; the UI prefers its own copy. */
  serverMessage?: string;
}

// ─── Step payload types ──────────────────────────────────────────────────────

export type GoalKey =
  | 'fitness'
  | 'business'
  | 'personal_growth'
  | 'relationships'
  | 'mental_health'
  | 'custom';

export interface CheckInTime {
  hour: number;
  minute: number;
}

// ─── Retry helper ────────────────────────────────────────────────────────────

interface AxiosLikeError {
  response?: { status?: number; data?: { reason?: string; code?: string; message?: string } };
  message?: string;
}

/**
 * Attach refusals keyed by the envelope `code` (backend INVITE_ATTACH_ERROR).
 * A code that exists but cannot take a signup says why (turned off, expired,
 * signup limit), so the client is never told a real code is "not recognized".
 */
const ATTACH_CODE_KINDS: Readonly<Record<string, DayOneErrorKind>> = {
  code_revoked: 'invite_revoked',
  code_expired: 'invite_expired',
  code_exhausted: 'invite_max_uses',
  coach_not_accepting_clients: 'coach_unavailable',
  already_attached_to_different_coach: 'already_paired',
};

function classify(err: unknown): DayOneError {
  const e = err as AxiosLikeError;
  const status = e?.response?.status ?? 0;
  const reason = e?.response?.data?.reason;
  const code = e?.response?.data?.code;
  const serverMessage = e?.response?.data?.message;
  if (status >= 400 && status < 500 && typeof code === 'string' && ATTACH_CODE_KINDS[code]) {
    return { kind: ATTACH_CODE_KINDS[code], serverMessage };
  }
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    if (reason === 'expired') return { kind: 'invite_expired', serverMessage };
    if (reason === 'max_uses_reached') return { kind: 'invite_max_uses', serverMessage };
    return { kind: 'invite_invalid', serverMessage };
  }
  if (status >= 500) return { kind: 'server', serverMessage };
  return { kind: 'network', serverMessage };
}

/** Exponential backoff with jitter — bounded so we never block the UI forever. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry classified 4xx errors — they won't succeed by waiting.
      const e = err as AxiosLikeError;
      const status = e?.response?.status ?? 0;
      if (status >= 400 && status < 500) throw err;
      if (i === attempts - 1) break;
      const base = 400 * 2 ** i;
      const jitter = Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }
  throw lastErr;
}

// ─── Step persistence ────────────────────────────────────────────────────────

/**
 * Step 2 — Coach pairing. Validates and attaches the invite code on the
 * backend (POST /auth/attach-invite-code). Returns the structured error so
 * the UI can render the right message instead of a raw axios string.
 */
export async function pairWithCoach(
  code: string,
  // B-SHARE-127: the coach-sharing sentence version, when the screen showed it.
  coachSharingNotice?: string | null,
): Promise<{ ok: true } | { ok: false; error: DayOneError }> {
  const trimmed = code.trim();
  try {
    const response = await authApi.attachInviteCode(trimmed, coachSharingNotice);
    const coachId = response?.data?.coach_id;
    if (typeof coachId === 'string') {
      await patchUserCache({ coach_id: coachId }).catch((err: unknown) =>
        logger.warn('DayOnePairing', 'user cache patch after attach failed', err),
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: classify(err) };
  }
}

/**
 * Step 3 — Goals selection. The backend has no column for these goals and
 * PUT /profile rejects unknown keys with a 400 (forbidNonWhitelisted), so the
 * selection is kept on this device for this account (answers.ts) and this
 * step never makes a network call that can only fail. The Ready step keeps
 * the draft copy as well before it clears the resume checkpoint.
 */
export async function saveGoals(goals: readonly GoalKey[]): Promise<void> {
  await keepDayOneAnswers({ goals: [...goals] });
}

/**
 * Step 4 — Notification permission outcome. We record whether the user
 * granted, denied, or skipped. Backend column: `notif_permission_state`.
 */
export async function saveNotifPermission(
  state: 'granted' | 'denied' | 'skipped',
): Promise<void> {
  await withRetry(() => preferencesApi.patch({ notif_permission_state: state }));
}

/** Resolve the device's IANA timezone with a UTC fallback for older runtimes. */
export function getDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string' && tz.length > 0) return tz;
  } catch {
    // Older RN / iOS pre-15 may not expose Intl.DateTimeFormat — fall through.
  }
  return 'UTC';
}

function statusOf(err: unknown): number {
  return (err as AxiosLikeError)?.response?.status ?? 0;
}

/**
 * Step 5 — Daily check-in time. The backend stores no check-in time (no
 * profile or notification-preference field; both reject unknown keys with a
 * 400), so the chosen time is kept on this device for this account
 * (answers.ts) before anything is sent. What the
 * backend does use is the device IANA timezone (quiet hours and the times in
 * notifications): it goes to PUT /notifications/timezone with source
 * 'device', or the older PATCH /notifications/preferences { timezone } on a
 * backend without that route (404/405). A zone the backend refuses (other
 * 4xx) is not something the client can fix here, so the step still
 * completes; sign-in sends the zone again (services/timezoneSync).
 */
export async function saveCheckInTime(
  time: CheckInTime,
  timezone: string = getDeviceTimezone(),
): Promise<void> {
  await keepDayOneAnswers({ checkInTime: time, checkInTimezone: timezone });
  try {
    await withRetry(async () => {
      try {
        await notificationsApi.setTimezone(timezone);
      } catch (err) {
        const status = statusOf(err);
        if (status !== 404 && status !== 405) throw err;
        await notificationsApi.updatePreferences({ timezone });
      }
    });
  } catch (err) {
    const status = statusOf(err);
    if (status >= 400 && status < 500) return;
    throw err;
  }
}

/**
 * Step 6 — Mark Day-1 onboarding complete. This is the terminal step.
 * The backend field is `onboarding_completed` (UpdateProfileDto); it is what
 * RootNavigator reads back as `profile.onboardingCompleted`, so a finished
 * client is not sent through Day-1 again on another device. The backend has
 * no `day_one_completed` field and rejected it with a 400.
 */
export async function completeDayOne(): Promise<void> {
  await withRetry(() => profileApi.update({ onboarding_completed: true }));
}
