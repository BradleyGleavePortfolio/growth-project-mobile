/**
 * coachCodesApi — typed client for the coach code tools (backend b#658,
 * `src/invite-codes/coach-code-tools.controller.ts`).
 *
 *   GET  /coach/codes                 coach link first, then shareable codes
 *   POST /coach/codes                 create (Idempotency-Key header)
 *   POST /coach/codes/:id/rotate      new code, old one off now or after grace_hours
 *                                     (`coach-link` requires expected_code)
 *   POST /coach/codes/:id/revoke      turn a code off (coach link: 409)
 *   GET  /coach/codes/signups?days=N  exact daily signups with unusual_today
 *
 * Every route answers `404 coach_code_tools_disabled` while
 * FEATURE_COACH_CODE_TOOLS is off; the Codes entry then shows the legacy
 * invite-codes screen instead (see CoachCodesEntry).
 */

import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';

export type CoachCodeStatus = 'active' | 'retiring' | 'revoked' | 'expired' | 'used_up';

export interface CoachCode {
  /** InviteCode id, or the literal `coach-link` for the coach's permanent link. */
  id: string;
  kind: 'coach_link' | 'invite_code';
  code: string;
  label: string | null;
  status: CoachCodeStatus;
  issued_by_user_id: string | null;
  join_url: string;
  /** What the QR encodes: the universal link that opens the app on /join/<code>. */
  qr_payload: string;
  created_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  max_uses: number | null;
  used_count: number | null;
  signups_total: number;
  signups_7d: number;
  package: { id: string; name: string } | null;
  grant_mode: 'none' | 'free' | 'prepaid';
  rotated_from: { id: string; code: string } | null;
  rotated_to: { id: string; code: string } | null;
}

export interface CoachCodeList {
  codes: CoachCode[];
  tracking_note: string;
}

export interface CoachCodeSignupsByCode {
  code: string;
  id: string | null;
  kind: 'coach_link' | 'invite_code';
  label: string | null;
  total: number;
  today: number;
  unusual_today: boolean;
  days: Array<{ date: string; count: number }>;
}

export interface CoachCodeSignups {
  timezone: string;
  from: string;
  to: string;
  total: number;
  today: number;
  days: Array<{ date: string; count: number }>;
  by_code: CoachCodeSignupsByCode[];
}

export interface CreateCoachCodeInput {
  label?: string;
  max_uses?: number | null;
  expires_at?: string | null;
}

/** Grace choices offered when rotating: the old code keeps working this long. */
export const ROTATE_GRACE_CHOICES: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 0, label: 'Turn the old code off now' },
  { hours: 24, label: 'Keep the old code for 24 hours' },
  { hours: 168, label: 'Keep the old code for 7 days' },
];

export const COACH_LINK_ID = 'coach-link';

/**
 * One create attempt = one Idempotency-Key. The screen mints a key when the
 * coach taps Create and reuses it for every retry of that same attempt, so a
 * timeout followed by a retry returns the first code instead of a second one.
 */
export function newCreateKey(): string {
  return generateIdempotencyKey();
}

export const coachCodesApi = {
  list: async (): Promise<CoachCodeList> => (await api.get<CoachCodeList>('/coach/codes')).data,

  signups: async (days = 8): Promise<CoachCodeSignups> =>
    (await api.get<CoachCodeSignups>('/coach/codes/signups', { params: { days } })).data,

  create: async (
    input: CreateCoachCodeInput,
    idempotencyKey: string,
  ): Promise<{ code: CoachCode; replayed: boolean }> =>
    (
      await api.post<{ code: CoachCode; replayed: boolean }>('/coach/codes', input, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
    ).data,

  /** `expectedCode` is the code on screen; the backend requires it for the coach link. */
  rotate: async (
    code: Pick<CoachCode, 'id' | 'code'>,
    graceHours: number,
  ): Promise<{ code: CoachCode; previous: CoachCode | null; replayed: boolean }> => {
    const body: { grace_hours: number; expected_code?: string } = { grace_hours: graceHours };
    if (code.id === COACH_LINK_ID) body.expected_code = code.code;
    return (
      await api.post<{ code: CoachCode; previous: CoachCode | null; replayed: boolean }>(
        `/coach/codes/${encodeURIComponent(code.id)}/rotate`,
        body,
      )
    ).data;
  },

  revoke: async (id: string): Promise<{ code: CoachCode; replayed: boolean }> =>
    (
      await api.post<{ code: CoachCode; replayed: boolean }>(
        `/coach/codes/${encodeURIComponent(id)}/revoke`,
        {},
      )
    ).data,
};

// ─── Errors ─────────────────────────────────────────────────────────────────

interface EnvelopeError {
  response?: { status?: number; data?: { code?: unknown } };
}

export function coachCodesErrorCode(err: unknown): string | null {
  const code = (err as EnvelopeError)?.response?.data?.code;
  return typeof code === 'string' ? code : null;
}

/** True when the server has the code tools switched off (or does not have them yet). */
export function isCodeToolsDisabled(err: unknown): boolean {
  const e = err as EnvelopeError;
  if (e?.response?.status !== 404) return false;
  const code = coachCodesErrorCode(err);
  // An older backend without the route answers a plain 404 with no code.
  return code === null || code === 'coach_code_tools_disabled';
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  code_rotation_conflict:
    'Your coach link was just changed on another device. Pull down to refresh, then try again.',
  expected_code_required: 'Pull down to refresh your codes, then rotate the link shown on screen.',
  coach_link_head_coach_only:
    'The team coach link belongs to your head coach. Create your own code here instead.',
  code_package_head_coach_only: 'Only your head coach can attach a package to a code.',
  coach_link_not_revocable: 'Your coach link cannot be turned off, only replaced. Use Rotate instead.',
  code_already_revoked: 'This code is already turned off. Create a new code instead.',
  code_not_found: 'This code is no longer on your account. Pull down to refresh your codes.',
  idempotency_key_invalid: 'The code could not be created. Tap Create again.',
  expiry_in_past: 'Pick an expiry date in the future.',
  label_too_long: 'Keep the name to 60 characters or fewer.',
  coach_code_tools_disabled: 'Code tools are not available on your account yet.',
};

/** Plain copy for a failed code action; never the raw server string. */
export function coachCodesErrorMessage(err: unknown, action: 'load' | 'create' | 'rotate' | 'revoke'): string {
  const code = coachCodesErrorCode(err);
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  const e = err as EnvelopeError;
  if (!e?.response) {
    return 'The server could not be reached. Check your connection and try again.';
  }
  if ((e.response.status ?? 0) === 429) return 'Too many changes in a minute. Wait a moment, then try again.';
  switch (action) {
    case 'load':
      return 'Your codes could not be loaded. Pull down to try again.';
    case 'create':
      return 'The code was not created. Tap Create to try again.';
    case 'rotate':
      return 'The code was not replaced. Your current code still works. Try again.';
    case 'revoke':
      return 'The code is still on. Try turning it off again.';
  }
}
