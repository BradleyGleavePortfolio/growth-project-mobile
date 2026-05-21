/**
 * Day-1 onboarding persistence.
 *
 * Each step persists immediately on advance (Rule 6 — never kick the can).
 * Transient network errors retry with exponential backoff; surface-level
 * errors return a structured DayOneError that the UI maps to user copy
 * via the i18n strings module (Rule 9 — no raw axios strings).
 */

import { profileApi, authApi, preferencesApi, notificationsApi } from '../../services/api';

// ─── Error shape ─────────────────────────────────────────────────────────────

export type DayOneErrorKind =
  | 'invite_invalid'
  | 'invite_expired'
  | 'invite_max_uses'
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
  response?: { status?: number; data?: { reason?: string; message?: string } };
  message?: string;
}

function classify(err: unknown): DayOneError {
  const e = err as AxiosLikeError;
  const status = e?.response?.status ?? 0;
  const reason = e?.response?.data?.reason;
  const serverMessage = e?.response?.data?.message;
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
export async function pairWithCoach(code: string): Promise<{ ok: true } | { ok: false; error: DayOneError }> {
  const trimmed = code.trim();
  try {
    await authApi.attachInviteCode(trimmed);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: classify(err) };
  }
}

/**
 * Step 3 — Goals selection. Stored on the profile as an array of slug keys.
 * Backend column: `day_one_goals` (text[]).
 */
export async function saveGoals(goals: readonly GoalKey[]): Promise<void> {
  await withRetry(() => profileApi.update({ day_one_goals: [...goals] }));
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

/**
 * Step 5 — Daily check-in time. Stored as HH:MM in 24h format on the
 * profile + propagated to notification preferences so the daily reminder
 * schedule lines up immediately.
 */
export async function saveCheckInTime(time: CheckInTime): Promise<void> {
  const hh = String(time.hour).padStart(2, '0');
  const mm = String(time.minute).padStart(2, '0');
  const value = `${hh}:${mm}`;
  await withRetry(async () => {
    await profileApi.update({ daily_checkin_time: value });
    await notificationsApi.updatePreferences({ daily_checkin_time: value });
  });
}

/**
 * Step 6 — Mark Day-1 onboarding complete. This is the terminal step;
 * RootNavigator gates Home on this flag.
 */
export async function completeDayOne(): Promise<void> {
  await withRetry(() => profileApi.update({ day_one_completed: true }));
}
