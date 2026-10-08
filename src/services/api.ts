// The Growth Project — API Client
// All backend communication flows through here.
// The Perplexity API key lives ONLY on the backend — never in this file.
//
// ============================================================================
// TOKEN-REFRESH CONCURRENCY CONTRACT (read before editing this file)
// ============================================================================
// Problem this solves:
//   Before this rewrite the interceptor used a bare `isRefreshing = true` flag.
//   When N requests hit 401 at the same time (e.g. HomeScreen's 4-call
//   Promise.all on cold start), only the first entered the refresh branch.
//   The rest saw `isRefreshing === true`, skipped the `if`, and fell straight
//   through to the logout block — so a single successful refresh would still
//   force-log-out the user because of the concurrent 401 path.
//
// A later iteration replaced that with a shared `refreshPromise` plus a
// per-request `_retry` boolean. That handled the N-concurrent-401s case but
// introduced a second bug (Lane-2 P0-3): `_retry` was stamped on the config
// BEFORE the refresh awaited, so if the retried request hit 401 a SECOND time
// (clock skew, a stale-token rejection arriving slightly later, brief server
// rejection of the just-issued token) the interceptor refused to refresh
// again and silently rejected the request. Scenario 5 in the previous comment
// claimed "two refreshes over a few seconds is acceptable" but the code path
// forbade it.
//
// Cycle-counter model (current contract):
//   * `currentCycleId` is a monotonically increasing module-level counter.
//     It bumps once after every successful refresh. The token most recently
//     written to SecureStore is "the cycle N token" where N == currentCycleId
//     at the moment the write completed.
//   * Each request config is stamped with `_refreshAttempts` (default 0) and
//     `_lastUsedCycleId` (the cycle whose token the most recent retry used).
//   * On 401, the interceptor allows up to MAX_REFRESH_ATTEMPTS retries per
//     request. Each retry coalesces onto the in-flight `refreshPromise` if one
//     exists; otherwise it starts a fresh refresh. This means scenario (c)
//     below — 5 concurrent 401s whose retries ALSO 401 — triggers exactly two
//     refresh calls (the second cycle starts only after the first cycle has
//     settled, and the second round of failures all coalesce on it).
//
// Scenarios this implementation handles:
//   1. Single 401 → refresh OK → retry → caller gets 200.
//   2. 5 simultaneous 401s → ONE refresh call in flight; requests 2–5 queue,
//      then all retry with the new token.
//   3. Refresh endpoint itself returns 401 (stale refresh token) → all queued
//      requests reject, `authEvents.emit('logout')` fires EXACTLY ONCE, token
//      keys are cleared once.
//   4. Refresh throws a network error (offline, timeout) → same as (3): all
//      queued requests reject with the error; logout emitted once. The user
//      data / onboarding keys are NOT cleared — see the security/critical-
//      fixes-round-1 branch for why we kept that behavior.
//   5. A 401 arrives AFTER a refresh has already completed → a fresh refresh
//      kicks off. With the cycle counter this is now a first-class case, not
//      an "acceptable side-effect": a request that retried with cycle-N's
//      token and 401'd again is allowed exactly one more refresh (cycle N+1).
//   6. Genuinely bad credentials → `performRefresh` itself rejects on the
//      FIRST attempt. `handleRefreshFailure` runs once, signOut emits logout,
//      and no second refresh kicks off because the failed refresh resolved
//      the promise. The `_refreshAttempts` cap is a belt-and-suspenders
//      backstop for the pathological case where every refresh succeeds yet
//      every subsequent request still 401s; after MAX_REFRESH_ATTEMPTS the
//      request rejects and we stop hammering the refresh endpoint.
//
// `loggedOutOnce` is reset inside `refreshPromise.finally()` rather than on a
// wall-clock timer. The previous setTimeout(…, 1000) was decoupled from the
// promise it guarded — a 401 cascade longer than one second could trigger a
// second sign-out emit. The flag is now tied to the same lifecycle as the
// in-flight refresh promise.
// ============================================================================

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { authEvents } from '../utils/authEvents';
import { secureStorage } from './secureStorage';
import { env } from '../config/env';
import { entitlementEvents } from '../entitlements/entitlementEvents';
import { withTutorialSignal } from '../tutorial/tutorialEvents';
import { logger } from '../utils/logger';
import { generateIdempotencyKey } from '../utils/idempotency';
import { REQUEST_ID_HEADER, extractRequestId, newRequestId } from '../utils/correlation';
import {
  dunningGenerationOf,
  dunningLockoutStore,
  isLockedDunningResponse,
  stampDunningGeneration,
} from '../entitlements/dunning/dunningLockoutStore';
import { Alert, Platform } from 'react-native';
import { nativeBuildNumber, purchasePolicyHeader } from '../config/purchaseSurfaces';
import type { SignupPolicyResponse } from '../lib/signupPolicy';
import {
  AccountChangedError,
  assertBindingMatches,
  bindingIsCurrent,
  isAccountChangedError,
  type AccountBinding,
} from './accountBinding';
import {
  holdSessionFence,
  sessionGeneration,
  sessionWritesSettled,
  type SessionFencePass,
} from './sessionFence';

function isEntitlementEndpoint(url?: string): boolean {
  if (!url) return false;
  return url.includes('/v1/checkout') || url.includes('/v1/clients/me/coach/packages');
}

// Security: API base URL is read from EXPO_PUBLIC_API_URL so staging/prod can
// diverge without code changes. A dev-only fallback keeps local RN boots
// working without a .env. See src/config/env.ts.
const API_BASE = env.API_URL;

// Supabase project constants now come from env (src/config/env.ts) — no more
// hardcoded duplicates.
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

/** error.message for a 403 LOCKED_DUNNING (payment lockout); exported for tests. */
export const LOCKED_DUNNING_MESSAGE =
  'Your plan is paused because of a payment problem, so this is not available right now. The payment screen shows what happened and what to do next.';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000, // 30sec — Fly.io free tier cold start can take up to 25sec
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request automatically.
// Security: token now comes from SecureStore (iOS Keychain / Android Keystore)
// via the secureStorage adapter, not plain AsyncStorage.
api.interceptors.request.use(async (config) => {
  // B-352-1: the auth generation this request starts under, read before the
  // token await, so a payment-lockout 403 answered after a sign-out or an
  // account switch is dropped instead of locking the next account.
  stampDunningGeneration(config);
  const token = await readTokenForRequest(config as RetryableConfig);
  // Mobile #331 Sol A-331-4: a request bound to an account (destructive
  // Roman chat deletes, and the reads that offer them) goes out only with a
  // credential of that same account and sign-in. This check runs after the
  // asynchronous token read, immediately before transport; on a mismatch the
  // request is cancelled here and never sent (see accountBinding.ts).
  const binding = (config as RetryableConfig).accountBinding;
  if (binding) assertBindingMatches(binding, token);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Support correlation (M5-D). An opaque per-request v4 UUID that carries no
  // user, device, or payload data, so it is safe on every route including
  // unauthenticated ones. A caller that set its own id keeps it.
  if (!config.headers[REQUEST_ID_HEADER]) {
    config.headers[REQUEST_ID_HEADER] = newRequestId();
  }
  // Audit #305 A1: platform, native build and purchase policy, so the server
  // can reject non-P2P purchase sessions for an iOS binary no matter what JS
  // is running. Native only; web keeps its CORS-allowed header set.
  if (Platform.OS !== 'web') {
    config.headers['X-Client-Platform'] = Platform.OS;
    const build = nativeBuildNumber();
    if (build !== null) config.headers['X-Client-Native-Build'] = String(build);
    config.headers['X-Client-Purchase-Policy'] = purchasePolicyHeader();
  }
  return config;
});

/**
 * Mobile #331 A-331-7: the stored access token, read so that the request's
 * session generation (sessionFence) and the token agree. The first send
 * records the generation the token belongs to (re-reading if a sign-in or
 * sign-out wrote the session keys during the read). A 401 replay must still
 * be in that generation: a request started under one session is never
 * replayed with the credential of the next one, even of the same account.
 */
async function readTokenForRequest(config: RetryableConfig): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Never read while a session-key write is landing (a half-written pair).
    await sessionWritesSettled();
    const before = sessionGeneration();
    const token = await secureStorage.getItem('supabase_token');
    if (sessionGeneration() !== before) continue;
    if (config._sessionGeneration === undefined) {
      config._sessionGeneration = before;
    } else if (config._sessionGeneration !== before) {
      throw new AccountChangedError(false);
    }
    return token;
  }
  // The session keys kept changing during every read: send nothing.
  throw new AccountChangedError(false);
}

// ---------------------------------------------------------------------------
// Token-refresh mutex + request queue
// ---------------------------------------------------------------------------
// While `refreshPromise` is non-null, any new 401 waits on it instead of kicking
// off a second refresh. The promise resolves with the new access token on
// success, or rejects on failure — callers await it and either retry or bubble
// the error up. `authEvents.emit('logout')` is guarded by `loggedOutOnce` so a
// fleet of concurrent 401s produces one sign-out, not N. The cycle counter
// tracks which generation of token a given retry used so a SECOND 401 (after a
// successful refresh) can still drive a follow-up refresh — see the contract
// header at the top of this file.
let refreshPromise: Promise<string> | null = null;
let loggedOutOnce = false;
let currentCycleId = 0;

// Hard cap on per-request refresh retries. Two is enough to cover the
// realistic case (a request used cycle-N's token, server still 401'd, give it
// one more cycle) without enabling an infinite-loop if the server is
// pathologically rejecting every freshly-issued token.
const MAX_REFRESH_ATTEMPTS = 2;

type RetryableConfig = AxiosRequestConfig & {
  _refreshAttempts?: number;
  _lastUsedCycleId?: number;
  // Set on requests whose 401 means "the credential in the BODY/HEADER was
  // rejected" (re-auth password, single-use recent-auth token), not "the
  // session expired". Refresh-and-retry would replay a wrong password against
  // a 5/min throttle, so these 401s go straight back to the caller.
  skipAuthRefresh?: boolean;
  // Mobile #331 Sol A-331-4: the account and sign-in this request belongs
  // to. Checked before every send (including a 401 replay); a 401 refreshes
  // only while that sign-in is still current.
  accountBinding?: AccountBinding;
  // Mobile #331 A-331-7: the session generation (sessionFence) whose token
  // this request was first sent with. A replay must still be in it.
  _sessionGeneration?: number;
};

/** Request options for a request bound to one account (see accountBinding.ts). */
export type BoundRequestConfig = AxiosRequestConfig & { accountBinding: AccountBinding };

async function performRefresh(startGeneration: number): Promise<string> {
  // Read refresh token from the SAME store the writers use (SecureStore via
  // secureStorage). Previously this read AsyncStorage while LoginScreen /
  // CreateAccountScreen / appleAuth / googleAuth all wrote to SecureStore —
  // the mismatch meant the refresh token was never found and every user got
  // signed out at the first 401 after access-token expiry (≈1 hour).
  const refreshToken = await secureStorage.getItem('supabase_refresh_token');
  if (!refreshToken) throw new Error('No refresh token');

  // Dynamic import keeps the supabase-js bundle out of the cold-start path for
  // apps that never hit a 401. The `__testRefreshSession` seam exists only so
  // unit tests can sidestep the dynamic import — see the test-only block
  // below for the contract.
  const refreshSession: RefreshSessionFn = __testRefreshSession
    ? __testRefreshSession
    : await (async () => {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return (args) => supabase.auth.refreshSession(args) as ReturnType<RefreshSessionFn>;
      })();
  const { data, error: refreshError } = await refreshSession({
    refresh_token: refreshToken,
  });
  // Mobile #331 Sol A-331-4: a refresh belongs to the session it started
  // in. If that session ended meanwhile (signed out, or another sign-in
  // stored its own refresh token), these tokens are for a session that is
  // over: they are never written over the new session's tokens, and nobody
  // is signed out for it.
  //
  // A-331-7 / B-331-7: the stored-token comparison alone is a check followed
  // by awaits. The tokens are published only under the session fence for the
  // generation this refresh started in, taken synchronously after the last
  // read: a sign-in or sign-out that began earlier has moved the generation
  // (nothing is written), and one that begins during the two writes waits
  // for them and then overwrites (sessionFence.ts).
  if ((await secureStorage.getItem('supabase_refresh_token')) !== refreshToken) {
    throw new AccountChangedError(false);
  }
  if (refreshError || !data.session) {
    throw refreshError || new Error('Refresh returned no session');
  }
  const fence = holdSessionFence(startGeneration);
  if (!fence) throw new AccountChangedError(false);
  try {
    await secureStorage.setItem('supabase_token', data.session.access_token, fence.pass);
    await secureStorage.setItem('supabase_refresh_token', data.session.refresh_token, fence.pass);
  } finally {
    fence.release();
  }
  // Bump only on success — failures must not advance the cycle, otherwise a
  // stale request would think the next cycle's token is in play and ask for
  // a third refresh.
  currentCycleId += 1;
  return data.session.access_token;
}

async function handleRefreshFailure(startGeneration: number): Promise<void> {
  // Fire exactly once per refresh-failure cascade. The flag is reset in the
  // refreshPromise.finally() chain so a subsequent successful login → 401
  // cycle still works without depending on a wall-clock timer.
  if (loggedOutOnce) return;
  loggedOutOnce = true;
  // B-313-5 / backend B-608-10: once an account is deleted, Supabase can no
  // longer refresh its session. Before signing out, ask the server whether
  // the token this phone last held belongs to a deleted account, so the
  // person is told the deletion is complete rather than silently signed
  // out. Only a server-confirmed `deleted` counts; any other answer, or no
  // answer, is an ordinary sign-out.
  //
  // B-331-8: the sign-out belongs to the session whose refresh failed. If
  // that session already ended or was replaced (the generation moved), nobody
  // is signed out for it.
  if (sessionGeneration() !== startGeneration) return;
  let deletionComplete = false;
  try {
    const stale = await secureStorage.getItem('supabase_token');
    if (stale) deletionComplete = await deletedByReceipt(stale);
  } catch {
    deletionComplete = false;
  }
  // Full sign-out on refresh failure: clears all auth keys (both stores),
  // resets analytics/Sentry, and emits logout. Lazy import avoids a require
  // cycle between api.ts and authActions.ts (authActions imports profileApi
  // from this file). The `__testSignOut` seam exists only so unit tests can
  // sidestep the dynamic import — production goes through `await import(...)`.
  //
  // B-331-8: the receipt check above awaited the network, so the session is
  // re-checked by taking the fence for it, synchronously, and the fence is
  // held for the whole sign-out. A sign-in that begins meanwhile waits and
  // writes its tokens after this sign-out finished; one that began earlier
  // has moved the generation, and this sign-out does not happen.
  const fence = holdSessionFence(startGeneration, 'signout');
  if (!fence) return;
  try {
    const signOut = __testSignOut
      ? __testSignOut
      : (await import('./authActions')).signOut;
    await signOut(undefined, { sessionFence: fence.pass });
  } catch (err) {
    logger.error('API', 'signOut on refresh failure threw', err);
    authEvents.emit('logout');
  } finally {
    // The failed session has ended: the generation moves.
    fence.release(true);
  }
  if (deletionComplete) {
    Alert.alert(DELETION_COMPLETE_NOTICE.title, DELETION_COMPLETE_NOTICE.body);
  }
}

/** Shown once when the server confirms the signed-out account was deleted. */
export const DELETION_COMPLETE_NOTICE = {
  title: 'Your account is deleted',
  body: 'Your account and your data have been deleted, as you asked. You have been signed out of this phone.',
} as const;

/**
 * POST /account-deletion/receipt with the (possibly expired) access token.
 * The server answers `{ state: 'deleted' }` only for a deleted account and
 * 404 NO_DELETION_RECEIPT otherwise.
 */
async function deletedByReceipt(accessToken: string): Promise<boolean> {
  try {
    const res = await api.post<{ state?: string }>('/account-deletion/receipt', undefined, {
      headers: { Authorization: `Bearer ${accessToken}` },
      skipAuthRefresh: true,
      timeout: 8000,
    } as RetryableConfig);
    return res?.data?.state === 'deleted';
  } catch {
    return false;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // A bound request stopped before it was sent: pass it through untouched.
    if (isAccountChangedError(error)) return Promise.reject(error);
    const originalConfig = error.config as RetryableConfig | undefined;
    const binding = originalConfig?.accountBinding;
    // A bound request whose sign-in ended while it was in flight (aborted, or
    // answered late): its answer belongs to a session that is over.
    if (binding && !bindingIsCurrent(binding)) {
      return Promise.reject(new AccountChangedError(true));
    }

    // Network error — no response from server (cold start, no wifi, etc.).
    // Do NOT log the user out; just surface a friendly message.
    if (!error.response) {
      error.message = 'Cannot reach server. Please check your connection and try again.';
      return Promise.reject(error);
    }

    // 403 LOCKED_DUNNING — Smart Dunning v2 Day-10 payment lockout. Report
    // it once to the app-wide store so DunningLockoutProvider shows the single
    // calm lockout screen; individual screens never render their own error
    // for it. The store drops it when the request started under a retired
    // auth generation (B-352-1). The message is specific and true for both
    // lock kinds (a failed payment, or a bank dispute or inquiry, where a
    // new card does not help), so any screen that surfaces error.message
    // still says what happened and where the next step is (C-352-4).
    if (isLockedDunningResponse(error.response.status, error.response.data)) {
      dunningLockoutStore.reportLocked({
        requestId: extractRequestId(error),
        requestUrl: (error.config as { url?: string } | undefined)?.url,
        generation: dunningGenerationOf(error.config),
      });
      error.message = LOCKED_DUNNING_MESSAGE;
      return Promise.reject(error);
    }

    // 402 — entitlement required. Emit an event so the EntitlementProvider
    // can show the paywall, then reject. Skip emission for checkout endpoints
    // themselves (they are expected to return 402 as part of normal flow).
    if (error.response?.status === 402) {
      const data = error.response.data as {
        error?: string;
        message?: string;
        action?: string;
      } | undefined;

      if (data?.error === 'CLIENT_ENTITLEMENT_REQUIRED') {
        const requestUrl = (error.config as { url?: string })?.url;
        if (!isEntitlementEndpoint(requestUrl)) {
          entitlementEvents.emitRequired({
            status: 402,
            code: data.error,
            message: data.message ?? 'Choose a plan to continue.',
            action: data.action,
            requestUrl,
          });
        }
      }
      return Promise.reject(error);
    }

    if (error.response.status !== 401 || !originalConfig || originalConfig.skipAuthRefresh) {
      return Promise.reject(error);
    }

    // Per-request retry cap. The first 401 has attempts=0; each successful
    // refresh + retry increments. After MAX_REFRESH_ATTEMPTS the request
    // rejects (and, because the latest refresh succeeded, no logout fires —
    // logout is reserved for the refresh-itself-failing path).
    const attempts = originalConfig._refreshAttempts ?? 0;
    if (attempts >= MAX_REFRESH_ATTEMPTS) {
      return Promise.reject(error);
    }

    // A-331-7 (Sol round 2): a 401 for a request first sent in an older
    // session generation belongs to a session that has ended or is being
    // replaced (a sign-in or sign-out wrote a session key since, possibly
    // only one key of the pair so far). It never starts or joins a refresh,
    // which could otherwise read the old refresh token beside the new access
    // token. An unbound request keeps its original 401 (C-331-8).
    if (
      originalConfig._sessionGeneration !== undefined &&
      originalConfig._sessionGeneration !== sessionGeneration()
    ) {
      return Promise.reject(binding ? new AccountChangedError(false) : error);
    }

    // If a refresh is already in flight, await it. Otherwise start one. The
    // promise is shared across all concurrent 401s so N parallel requests
    // produce a single refresh call per cycle.
    if (!refreshPromise) {
      refreshPromise = (async () => {
        // The session this refresh belongs to (sessionFence generation),
        // taken once no session-key write is landing.
        await sessionWritesSettled();
        const startGeneration = sessionGeneration();
        try {
          return await performRefresh(startGeneration);
        } catch (err) {
          // A refresh overtaken by a sign-out or sign-in is not a failed
          // session: the new session must not be signed out for it.
          if (!isAccountChangedError(err)) await handleRefreshFailure(startGeneration);
          throw err;
        }
      })()
        .finally(() => {
          // Clear the promise so the next 401 burst can trigger a fresh
          // refresh. Reset `loggedOutOnce` on the SAME chain so the guard's
          // lifetime is bound to the refresh attempt, not a wall-clock timer.
          refreshPromise = null;
          loggedOutOnce = false;
        });
    }

    try {
      const newToken = await refreshPromise;
      // The replay below goes through the request interceptor, which checks
      // the binding against the stored token again; stop here already when
      // the sign-in changed during the refresh.
      if (binding && !bindingIsCurrent(binding)) throw new AccountChangedError(false);
      // A-331-7: a request first sent under another session (a sign-in or
      // sign-out wrote the session keys since) is never replayed with the
      // new session's credential.
      if (
        originalConfig._sessionGeneration !== undefined &&
        originalConfig._sessionGeneration !== sessionGeneration()
      ) {
        throw new AccountChangedError(false);
      }
      originalConfig._refreshAttempts = attempts + 1;
      originalConfig._lastUsedCycleId = currentCycleId;
      originalConfig.headers = originalConfig.headers || {};
      (originalConfig.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
      // Awaited so a replay stopped by the request interceptor (session
      // changed) is mapped by the catch below like the check above.
      return await api.request(originalConfig);
    } catch (refreshErr) {
      // C-331-8: an unbound request whose session ended under it keeps its
      // original 401 (already mapped to signed-out copy by callers); only a
      // bound request reports AccountChangedError.
      if (!binding && isAccountChangedError(refreshErr)) return Promise.reject(error);
      return Promise.reject(refreshErr);
    }
  },
);

// Test-only seams. Production code never reads these — they exist so the
// jest suite can stub the two dynamic imports inside performRefresh /
// handleRefreshFailure without needing Node's --experimental-vm-modules flag
// (which is what unmocked dynamic `import()` requires under jest). The
// production path goes through `await import(...)` unchanged.
type RefreshSessionFn = (args: { refresh_token: string }) => Promise<{
  data: { session: { access_token: string; refresh_token: string } | null };
  error: unknown;
}>;
let __testRefreshSession: RefreshSessionFn | null = null;
type SignOutFn = (userId?: string | null, opts?: { sessionFence?: SessionFencePass }) => Promise<void>;
let __testSignOut: SignOutFn | null = null;

export function __setRefreshSessionForTests(fn: RefreshSessionFn | null): void {
  __testRefreshSession = fn;
}
export function __setSignOutForTests(fn: SignOutFn | null): void {
  __testSignOut = fn;
}

export function __resetRefreshStateForTests(): void {
  refreshPromise = null;
  loggedOutOnce = false;
  currentCycleId = 0;
  __testRefreshSession = null;
  __testSignOut = null;
}

export default api;

// ============================================================
// TYPED API FUNCTIONS
// ============================================================

export interface InvitePreview {
  valid: boolean;
  coach_name?: string;
  business_name?: string;
  accent_color?: string;
  logo_url?: string;
  reason?: string;
}

/**
 * `/auth/signup-with-code` response. `invite_attached` / `invite_attach_error`
 * come from the C03 backend change; older backends omit them (treated as
 * unknown, see lib/inviteAttachOutcome).
 */
export interface SignupWithCodeResponse {
  message?: string;
  requires_verification?: boolean;
  user_id?: string;
  email?: string;
  invite_attached?: boolean;
  invite_attach_error?: string;
}

/**
 * `POST /auth/register` response. `role` is added by backend #597 (C13):
 * 'student' (client) or 'coach', the role the account was created with.
 * Older backends omit it.
 */
export interface RegisterResponse {
  requires_verification?: boolean;
  role?: string;
  email?: string;
  user?: unknown;
}

export const authApi = {
  // `intended_role` (signup role choice, C13) is sent only when the caller
  // passes it, which CreateAccount does only when the live signup policy
  // advertises `role_choice: true` and no invite code is involved. A coach
  // request is never retried without the field; see lib/intendedRole.ts.
  register: (
    data: { email: string; password: string; name: string; phone?: string; invite_code?: string },
    intendedRole?: IntendedRole,
  ) =>
    postWithIntendedRole(
      (body) => api.post<RegisterResponse>('/auth/register', body),
      data,
      data.invite_code ? undefined : intendedRole,
    ),
  // Invite-code signup is always a client: the server default. The field is
  // never sent here (the server refuses 'coach' with a code anyway).
  // `coach_sharing_notice` (B-SHARE-127) only when the screen showed the
  // coach-sharing sentence (lib/coachSharingNotice).
  signupWithCode: (data: { email: string; password: string; name: string; phone?: string; invite_code: string; coach_sharing_notice?: string }) =>
    api.post<SignupWithCodeResponse>('/auth/signup-with-code', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  // With an invite code the user is always a client, so `intended_role` is
  // omitted regardless of what the caller passed.
  googleAuth: (token: string, inviteCode?: string, intendedRole?: IntendedRole, coachSharingNotice?: string) =>
    postWithIntendedRole(
      (body) => api.post('/auth/google', body),
      inviteCode
        ? { token, invite_code: inviteCode, ...(coachSharingNotice ? { coach_sharing_notice: coachSharingNotice } : {}) }
        : { token },
      inviteCode ? undefined : intendedRole,
    ),
  // Apple Sign-In: POST the identity token from expo-apple-authentication.
  // Backend verifies the JWT against Apple's JWKS and returns the same
  // session shape as /auth/google.
  // Same body as utils/appleAuth.buildAppleAuthBody (live DTO whitelist:
  // token, full_name string, invite_code). Unused by screens today.
  appleAuth: (
    identityToken: string,
    extras: { fullName?: string; inviteCode?: string } = {},
  ) =>
    api.post('/auth/apple', {
      token: identityToken,
      ...(extras.fullName ? { full_name: extras.fullName } : {}),
      ...(extras.inviteCode ? { invite_code: extras.inviteCode } : {}),
    }),
  attachInviteCode: (code: string, coachSharingNotice?: string | null) =>
    api.post('/auth/attach-invite-code', {
      invite_code: code,
      ...(coachSharingNotice ? { coach_sharing_notice: coachSharingNotice } : {}),
    }),
  selectRole: (role: 'coach' | 'student', coachCode?: string) =>
    api.post('/auth/select-role', { role, coach_code: coachCode }),
  me: () =>
    api.get('/auth/me'),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  // FW-ONB-128 B1: public, enumeration-safe; same answer for any address.
  resendVerification: (email: string) =>
    api.post<{ message: string }>('/auth/resend-verification', { email }),
  validateInviteCode: (code: string) =>
    api.post<InvitePreview>('/auth/validate-invite-code', { code }),
  // Public preview — read-only, no PII; surfaces coach branding before signup.
  getInvitePreview: (code: string) =>
    api.get<InvitePreview>(`/invite/${encodeURIComponent(code)}/preview`),
  // Backend feature flag: when true, codeless client signup is rejected.
  // Mobile checks this on the signup screen so the UX matches policy.
  // Canonical fields: `invite_code_required` + `providers[]`. Legacy names are
  // typed as optional so `normalizeSignupPolicy` can fall back to them. Read
  // it only through `lib/signupPolicy.normalizeSignupPolicy`.
  getSignupPolicy: () => api.get<SignupPolicyResponse>('/auth/signup-policy'),
};

export const profileApi = {
  get: () => api.get('/profile'),
  update: (data: Record<string, unknown>) => api.put('/profile', data),
};

export const foodApi = {
  search: (q: string, limit = 20) =>
    api.get(`/foods/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  getById: (id: string) =>
    api.get(`/foods/${id}`),
  create: (data: Record<string, unknown>) =>
    api.post('/foods', data),
};

export const logApi = {
  logFood: (data: {
    date: string;
    meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    food_item_id: string;
    quantity_multiplier?: number;
    // Also persist the human-readable quantity + unit the
    // user picked so coaches can see "6 oz" instead of "quantity_multiplier:
    // 1.7008". Backend stores these on LoggedFoodEntry.
    original_quantity?: number;
    original_unit?: string;
    notes?: string;
    // Idempotency key from the offline queue so a flush retry doesn't create
    // a duplicate LoggedFoodEntry. Optional — direct (non-queued) logs omit it.
    client_uuid?: string;
    // Clinic tutorial: a 2xx food log is the real "first meal" action. The
    // response passes through untouched; a failure emits nothing.
  }) => withTutorialSignal(api.post('/log/food', data), 'meal_logged'),
  getDaily: (date: string) =>
    api.get(`/log/daily?date=${date}`),
  updateEntry: (id: string, data: Record<string, unknown>) =>
    api.put(`/log/food/${id}`, data),
  deleteEntry: (id: string) =>
    api.delete(`/log/food/${id}`),
  getWeekly: (weekStart: string) =>
    api.get(`/log/weekly?week_start=${weekStart}`),
};

// Structured client context relayed by the backend to the AI provider.
// The mobile app never assembles raw PII into prompts; it just sends the
// user's message and lets the server attach the structured context.
export interface AIStructuredContext {
  user: { id: string; first_name?: string; created_at?: string };
  coach?: { id: string; name?: string; business_name?: string };
  goals?: { primary?: string; calorie_target?: number; protein_g?: number };
  recent: {
    log_streak_days?: number;
    last_logged_at?: string | null;
    last_check_in_at?: string | null;
    habit_completion_7d?: number;
  };
  preferences?: { units?: 'metric' | 'imperial'; tone?: string };
}

export const aiApi = {
  // Send only the user's message. Server attaches structured context, persona,
  // and guardrails. Conversation history is optional for short-term continuity.
  chat: (message: string, history?: Array<{ role: string; content: string }>) =>
    api.post('/ai/chat', { message, conversation_history: history ?? [] }),
  // Replaces the old /ai/context. Returns the structured context the backend
  // would attach if the client called /ai/chat right now — useful for showing
  // a "what your coach has shared" panel before a conversation starts.
  getStructuredContext: () =>
    api.get<AIStructuredContext>('/ai/structured-context'),
};

export const workoutApi = {
  create: (data: Record<string, unknown>) =>
    api.post('/workouts', data),
  getAll: (limit = 10) =>
    api.get(`/workouts?limit=${limit}`),
  getVolume: (period: 'week' | 'month') =>
    api.get(`/workouts/volume?period=${period}`),
  deleteWorkout: (id: string) =>
    api.delete(`/workouts/${encodeURIComponent(id)}`),
  getRoutines: () =>
    api.get('/routines'),
  createRoutine: (data: Record<string, unknown>) =>
    api.post('/routines', data),
  updateRoutine: (id: string, data: Record<string, unknown>) =>
    api.put(`/routines/${id}`, data),
  deleteRoutine: (id: string) =>
    api.delete(`/routines/${id}`),
};

export const fastingApi = {
  start: (data?: { protocol?: string; notes?: string }) =>
    api.post('/fasting/start', data || {}),
  end: (notes?: string) =>
    api.post('/fasting/end', { notes }),
  getHistory: (limit = 10) =>
    api.get(`/fasting/history?limit=${limit}`),
};

export const weightApi = {
  log: (data: { weight_lbs: number; date?: string; notes?: string }) =>
    api.post('/weight', data),
  getHistory: (days = 30) =>
    api.get(`/weight/history?days=${days}`),
};

export const habitsApi = {
  getAll: () => api.get('/habits'),
  create: (data: Record<string, unknown>) => api.post('/habits', data),
  logHabit: (id: string, data: Record<string, unknown>) =>
    api.post(`/habits/${id}/log`, data),
  delete: (id: string) => api.delete(`/habits/${id}`),
  getLogs: (date: string) =>
    api.get(`/habits/logs?date=${date}`),
};

export const coachApi = {
  /** One roster page; `cursor` is the last row id of the previous page. */
  getClients: (
    status?: 'active' | 'archived' | 'all',
    cursor?: string,
    take?: number,
  ) => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (cursor) query.set('cursor', cursor);
    if (take) query.set('take', String(take));
    const qs = query.toString();
    return api.get('/coach/clients' + (qs ? `?${qs}` : ''));
  },
  archiveClient: (clientId: string) => api.post(`/coach/clients/${clientId}/archive`),
  unarchiveClient: (clientId: string) => api.post(`/coach/clients/${clientId}/unarchive`),
  getClientTimeline: (clientId: string, days?: number) =>
    api.get(`/coach/clients/${clientId}/timeline${days ? `?days=${days}` : ''}`),
  getClientSummary: (clientId: string) =>
    api.get(`/coach/clients/${clientId}/summary`),
  getGuidelines: (clientId: string) =>
    api.get(`/coach/guidelines/${clientId}`),
  getMyGuidelines: () =>
    api.get('/coach/my-guidelines'),
  postGuidelines: (clientId: string, guidelines: string) =>
    api.post(`/coach/guidelines/${clientId}`, { guidelines }),
  getAlerts: () => api.get('/coach/alerts'),
  getDashboard: () => api.get('/coach/dashboard'),
  /** Pre-aggregated summary endpoint — scales to 100+ clients via parallel aggregations. */
  getDashboardSummary: () => api.get('/coach/dashboard/summary'),
  // ── Invite codes ──
  listInviteCodes: () => api.get('/coach/invite-codes'),
  createInviteCode: (data: { expires_at?: string | null; max_uses?: number | null }) =>
    api.post('/coach/invite-codes', data),
  revokeInviteCode: (id: string) =>
    api.delete(`/coach/invite-codes/${id}`),
  // ── Invite code redeemer drilldown ─────────────────────────────────────
  // Backend contract: GET /coach/invite-codes/:id/redeemers returns the
  // accounts that signed up using a specific invite code, sorted newest
  // first. The route is live; a 404 means the invite code was not found.
  getInviteCodeRedeemers: (
    inviteCodeId: string,
  ) =>
    api.get<{
      redeemers: Array<{
        user_id: string;
        name: string;
        email: string;
        redeemed_at: string;
        last_active_at: string | null;
      }>;
    }>(`/coach/invite-codes/${inviteCodeId}/redeemers`),
  // ── Messaging (coach → client thread) ──
  getClientMessages: (clientId: string, params?: { before?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.before) q.set('before', params.before);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get(`/coach/clients/${clientId}/messages${qs ? `?${qs}` : ''}`);
  },
  sendClientMessage: (clientId: string, body: string) =>
    api.post(`/coach/clients/${clientId}/messages`, { body }),
  markClientThreadRead: (clientId: string) =>
    api.post(`/coach/clients/${clientId}/messages/read`),
  getUnreadCounts: () => api.get('/coach/messages/unread-count'),
  // ── Nudges ──
  sendNudge: (clientId: string, data: { title: string; body: string }) =>
    api.post(`/coach/clients/${clientId}/nudges`, data),
  // ── Meal plans (server is source of truth) ──
  listClientMealPlans: (clientId: string) =>
    api.get(`/coach/clients/${clientId}/meal-plans`),
  createClientMealPlan: (clientId: string, data: Record<string, unknown>) =>
    api.post(`/coach/clients/${clientId}/meal-plans`, data),
  updateMealPlan: (planId: string, data: Record<string, unknown>) =>
    api.patch(`/coach/meal-plans/${planId}`, data),
  archiveMealPlan: (planId: string) =>
    api.delete(`/coach/meal-plans/${planId}`),
  // ── Food log review (coach read) ──
  // B15: backend exposes the client's food entries via the timeline endpoint
  // (which interleaves food/weight/workout/check-in events). The mobile fans
  // out from there. If the backend later ships a dedicated /food-logs route
  // for coaches, swap the call here and the screen stays put.
  getClientFoodLogs: (
    clientId: string,
    params?: { days?: number; limit?: number },
  ) => {
    const q = new URLSearchParams();
    const days = params?.days ?? 7;
    q.set('days', String(days));
    if (params?.limit) q.set('limit', String(params.limit));
    return api.get(`/coach/clients/${clientId}/timeline?${q.toString()}`);
  },
  // ── Check-ins (coach read) ──
  getClientCheckIns: (
    clientId: string,
    params?: { from?: string; to?: string; limit?: number },
  ) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get(`/coach/clients/${clientId}/check-ins${qs ? `?${qs}` : ''}`);
  },
  // Coach marks one check-in reviewed (live on production; 404 when the
  // check-in is not attached to this coach).
  markCheckInReviewed: (clientId: string, checkInId: string) =>
    api.post(`/coach/clients/${clientId}/check-ins/${checkInId}/reviewed`),
};

// ---------------------------------------------------------------------------
// Stage 3 — coach practice type + cross-pillar federation surfaces.
//
// Endpoints implemented in `gpb/src/coach/cross-pillar/*` and
// `gpb/src/coach/practice-type/*`. Both reuse the existing OWNER
// federation infrastructure (FederationService, FinanceAdminClient)
// behind a coach-facing guard chain (JWT + Coach + practice='both').
//
// Strict types live in `../types/crossPillar.ts` so the same shapes are
// rendered everywhere the cross-pillar UI consumes them. No
// `Record<string, unknown>` on cross-app contracts.
// ---------------------------------------------------------------------------
import type {
  CoachPracticeType,
  CrossPillarAnalyticsResponse,
  CrossPillarClientResponse,
  CrossPillarRosterResponse,
  CrossPillarSearchResponse,
  PracticeTypeResponse,
} from '../types/crossPillar';
import { postWithIntendedRole, type IntendedRole } from '../lib/intendedRole';

export const practiceTypeApi = {
  get: () => api.get<PracticeTypeResponse>('/coach/practice'),
  set: (practice_type: CoachPracticeType) =>
    api.put<PracticeTypeResponse>('/coach/practice', { practice_type }),
};

export const crossPillarApi = {
  getAnalytics: () =>
    api.get<CrossPillarAnalyticsResponse>('/coach/cross-pillar/analytics'),
  getClients: () =>
    api.get<CrossPillarRosterResponse>('/coach/cross-pillar/clients'),
  getClient: (identityKey: string) =>
    api.get<CrossPillarClientResponse>(
      `/coach/cross-pillar/clients/${encodeURIComponent(identityKey)}`,
    ),
  search: (q: string, limit?: number) => {
    const params = new URLSearchParams({ q });
    if (limit) params.set('limit', String(limit));
    return api.get<CrossPillarSearchResponse>(
      `/coach/cross-pillar/search?${params.toString()}`,
    );
  },
};

export const messagesApi = {
  list: (params?: { before?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.before) q.set('before', params.before);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get(`/messages${qs ? `?${qs}` : ''}`);
  },
  // Clinic tutorial teach-back: a 2xx send to the client's coach thread is
  // the real "message your coach" action. Response passes through untouched.
  send: (body: string) => withTutorialSignal(api.post('/messages', { body }), 'message_sent'),
  markRead: () => api.post('/messages/read'),
  unreadCount: () => api.get('/messages/unread-count'),
  // ED.6 — coach-review marker for the client's thread. Returns
  // { coachReviewedAt: ISO | null }; null when no coach review yet or the
  // backend FEATURE_ROMAN_COACH_REVIEWED_AT flag is OFF. Feeds the
  // CompetencePill at the top of the thread.
  coachReview: () =>
    api.get<{ coachReviewedAt: string | null }>('/messages/coach-review'),
};

export const nudgesApi = {
  list: (params?: { since?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.since) q.set('since', params.since);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get(`/nudges${qs ? `?${qs}` : ''}`);
  },
  unreadCount: () => api.get('/nudges/unread-count'),
  markRead: (id: string) => api.post(`/nudges/${id}/read`),
};

/** Psych #4: Preference-Controlled Personalization */
export const preferencesApi = {
  get: () => api.get('/users/me/preferences'),
  patch: (data: Record<string, unknown>) => api.patch('/users/me/preferences', data),
};

export const notificationsApi = {
  getPreferences: () => api.get('/notifications/preferences'),
  updatePreferences: (data: Record<string, unknown>) =>
    api.patch('/notifications/preferences', data),
  // B-NOTIF-6: the device zone with provenance (backend #647). Quiet hours
  // (21:00-08:00) and booking times in notifications use it.
  setTimezone: (timezone: string) =>
    api.put<{ timezone: string | null; stored: boolean }>('/notifications/timezone', {
      timezone,
      source: 'device',
    }),
};

export const communityApi = {
  getFeed: () => api.get('/community/feed'),
  postWin: (data: { title: string; description: string; visibility?: 'circle' | 'public' }) =>
    api.post('/community/wins', data),
};

export const waterApi = {
  log: (data: { amount_ml: number; date?: string }) =>
    api.post('/nutrition/water', data),
  getDaily: (date: string) =>
    api.get(`/nutrition/water?date=${date}`),
  getWeekly: (startDate: string) =>
    api.get(`/nutrition/water/weekly?start_date=${startDate}`),
};

export const lessonsApi = {
  getAll: () => api.get('/lessons'),
  create: (data: Record<string, unknown>) => api.post('/lessons', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/lessons/${id}`, data),
  complete: (id: string) => api.post(`/lessons/${id}/complete`),
  getRecommended: () => api.get('/lessons/recommended'),
};

// Meal plans (client-facing, read-only).
// Coach creates/edits via coachApi.createClientMealPlan / updateMealPlan /
// archiveMealPlan; the client just reads what the coach assigned.
export const mealPlansApi = {
  list: () => api.get('/meal-plans'),
  get: (id: string) => api.get(`/meal-plans/${id}`),
};

// Daily check-ins. POST /check-ins upserts on `date`, so saving the same day
// twice replaces the row rather than creating duplicates.
export const checkInsApi = {
  save: (data: {
    date: string;
    mood?: number | null;
    energy?: number | null;
    sleep_hours?: number | null;
    weight_kg?: number | null;
    notes?: string | null;
  }) => api.post('/check-ins', data),
  list: (params?: { from?: string; to?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return api.get(`/check-ins${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => api.get(`/check-ins/${id}`),
};

// F12 — Recipes
export const recipesApi = {
  list: () => api.get('/recipes'),
  listSaved: () => api.get('/recipes/saved'),
  getById: (id: string) => api.get(`/recipes/${id}`),
  // The allergen list and this account's saved allergens that hide shared recipes (ALLERGY-M-130).
  allergens: () => api.get('/recipes/allergens'),
  create: (data: Record<string, unknown>) => api.post('/recipes', data),
  save: (id: string) => api.post(`/recipes/${id}/save`),
  unsave: (id: string) => api.delete(`/recipes/${id}/save`),
};

// F13 — Grocery & Shopping Lists
export const listsApi = {
  getList: (type: 'grocery' | 'shopping') => api.get(`/lists/${type}`),
  addItem: (type: 'grocery' | 'shopping', data: { name: string; quantity?: number; unit?: string; source_recipe_id?: string }) =>
    api.post(`/lists/${type}`, data),
  // One transactional request (POST /lists/:type/bulk): all items are added or none are.
  bulkAdd: (type: 'grocery' | 'shopping', items: Array<{ name: string; quantity?: number; unit?: string; source_recipe_id?: string }>) =>
    api.post<{ added: number }>(`/lists/${type}/bulk`, { items }),
  updateItem: (id: string, data: { is_checked?: boolean; quantity?: number; name?: string }) =>
    api.patch(`/lists/items/${id}`, data),
  deleteItem: (id: string) => api.delete(`/lists/items/${id}`),
  clearChecked: (type: 'grocery' | 'shopping') => api.post(`/lists/${type}/clear-checked`),
};

// F14 — Prep Guide
export const prepGuideApi = {
  getWeeklyGuide: (week?: string) =>
    api.get(`/prep-guide${week ? `?week=${week}` : ''}`),
};

// ── Identity (Psych #3) + Trust (Psych #2) ─────────────────────────────────
export interface AccountStatus {
  // True only when the account has been scheduled for deletion and has not
  // yet been hard-deleted. The response also returns the ISO timestamp the
  // grace window opened so the UI can render an exact "permanent on" date.
  deletionScheduled: boolean;
  scheduledAt?: string | null;
  gracePeriodDays?: number | null;
  permanentDeletionAt?: string | null;
}

export const usersApi = {
  getFoundingNumber: () =>
    api.get<{ rank: number; total: number; isFoundingMember: boolean }>(
      '/users/me/founding-number',
    ),
  getCircleStats: () =>
    api.get<{ trainedTodayCount: number; totalMembers: number }>(
      '/users/me/circle-stats',
    ),
  updatePushToken: (token: string | null) =>
    api.patch('/users/me/push-token', { token }),
  // Psych #2: Trust as Emotion
  requestDataExport: () =>
    api.post<{ requested: boolean; eta: string }>('/users/me/data-export'),
  deleteAccount: () =>
    api.delete<{ scheduled: boolean; gracePeriodDays: number }>('/users/me/account'),
  // GET returns the deletion schedule (or { deletionScheduled: false } if the
  // account is in good standing). DELETE on the same path cancels a pending
  // deletion within the grace window. Both endpoints sit alongside the
  // existing DELETE /users/me/account that schedules deletion.
  getAccountStatus: () => api.get<AccountStatus>('/users/me/account/status'),
  cancelAccountDeletion: () =>
    api.post<{ cancelled: boolean }>('/users/me/account/cancel-deletion'),
};

// ── Coach billing & subscription ────────────────────────────────────────────
// Mobile shows status; the actual checkout / card-update flow lives on the
// backend portal session (Stripe billing portal). The portal endpoint returns
// a one-time URL the app opens in a system web browser, then drops the user
// back into the Settings screen when the sheet closes.
export interface CoachBillingStatus {
  // 'active' = paid, billing OK
  // 'trialing' = trial in progress
  // 'past_due' = payment failed but access still allowed
  // 'paused' = access paused (no checkout completed yet, or grace window over)
  // 'canceled' = subscription ended
  // 'none' = never subscribed (self-serve seat not yet provisioned)
  state: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled' | 'none';
  planName?: string | null;
  seatLimit?: number | null;
  seatsUsed?: number | null;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  // Backend renders a human-readable summary it wants the app to show
  // verbatim (e.g. "Past-due since Apr 21 — please update your card"). Render
  // when present rather than constructing copy on the client.
  summary?: string | null;
}

// Invoice row as exposed by GET /v1/coach/me/billing — shape mirrors what
// the backend BFF returns from `prisma.invoice.findMany`.
export interface CoachInvoice {
  id: string;
  stripe_invoice_id: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  currency: string;
  status: string; // 'paid' | 'open' | 'void' | 'uncollectible' | …
  invoice_pdf?: string | null;
  hosted_invoice_url?: string | null;
  created_at: string;
}

// Full billing payload from GET /v1/coach/me/billing — the BFF route used by
// the admin console. Mobile uses it to render the invoice list; the compact
// pill keeps coming from /coach/billing/status (cheaper for cold start).
export interface CoachBillingFull {
  subscription: {
    status: string;
    stripe_price_id: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    trial_end: string | null;
  } | null;
  invoices: CoachInvoice[];
}

// GET /coach/billing/status sends { status, plan_tier, current_period_end,
// cancel_at_period_end, trial_end } (backend mobile-coach-billing.controller.ts):
// 'unprovisioned' when the coach has no subscription row, else the raw Stripe
// subscription status. Each maps to a screen state; a missing or unknown value
// reads as 'none' (coaching needs no coach plan). plan_tier is a Stripe price
// id, not a plan name, so it is not shown.
const COACH_BILLING_STATES: Record<string, CoachBillingStatus['state']> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
  incomplete: 'none',
  incomplete_expired: 'none',
  unprovisioned: 'none',
};

export function toCoachBillingStatus(raw: unknown): CoachBillingStatus {
  const body = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const code = text(body.status);
  return {
    state:
      code !== null && Object.prototype.hasOwnProperty.call(COACH_BILLING_STATES, code)
        ? COACH_BILLING_STATES[code]
        : 'none',
    currentPeriodEnd: text(body.current_period_end),
    trialEndsAt: text(body.trial_end),
    cancelAtPeriodEnd: body.cancel_at_period_end === true,
  };
}

export const coachBillingApi = {
  getStatus: () =>
    api
      .get<unknown>('/coach/billing/status')
      .then((res) => ({ ...res, data: toCoachBillingStatus(res.data) })),
  // Full billing payload incl. last 24 invoices. The mobile billing screen
  // uses this so a coach can pull up invoice PDFs without leaving the app.
  getFull: () => api.get<CoachBillingFull>('/v1/coach/me/billing'),
  // POST returns { url } — a one-time Stripe billing portal URL. The app
  // opens it in a browser sheet; the portal handles checkout / card update /
  // cancel. The endpoint accepts an optional return path so the portal can
  // bounce the coach back to the right deep link when they finish.
  createPortalSession: (returnPath?: string, idempotencyKey?: string) => {
    // Idempotency-Key prevents duplicate portal sessions on double-tap (R19).
    return api.post<{ url: string }>(
      '/coach/billing/portal-session',
      returnPath ? { return_path: returnPath } : {},
      { headers: { 'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey() } },
    );
  },
};

// ── Public system / trust metadata (no auth required) ───────────────────────
export const systemApi = {
  getTrustMeta: () =>
    api.get<{
      lastSecurityUpdate: string;
      encryptionLevel: string;
      dataResidency: string;
      auditPolicyVersion: string;
      dataExportSupported: boolean;
      accountDeletionSupported: boolean;
    }>('/system/trust-meta'),
};

// ── Phase 10 — GDPR right to erasure / Apple 5.1.1(v) in-app deletion ──────
// Canonical in-app flow (backend src/account-deletion/):
//   1. POST /auth/recent-auth-token  — fresh re-auth (password, a fresh
//      Sign in with Apple identity token, or a fresh Google sign-in session).
//      Returns a short-lived single-use token bound to the caller.
//   2. POST /me/delete-account with header X-Recent-Auth-Token — schedules the
//      deletion in the same request: the grace period starts now and the
//      response carries the exact purge date. Idempotent.
//   3. GET  /me/delete-account/status — state + purge date for the status view.
//   4. POST /me/delete-account/cancel — cancel during the grace period.
// The legacy usersApi.deleteAccount (DELETE /users/me/account) is not used by
// the app's deletion screen.

export interface DeletionStatus {
  state: 'none' | 'requested' | 'confirmed' | 'deleted';
  requested_at?: string | null;
  confirmed_at?: string | null;
  grace_days?: number | null;
  purge_after?: string | null;
  /** Latest time the nightly job is expected to have finished (purge_after + 1 day). */
  completes_by?: string | null;
  deleted_at?: string | null;
  cancellable?: boolean | null;
}

/**
 * Outcome of the server's Sign in with Apple token revocation (backend
 * apple-token-revocation.service.ts). Only 'revoked' means Apple confirmed
 * the app's access was removed; every other value needs the manual fallback.
 */
export type AppleRevocationOutcome =
  | 'revoked'
  | 'not_requested'
  | 'not_configured'
  | 'exchange_failed'
  | 'revoke_failed';

export interface DeletionScheduledResponse {
  state: 'confirmed';
  already_scheduled: boolean;
  message: string;
  requested_at: string | null;
  confirmed_at: string | null;
  grace_days: number;
  purge_after: string;
  completes_by?: string | null;
  cancellable: boolean;
  apple_revocation?: AppleRevocationOutcome;
}

/**
 * Re-auth proof for POST /auth/recent-auth-token. `google_session` is the
 * access token of a Supabase session created by a Google sign-in moments ago
 * (the app has no Google client id, so it cannot obtain a Google ID token).
 */
export type RecentAuthProof =
  | { password: string }
  | { provider: 'apple'; provider_token: string }
  | { provider: 'google_session'; provider_token: string };

/**
 * True when the API reports the account as deleted (backend auth guard:
 * 403 { code: 'ACCOUNT_DELETED' }). This is the terminal deletion signal.
 */
export function isAccountDeletedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const response: unknown = Reflect.get(err, 'response');
  if (typeof response !== 'object' || response === null) return false;
  const data: unknown = Reflect.get(response, 'data');
  return (
    Reflect.get(response, 'status') === 403 &&
    typeof data === 'object' &&
    data !== null &&
    Reflect.get(data, 'code') === 'ACCOUNT_DELETED'
  );
}

export const RECENT_AUTH_HEADER = 'X-Recent-Auth-Token';

export const deletionApi = {
  /** Mint a short-lived recent-auth token (password, Apple or Google re-auth proof). */
  issueRecentAuthToken: (proof: RecentAuthProof) =>
    api.post<{ token: string; expires_in_ms: number }>('/auth/recent-auth-token', proof, {
      skipAuthRefresh: true,
    } as RetryableConfig),

  /**
   * Schedule deletion now (grace period starts immediately). Requires the
   * recent-auth token. Apple users pass the authorization code from the
   * re-auth sheet so the server can revoke their Sign in with Apple tokens.
   */
  requestDeletion: (recentAuthToken: string, appleAuthorizationCode?: string | null) =>
    api.post<DeletionScheduledResponse>(
      '/me/delete-account',
      appleAuthorizationCode ? { apple_authorization_code: appleAuthorizationCode } : {},
      { headers: { [RECENT_AUTH_HEADER]: recentAuthToken } },
    ),

  /** Get current deletion state (none | requested | confirmed | deleted). */
  getDeletionStatus: () =>
    api.get<DeletionStatus>('/me/delete-account/status'),

  /** Cancel a pending deletion within the grace period. */
  cancelDeletion: () =>
    api.post<{ message: string }>('/me/delete-account/cancel'),
};
