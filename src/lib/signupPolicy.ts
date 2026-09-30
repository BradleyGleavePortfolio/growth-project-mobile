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

export type AuthProvider = 'email' | 'google' | 'apple';

export interface SignupPolicyResponse {
  invite_code_required?: boolean;
  coach_code_required?: boolean;
  providers?: unknown;
  /** Legacy name (never sent by the current backend). */
  require_invite_code?: boolean;
  /** Legacy name (never sent by the current backend). */
  google_signin_enabled?: boolean;
}

export interface SignupPolicy {
  inviteCodeRequired: boolean;
  providers: AuthProvider[];
  googleEnabled: boolean;
  appleEnabled: boolean;
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
  };
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
 */
export async function loadSignupPolicy(
  fetchPolicy: () => Promise<{ data?: unknown } | undefined>,
): Promise<{ policy: SignupPolicy; source: SignupPolicySource }> {
  try {
    const res = await fetchPolicy();
    const raw = res?.data;
    if (raw && typeof raw === 'object') {
      const policy = normalizeSignupPolicy(raw);
      lastKnown = policy;
      return { policy, source: 'live' };
    }
  } catch {
    // fall through
  }
  if (lastKnown) return { policy: lastKnown, source: 'last_known' };
  return { policy: UNKNOWN_SIGNUP_POLICY, source: 'unknown' };
}
