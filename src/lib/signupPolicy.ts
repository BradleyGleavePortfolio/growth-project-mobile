/**
 * Signup policy normaliser.
 *
 * The backend `GET /auth/signup-policy` contract (auth.service.ts
 * getSignupPolicy) returns:
 *
 *   { invite_code_required: boolean, coach_code_required: boolean,
 *     providers: Array<'email' | 'google' | 'apple'>, ... }
 *
 * Older mobile builds read `require_invite_code` / `google_signin_enabled`,
 * which the backend never sent, so the invite code was always required and
 * the Google button always rendered. This module is the single reader for
 * the policy; every screen goes through `normalizeSignupPolicy`.
 *
 * Precedence: canonical names first, legacy names second, strict defaults
 * last (invite code required, Google hidden). Google is only offered when
 * the server explicitly advertises it, because tapping an unconfigured
 * provider fails mid-flow.
 */

import { STARTUP_STEP_TIMEOUT_MS, withStartupTimeout } from './startupTimebox';

export type AuthProvider = 'email' | 'google' | 'apple';

export interface SignupPolicyResponse {
  invite_code_required?: boolean;
  coach_code_required?: boolean;
  providers?: unknown;
  /** Legacy name (never sent by the current backend). */
  require_invite_code?: boolean;
  /** Legacy name (never sent by the current backend). */
  google_signin_enabled?: boolean;
  /**
   * C13 (backend #597): `true` when the server accepts `intended_role` at
   * account creation and SIGNUP_ROLE_CHOICE_ENABLED is on. Absent on the
   * current production backend.
   */
  role_choice?: boolean;
  role_choice_field?: unknown;
  role_choice_values?: unknown;
}

export interface SignupPolicy {
  inviteCodeRequired: boolean;
  providers: AuthProvider[];
  googleEnabled: boolean;
  appleEnabled: boolean;
  /**
   * Whether CreateAccount asks "How will you use the app?" and sends
   * `intended_role`. Only an explicit `role_choice: true` (with the field
   * name and both values the app knows) turns this on. Anything else,
   * including the current production backend and a failed GET, is `false`:
   * no role step, no `intended_role` on any request, exactly today's flow.
   */
  roleChoice: boolean;
}

/**
 * Fallback for a malformed policy body (a 2xx that is not an object). Also
 * kept as the conservative provider posture.
 */
export const STRICT_SIGNUP_POLICY: SignupPolicy = {
  inviteCodeRequired: true,
  providers: ['email'],
  googleEnabled: false,
  appleEnabled: false,
  roleChoice: false,
};

const KNOWN: readonly AuthProvider[] = ['email', 'google', 'apple'];

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

export function normalizeSignupPolicy(raw: unknown): SignupPolicy {
  if (!raw || typeof raw !== 'object') return STRICT_SIGNUP_POLICY;
  const r = raw as SignupPolicyResponse;

  const inviteCodeRequired =
    asBool(r.invite_code_required) ??
    asBool(r.coach_code_required) ??
    asBool(r.require_invite_code) ??
    true;

  let providers: AuthProvider[] | null = null;
  if (Array.isArray(r.providers)) {
    providers = r.providers
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim().toLowerCase())
      .filter((p): p is AuthProvider => (KNOWN as readonly string[]).includes(p));
    providers = Array.from(new Set(providers));
  }

  let googleEnabled: boolean;
  if (providers) {
    googleEnabled = providers.includes('google');
  } else {
    // Legacy fallback: only honour an explicit `true`.
    googleEnabled = asBool(r.google_signin_enabled) === true;
    providers = googleEnabled ? ['email', 'google'] : ['email'];
  }

  return {
    inviteCodeRequired,
    providers,
    googleEnabled,
    appleEnabled: providers.includes('apple'),
    roleChoice: readRoleChoice(r),
  };
}

/**
 * `role_choice` is honoured only when it is literally `true` and the server
 * either omits the descriptor fields or describes exactly the contract this
 * build speaks (`intended_role`, values `client` and `coach`). A future
 * backend that renames the field or drops a value therefore hides the step
 * instead of sending something the server would reject.
 */
function readRoleChoice(r: SignupPolicyResponse): boolean {
  if (r.role_choice !== true) return false;
  if (r.role_choice_field !== undefined && r.role_choice_field !== 'intended_role') return false;
  if (r.role_choice_values !== undefined) {
    if (!Array.isArray(r.role_choice_values)) return false;
    const values = r.role_choice_values.filter((v): v is string => typeof v === 'string');
    if (!values.includes('client') || !values.includes('coach')) return false;
  }
  return true;
}

/**
 * Policy to use when the GET failed and nothing was fetched before
 * (audit A1). The policy is informational: the backend enforces the invite
 * requirement on /auth/register and /auth/select-role. So an outage must NOT
 * add a mobile-only admission gate. The code is optional here and the
 * backend answers with a clear error if it really needs one. Optional
 * providers (Google, Apple) stay hidden while the policy is unknown, because
 * tapping an unconfigured provider fails mid-flow.
 */
export const UNKNOWN_SIGNUP_POLICY: SignupPolicy = {
  inviteCodeRequired: false,
  providers: ['email'],
  googleEnabled: false,
  appleEnabled: false,
  roleChoice: false,
};

export type SignupPolicySource = 'live' | 'last_known' | 'unknown';

let lastKnown: SignupPolicy | null = null;

/** Test-only reset of the shared last-known policy. */
export function __resetSignupPolicyCacheForTests(): void {
  lastKnown = null;
}

export function getLastKnownSignupPolicy(): SignupPolicy | null {
  return lastKnown;
}

/**
 * Single shared reader used by CreateAccount, RoleSelection and Login.
 * On success the policy is remembered for the whole app session, so a failed
 * GET on a later screen reuses what the user was already shown instead of
 * falling back. `fetchPolicy` is injected so this module stays free of the
 * API client.
 *
 * ONB-SWEEP U3: the GET gives up after the startup step limit (8 s, not
 * axios's 30 s), so "Preparing sign-up." never holds a person on a stalled
 * network. A late answer is still remembered for the next screen.
 */
export async function loadSignupPolicy(
  fetchPolicy: () => Promise<{ data?: unknown } | undefined>,
  timeoutMs: number = STARTUP_STEP_TIMEOUT_MS,
): Promise<{ policy: SignupPolicy; source: SignupPolicySource }> {
  try {
    const live = Promise.resolve()
      .then(fetchPolicy)
      .then((res) => {
        const raw = res?.data;
        if (!raw || typeof raw !== 'object') return null;
        const policy = normalizeSignupPolicy(raw);
        lastKnown = policy;
        return policy;
      });
    const policy = await withStartupTimeout(live, 'signup policy', timeoutMs);
    if (policy) return { policy, source: 'live' };
  } catch {
    // fall through (failed, malformed or no answer in time)
  }
  if (lastKnown) return { policy: lastKnown, source: 'last_known' };
  return { policy: UNKNOWN_SIGNUP_POLICY, source: 'unknown' };
}
