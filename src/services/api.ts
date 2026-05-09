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
//      kicks off; this is unavoidable without deeper request-token tracking
//      and is acceptable: worst case is two refreshes over a few seconds.
// ============================================================================

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authEvents } from '../utils/authEvents';
import { secureStorage } from './secureStorage';
import { env } from '../config/env';

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
// fleet of concurrent 401s produces one sign-out, not N.
let refreshPromise: Promise<string> | null = null;
let loggedOutOnce = false;

async function performRefresh(): Promise<string> {
  const refreshToken = await AsyncStorage.getItem('supabase_refresh_token');
  if (!refreshToken) throw new Error('No refresh token');

  // Dynamic import keeps the supabase-js bundle out of the cold-start path for
  // apps that never hit a 401.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error: refreshError } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (refreshError || !data.session) {
    throw refreshError || new Error('Refresh returned no session');
  }
  await AsyncStorage.setItem('supabase_token', data.session.access_token);
  await AsyncStorage.setItem('supabase_refresh_token', data.session.refresh_token);
  return data.session.access_token;
}

async function handleRefreshFailure(): Promise<void> {
  // Fire exactly once per refresh-failure cascade. The flag is reset after
  // emission so a subsequent successful login → 401 cycle still works.
  if (loggedOutOnce) return;
  loggedOutOnce = true;
  try {
    // Clear token but KEEP user_data / onboarding_complete — matches the
    // behavior introduced in security/critical-fixes-round-1 (commit 4816d54).
    await AsyncStorage.removeItem('supabase_token');
    await AsyncStorage.removeItem('needs_role_selection');
  } catch (err) {
    console.error('api: failed to clear tokens on logout', err);
  }
  authEvents.emit('logout');
  // Reset the one-shot guard after the emit so we don't permanently suppress
  // future logouts. The next refresh attempt starts fresh.
  setTimeout(() => {
    loggedOutOnce = false;
  }, 1000);
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalConfig = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

    // Network error — no response from server (cold start, no wifi, etc.).
    // Do NOT log the user out; just surface a friendly message.
    if (!error.response) {
      error.message = 'Cannot reach server. Please check your connection and try again.';
      return Promise.reject(error);
    }

    // Only 401s trigger refresh. `_retry` guards against an infinite loop if
    // the retried request also returns 401 (server-side token rejection).
    if (error.response.status !== 401 || !originalConfig || originalConfig._retry) {
      return Promise.reject(error);
    }
    originalConfig._retry = true;

    // If a refresh is already in flight, await it. Otherwise start one.
    if (!refreshPromise) {
      refreshPromise = performRefresh()
        .catch(async (err) => {
          await handleRefreshFailure();
          throw err;
        })
        .finally(() => {
          // Clear the promise so the next 401 burst (e.g. after re-login) can
          // trigger a fresh refresh instead of reusing a resolved one.
          refreshPromise = null;
        });
    }

    try {
      const newToken = await refreshPromise;
      originalConfig.headers = originalConfig.headers || {};
      (originalConfig.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
      return api.request(originalConfig);
    } catch (refreshErr) {
      return Promise.reject(refreshErr);
    }
  },
);

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
    notes?: string;
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
  // ── Invite codes ──
  listInviteCodes: () => api.get('/coach/invite-codes'),
  createInviteCode: (data: { expires_at?: string | null; max_uses?: number | null }) =>
    api.post('/coach/invite-codes', data),
  revokeInviteCode: (id: string) =>
    api.delete(`/coach/invite-codes/${id}`),
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
    api.put('/notifications/preferences', data),
};

export const communityApi = {
  getFeed: () => api.get('/community/feed'),
  postWin: (data: { title: string; description: string; visibility?: 'circle' | 'public' }) =>
    api.post('/community/wins', data),
  reactToWin: (winId: string, kind: 'fire' | 'clap') =>
    api.post(`/community/wins/${winId}/react`, { kind }),
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

export const coachBillingApi = {
  getStatus: () => api.get<CoachBillingStatus>('/coach/billing/status'),
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
