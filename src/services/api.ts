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
import { logger } from '../utils/logger';

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

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000, // 30sec — Fly.io free tier cold start can take up to 25sec
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request automatically.
// Security: token now comes from SecureStore (iOS Keychain / Android Keystore)
// via the secureStorage adapter, not plain AsyncStorage.
api.interceptors.request.use(async (config) => {
  const token = await secureStorage.getItem('supabase_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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
};

async function performRefresh(): Promise<string> {
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
  if (refreshError || !data.session) {
    throw refreshError || new Error('Refresh returned no session');
  }
  await secureStorage.setItem('supabase_token', data.session.access_token);
  await secureStorage.setItem('supabase_refresh_token', data.session.refresh_token);
  // Bump only on success — failures must not advance the cycle, otherwise a
  // stale request would think the next cycle's token is in play and ask for
  // a third refresh.
  currentCycleId += 1;
  return data.session.access_token;
}

async function handleRefreshFailure(): Promise<void> {
  // Fire exactly once per refresh-failure cascade. The flag is reset in the
  // refreshPromise.finally() chain so a subsequent successful login → 401
  // cycle still works without depending on a wall-clock timer.
  if (loggedOutOnce) return;
  loggedOutOnce = true;
  // Full sign-out on refresh failure: clears all auth keys (both stores),
  // resets analytics/Sentry, and emits logout. Lazy import avoids a require
  // cycle between api.ts and authActions.ts (authActions imports profileApi
  // from this file). The `__testSignOut` seam exists only so unit tests can
  // sidestep the dynamic import — production goes through `await import(...)`.
  try {
    const signOut = __testSignOut
      ? __testSignOut
      : (await import('./authActions')).signOut;
    await signOut();
  } catch (err) {
    logger.error('API', 'signOut on refresh failure threw', err);
    authEvents.emit('logout');
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalConfig = error.config as RetryableConfig | undefined;

    // Network error — no response from server (cold start, no wifi, etc.).
    // Do NOT log the user out; just surface a friendly message.
    if (!error.response) {
      error.message = 'Cannot reach server. Please check your connection and try again.';
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

    if (error.response.status !== 401 || !originalConfig) {
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

    // If a refresh is already in flight, await it. Otherwise start one. The
    // promise is shared across all concurrent 401s so N parallel requests
    // produce a single refresh call per cycle.
    if (!refreshPromise) {
      refreshPromise = performRefresh()
        .catch(async (err) => {
          await handleRefreshFailure();
          throw err;
        })
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
      originalConfig._refreshAttempts = attempts + 1;
      originalConfig._lastUsedCycleId = currentCycleId;
      originalConfig.headers = originalConfig.headers || {};
      (originalConfig.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
      return api.request(originalConfig);
    } catch (refreshErr) {
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
let __testSignOut: (() => Promise<void>) | null = null;

export function __setRefreshSessionForTests(fn: RefreshSessionFn | null): void {
  __testRefreshSession = fn;
}
export function __setSignOutForTests(fn: (() => Promise<void>) | null): void {
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

export const authApi = {
  register: (data: { email: string; password: string; name: string; phone?: string; invite_code?: string }) =>
    api.post('/auth/register', data),
  signupWithCode: (data: { email: string; password: string; name: string; phone?: string; invite_code: string }) =>
    api.post('/auth/signup-with-code', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  googleAuth: (token: string, inviteCode?: string) =>
    api.post('/auth/google', inviteCode ? { token, invite_code: inviteCode } : { token }),
  // Apple Sign-In: POST the identity token from expo-apple-authentication.
  // Backend verifies the JWT against Apple's JWKS and returns the same
  // session shape as /auth/google.
  appleAuth: (
    identityToken: string,
    extras: {
      authorizationCode?: string;
      email?: string;
      fullName?: { given_name?: string; family_name?: string };
      inviteCode?: string;
    } = {},
  ) =>
    api.post('/auth/apple', {
      identity_token: identityToken,
      authorization_code: extras.authorizationCode,
      email: extras.email,
      full_name: extras.fullName,
      invite_code: extras.inviteCode,
    }),
    attachInviteCode: (code: string) =>
    api.post('/auth/attach-invite-code', { invite_code: code }),
  selectRole: (role: 'coach' | 'student', coachCode?: string) =>
    api.post('/auth/select-role', { role, coach_code: coachCode }),
  me: () =>
    api.get('/auth/me'),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  validateInviteCode: (code: string) =>
    api.post<InvitePreview>('/auth/validate-invite-code', { code }),
  // Public preview — read-only, no PII; surfaces coach branding before signup.
  getInvitePreview: (code: string) =>
    api.get<InvitePreview>(`/invite/${encodeURIComponent(code)}/preview`),
  // Backend feature flag: when true, codeless client signup is rejected.
  // Mobile checks this on the signup screen so the UX matches policy.
  getSignupPolicy: () =>
    api.get<{ require_invite_code: boolean; google_signin_enabled: boolean }>(
      '/auth/signup-policy',
    ),
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
    // Trainerize-floor: also persist the human-readable quantity + unit the
    // user picked so coaches can see "6 oz" instead of "quantity_multiplier:
    // 1.7008". Backend stores these on LoggedFoodEntry.
    original_quantity?: number;
    original_unit?: string;
    notes?: string;
    // Idempotency key from the offline queue so a flush retry doesn't create
    // a duplicate LoggedFoodEntry. Optional — direct (non-queued) logs omit it.
    client_uuid?: string;
  }) => api.post('/log/food', data),
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
  getClients: (status?: 'active' | 'archived' | 'all') =>
    api.get('/coach/clients' + (status ? `?status=${status}` : '')),
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
  // first. 404 from the endpoint means the backend hasn't shipped the
  // route yet — the screen renders an honest "not available" state rather
  // than a fabricated list.
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
  send: (body: string) => api.post('/messages', { body }),
  markRead: () => api.post('/messages/read'),
  unreadCount: () => api.get('/messages/unread-count'),
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
    /** B10: 1–5 self-reported sleep quality (separate from sleep_hours). */
    sleep_quality?: number | null;
    /** B10: 1–5 self-reported stress level. */
    stress?: number | null;
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
  create: (data: Record<string, unknown>) => api.post('/recipes', data),
  save: (id: string) => api.post(`/recipes/${id}/save`),
  unsave: (id: string) => api.delete(`/recipes/${id}/save`),
};

// F13 — Grocery & Shopping Lists
export const listsApi = {
  getList: (type: 'grocery' | 'shopping') => api.get(`/lists/${type}`),
  addItem: (type: 'grocery' | 'shopping', data: { name: string; quantity?: number; unit?: string; source_recipe_id?: string }) =>
    api.post(`/lists/${type}`, data),
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

export const coachBillingApi = {
  getStatus: () => api.get<CoachBillingStatus>('/coach/billing/status'),
  // Full billing payload incl. last 24 invoices. The mobile billing screen
  // uses this so a coach can pull up invoice PDFs without leaving the app.
  getFull: () => api.get<CoachBillingFull>('/v1/coach/me/billing'),
  // POST returns { url } — a one-time Stripe billing portal URL. The app
  // opens it in a browser sheet; the portal handles checkout / card update /
  // cancel. The endpoint accepts an optional return path so the portal can
  // bounce the coach back to the right deep link when they finish.
  createPortalSession: (returnPath?: string) =>
    api.post<{ url: string }>(
      '/coach/billing/portal-session',
      returnPath ? { return_path: returnPath } : {},
    ),
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

// ── Phase 10 — GDPR right to erasure ────────────────────────────────────────
// These endpoints drive the two-phase deletion flow introduced in
// src/account-deletion/. Separate from the legacy usersApi.deleteAccount
// and usersApi.cancelAccountDeletion which were the earlier 30-day soft-
// delete stubs. Both sets co-exist; the new flow is the canonical one.

export interface DeletionStatus {
  state: 'none' | 'requested' | 'confirmed' | 'deleted';
  requested_at?: string | null;
  confirmed_at?: string | null;
  grace_days?: number | null;
  purge_after?: string | null;
  deleted_at?: string | null;
}

export const deletionApi = {
  /** Request deletion — sends a confirmation email with a single-use 24h link. */
  requestDeletion: () =>
    api.post<{ message: string; expires_at: string }>('/me/delete-account'),

  /** Get current deletion state (none | requested | confirmed | deleted). */
  getDeletionStatus: () =>
    api.get<DeletionStatus>('/me/delete-account/status'),

  /** Cancel a pending deletion within the 14-day grace period. */
  cancelDeletion: () =>
    api.post<{ message: string }>('/me/delete-account/cancel'),
};
