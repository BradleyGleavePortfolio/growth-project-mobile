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

// Supabase project constants — duplicated in googleAuth.ts (tracked as audit Q2).
// Not inlined at call time anymore to avoid reconstructing the client per 401.
const SUPABASE_URL = 'https://rpyfdsgxxltzutgqeouk.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJweWZkc2d4eGx0enV0Z3Flb3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MjE2OTAsImV4cCI6MjA4OTA5NzY5MH0.cH-yapSxmjdHgMlJiYEt6-uGzMTArgIs9tPVs29lUF0';

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

export const authApi = {
  register: (data: { email: string; password: string; name: string; phone?: string; invite_code?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  googleAuth: (token: string) =>
    api.post('/auth/google', { token }),
  selectRole: (role: 'coach' | 'student', coachCode?: string) =>
    api.post('/auth/select-role', { role, coach_code: coachCode }),
  me: () =>
    api.get('/auth/me'),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  validateInviteCode: (code: string) =>
    api.post('/auth/validate-invite-code', { code }),
};

export const profileApi = {
  get: () => api.get('/profile'),
  update: (data: Record<string, any>) => api.put('/profile', data),
};

export const foodApi = {
  search: (q: string, limit = 20) =>
    api.get(`/foods/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  getById: (id: string) =>
    api.get(`/foods/${id}`),
  create: (data: Record<string, any>) =>
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
  updateEntry: (id: string, data: Record<string, any>) =>
    api.put(`/log/food/${id}`, data),
  deleteEntry: (id: string) =>
    api.delete(`/log/food/${id}`),
  getWeekly: (weekStart: string) =>
    api.get(`/log/weekly?week_start=${weekStart}`),
};

export const aiApi = {
  chat: (message: string, history: Array<{ role: string; content: string }>) =>
    api.post('/ai/chat', { message, conversation_history: history }),
  getContext: () =>
    api.get('/ai/context'),
};

export const workoutApi = {
  create: (data: Record<string, any>) =>
    api.post('/workouts', data),
  getAll: (limit = 10) =>
    api.get(`/workouts?limit=${limit}`),
  getVolume: (period: 'week' | 'month') =>
    api.get(`/workouts/volume?period=${period}`),
  getRoutines: () =>
    api.get('/routines'),
  createRoutine: (data: Record<string, any>) =>
    api.post('/routines', data),
  updateRoutine: (id: string, data: Record<string, any>) =>
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
  create: (data: Record<string, any>) => api.post('/habits', data),
  logHabit: (id: string, data: Record<string, any>) =>
    api.post(`/habits/${id}/log`, data),
  getLogs: (date: string) =>
    api.get(`/habits/logs?date=${date}`),
  getStreaks: () => api.get('/habits/streaks'),
};

export const coachApi = {
  getClients: () => api.get('/coach/clients'),
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

export const notificationsApi = {
  getPreferences: () => api.get('/notifications/preferences'),
  updatePreferences: (data: Record<string, any>) =>
    api.put('/notifications/preferences', data),
};

export const communityApi = {
  getLeaderboard: (period: 'week' | 'month' = 'week') =>
    api.get(`/community/leaderboard?period=${period}`),
  getFeed: () => api.get('/community/feed'),
  postWin: (data: { title: string; description: string }) =>
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
  create: (data: Record<string, any>) => api.post('/lessons', data),
  update: (id: string, data: Record<string, any>) => api.put(`/lessons/${id}`, data),
  complete: (id: string) => api.post(`/lessons/${id}/complete`),
  getRecommended: () => api.get('/lessons/recommended'),
};
