// The Growth Project — API Client
// All backend communication flows through here.
// The Perplexity API key lives ONLY on the backend — never in this file.

import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authEvents } from '../utils/authEvents';

// Hardcoded — EXPO_PUBLIC_ env vars require the .env to be present on the build machine.
// Hardcoding is safer for EAS cloud builds.
const API_BASE = 'https://backend-spring-lake-3890.fly.dev/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000, // 30sec — Fly.io free tier cold start can take up to 25sec
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request automatically
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('supabase_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Global error handler
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired — clear ALL auth keys and emit logout
      await Promise.all([
        AsyncStorage.removeItem('supabase_token'),
        AsyncStorage.removeItem('user_data'),
        AsyncStorage.removeItem('needs_role_selection'),
        AsyncStorage.removeItem('onboarding_complete'),
      ]);
      authEvents.emit('logout');
    }
    if (!error.response) {
      // Network error — no response from server
      error.message = 'Cannot reach server. Please check your connection and try again.';
    }
    return Promise.reject(error);
  },
);

export default api;

// ============================================================
// TYPED API FUNCTIONS
// ============================================================

export const authApi = {
  register: (data: { email: string; password: string; name: string; phone?: string }) =>
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
  postGuidelines: (clientId: string, guidelines: string) =>
    api.post(`/coach/guidelines/${clientId}`, { guidelines }),
  getAlerts: () => api.get('/coach/alerts'),
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
