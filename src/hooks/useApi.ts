// Centralized React Query hooks for every backend-backed feature.
//
// Why this file exists (Fix #2):
//
// Before this migration, screens called functions in src/db/*.ts that read and
// wrote local SQLite directly. The same logical entity ("my habits today",
// "the team leaderboard", "my recent workouts") existed in two places — the
// device DB and the server DB — and could drift. Coaches couldn't see what
// clients did on most screens, and a phone reset wiped history that should
// have been on the server.
//
// Every screen migrated under Fix #2 reads through one of these hooks. The
// hooks are thin wrappers around the existing api.ts surface so the network
// transport (auth headers, refresh-token mutex, retry policy) keeps living
// in one place — see src/services/api.ts. React Query owns the cache,
// background revalidation, and mutation invalidation.
//
// Query key conventions:
//   ['feature', 'sub-collection', ...params]
// Mutations invalidate the broadest reasonable prefix — e.g. logging a
// habit invalidates ['habits'] so both the list and the streak refetch.

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';
import {
  habitsApi,
  workoutApi,
  communityApi,
  nudgesApi,
  notificationsApi,
  weightApi,
  logApi,
  checkInsApi,
  coachApi,
  mealPlansApi,
  messagesApi,
} from '../services/api';
import { bucketDateLocal } from '../utils/date';

// ─────────────────────────────────────────────────────────────────────────────
// Habits
// ─────────────────────────────────────────────────────────────────────────────

export type ApiHabit = {
  id: string;
  user_id: string;
  name: string;
  emoji?: string | null;
  category?: string | null;
  target_per_week?: number | null;
  created_at: string;
};

export type ApiHabitLog = {
  id: string;
  habit_id: string;
  user_id: string;
  date: string;
  completed: boolean;
};

export function useHabits(opts?: UseQueryOptions<ApiHabit[]>) {
  return useQuery<ApiHabit[]>({
    queryKey: ['habits', 'list'],
    queryFn: async () => (await habitsApi.getAll()).data,
    ...opts,
  });
}

export function useHabitLogs(date: string, opts?: UseQueryOptions<ApiHabitLog[]>) {
  return useQuery<ApiHabitLog[]>({
    queryKey: ['habits', 'logs', date],
    queryFn: async () => (await habitsApi.getLogs(date)).data,
    enabled: !!date,
    ...opts,
  });
}

export function useCreateHabit() {
  const qc = useQueryClient();
  return useMutation({
    // Backend tolerates extra fields (icon/color/unit/target_value/frequency) that
    // the legacy HabitsScreen modal already collected. Accept Record so callers
    // don't have to be artificially narrow.
    mutationFn: (data: Record<string, unknown>) => habitsApi.create(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
    },
  });
}

export function useLogHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; date: string; completed: boolean; value?: number }) => {
      const { id, ...payload } = args;
      return habitsApi.logHabit(id, payload).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
    },
  });
}

export function useDeleteHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => habitsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Community  (real CommunityWin feed, post Fix #9 backend work)
// ─────────────────────────────────────────────────────────────────────────────

export type ApiCommunityWin = {
  id: string;
  user_id: string;
  coach_id: string | null;
  title: string;
  description: string;
  created_at: string;
  user?: { id: string; name: string };
  // Anonymised feed shape returned by backend
  displayName?: string;
  action?: string;
  createdAt?: string;
  reactions?: { fire: number; clap: number };
};

export function useCommunityFeed() {
  return useQuery<ApiCommunityWin[]>({
    queryKey: ['community', 'feed'],
    queryFn: async () => (await communityApi.getFeed()).data,
  });
}

export function usePostWin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; description: string; visibility?: 'circle' | 'public' }) =>
      communityApi.postWin(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['community', 'feed'] });
    },
  });
}


export type ApiMilestone = {
  slug: string;
  label: string;
  reachedAt: string | null;
  description: string;
};

// Backend has removed GET /users/me/badges. Until a milestones endpoint
// replaces it, this hook returns an empty array so consumers render a
// clean slate instead of pinging a 410 route.
export function useMilestones(opts?: UseQueryOptions<ApiMilestone[]>) {
  return useQuery<ApiMilestone[]>({
    queryKey: ['milestones', 'list'],
    queryFn: async () => [] as ApiMilestone[],
    ...opts,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications  (coach nudges = the in-app notifications surface)
// ─────────────────────────────────────────────────────────────────────────────

export type ApiNudge = {
  id: string;
  coach_id: string;
  client_id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export function useNudges(limit = 50) {
  return useQuery<ApiNudge[]>({
    queryKey: ['nudges', 'list', limit],
    queryFn: async () => (await nudgesApi.list({ limit })).data,
  });
}

export function useUnreadNudgeCount() {
  return useQuery<{ count: number }>({
    queryKey: ['nudges', 'unread-count'],
    queryFn: async () => (await nudgesApi.unreadCount()).data,
    // Cheap call; refetch a bit more aggressively so the badge stays current.
    staleTime: 15_000,
  });
}

export function useUnreadMessagesCount() {
  return useQuery<{ total: number }>({
    queryKey: ['messages', 'unread-count'],
    queryFn: async () => (await messagesApi.unreadCount()).data,
    staleTime: 15_000,
    // Refetch every 30s while the home screen is mounted so the badge stays
    // current even without pull-to-refresh.
    refetchInterval: 30_000,
  });
}

export function useMarkNudgeRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => nudgesApi.markRead(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nudges'] });
    },
  });
}

export function useNotificationPreferences() {
  return useQuery<Record<string, unknown>>({
    queryKey: ['notifications', 'preferences'],
    queryFn: async () => (await notificationsApi.getPreferences()).data,
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => notificationsApi.updatePreferences(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Workouts + Routines
// ─────────────────────────────────────────────────────────────────────────────

export type ApiWorkoutSession = {
  id: string;
  user_id: string;
  date: string;
  notes?: string | null;
  duration_min?: number | null;
  exercises: ApiWorkoutExercise[];
  created_at: string;
};

export type ApiWorkoutExercise = {
  id: string;
  exercise_name: string;
  sets?: number | null;
  reps?: number | null;
  weight_lbs?: number | null;
  notes?: string | null;
};

export type ApiRoutine = {
  id: string;
  creator_id: string;
  name: string;
  description?: string | null;
  exercises: Array<{ exercise_name: string; sets: number; reps: number }>;
  created_at: string;
};

export function useWorkouts(limit = 10) {
  return useQuery<ApiWorkoutSession[]>({
    queryKey: ['workouts', 'list', limit],
    queryFn: async () => (await workoutApi.getAll(limit)).data,
  });
}

export function useWorkoutVolume(period: 'week' | 'month') {
  return useQuery<{ total_volume_lbs: number; sessions: number }>({
    queryKey: ['workouts', 'volume', period],
    queryFn: async () => (await workoutApi.getVolume(period)).data,
  });
}

// Daily volume breakdown for a week. Backend `workoutApi.getVolume('week')`
// returns the lump-sum total only, so we fetch recent sessions and aggregate
// per-day on the client. This is bounded by `limit` (default 50) which more
// than covers a typical week of training. The result is keyed off the
// week-start ISO date so it auto-rotates each Monday.
export function useWeeklyVolumeBreakdown(weekStart: string, weekEnd: string, limit = 50) {
  return useQuery<{ total: number; breakdown: Array<{ date: string; volume: number }> }>({
    queryKey: ['workouts', 'weekly-breakdown', weekStart, weekEnd, limit],
    queryFn: async () => {
      const res = await workoutApi.getAll(limit);
      type Session = { date?: string; created_at?: string; exercises?: { sets?: number | string; reps?: number | string; weight_lbs?: number | string }[] };
      const data = res.data as { workouts?: Session[] } | Session[] | undefined;
      const sessions: Session[] = Array.isArray(data) ? data : (data?.workouts ?? []);
      const start = new Date(weekStart).getTime();
      const end = new Date(weekEnd).getTime();
      const inRange = sessions.filter((s) => {
        const stamp = s.date || s.created_at || '';
        const t = stamp ? new Date(stamp).getTime() : NaN;
        return t >= start && t <= end;
      });
      const totals: Record<string, number> = {};
      let total = 0;
      for (const s of inRange) {
        const stamp = s.date || s.created_at || '';
        // A bare YYYY-MM-DD is already a calendar day — feeding it through
        // `new Date()` parses as UTC midnight and would shift west-of-UTC
        // users back a day. Only call `bucketDateLocal` on real timestamps.
        const day = /^\d{4}-\d{2}-\d{2}$/.test(stamp)
          ? stamp
          : bucketDateLocal(new Date(stamp));
        let sessionVol = 0;
        for (const ex of (s.exercises || [])) {
          const sets = Number(ex.sets || 0);
          const reps = Number(ex.reps || 0);
          const w = Number(ex.weight_lbs || 0);
          sessionVol += sets * reps * w;
        }
        totals[day] = (totals[day] || 0) + sessionVol;
        total += sessionVol;
      }
      const breakdown = Object.entries(totals).map(([date, volume]) => ({ date, volume }));
      return { total, breakdown };
    },
    enabled: !!weekStart && !!weekEnd,
  });
}

export function useCreateWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => workoutApi.create(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workouts'] });
    },
  });
}

export function useRoutines() {
  return useQuery<ApiRoutine[]>({
    queryKey: ['routines', 'list'],
    queryFn: async () => (await workoutApi.getRoutines()).data,
  });
}

export function useCreateRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => workoutApi.createRoutine(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
    },
  });
}

export function useUpdateRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; data: Record<string, unknown> }) =>
      workoutApi.updateRoutine(args.id, args.data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
    },
  });
}

export function useDeleteRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workoutApi.deleteRoutine(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Home-screen aggregates
// ─────────────────────────────────────────────────────────────────────────────

export function useTodayLog(date: string) {
  return useQuery<unknown>({
    queryKey: ['food', 'log', date],
    queryFn: async () => (await logApi.getDaily(date)).data,
    enabled: !!date,
  });
}

export function useWeightHistory(days = 30) {
  return useQuery<unknown[]>({
    queryKey: ['weight', 'history', days],
    queryFn: async () => (await weightApi.getHistory(days)).data,
  });
}

// Today's check-in is fetched as a single-row range scan against the list
// endpoint. checkInsApi.save is an idempotent upsert by (user, date) so callers
// can post freely on top of whatever this returns.
export function useTodayCheckIn(date: string) {
  return useQuery<unknown>({
    queryKey: ['check-ins', 'day', date],
    queryFn: async () => {
      const list = (await checkInsApi.list({ from: date, to: date, limit: 1 })).data as unknown[];
      return list[0] ?? null;
    },
    enabled: !!date,
  });
}

export function useSaveCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      date: string;
      mood?: number | null;
      energy?: number | null;
      sleep_hours?: number | null;
      sleep_quality?: number | null;
      stress?: number | null;
      weight_kg?: number | null;
      notes?: string | null;
    }) => checkInsApi.save(data).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['check-ins', 'day', vars.date] });
      qc.invalidateQueries({ queryKey: ['check-ins'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Coach surfaces (ProgramTemplatesScreen)
// ─────────────────────────────────────────────────────────────────────────────

export function useCoachClients() {
  return useQuery<unknown[]>({
    queryKey: ['coach', 'clients'],
    queryFn: async () => (await coachApi.getClients()).data,
  });
}

export function useClientGuidelines(clientId: string | null | undefined) {
  return useQuery<unknown>({
    queryKey: ['coach', 'guidelines', clientId],
    queryFn: async () => (await coachApi.getGuidelines(clientId!)).data,
    enabled: !!clientId,
  });
}

export function usePostClientGuidelines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { clientId: string; guidelines: string }) =>
      coachApi.postGuidelines(args.clientId, args.guidelines).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['coach', 'guidelines', vars.clientId] });
    },
  });
}

// mealPlansApi.list returns the meal plans visible to the current user. For a
// coach this is everything they authored; for a client this is everything
// assigned to them. Filter by client_id in callers when a coach picks a roster
// member.
export function useMealPlans() {
  return useQuery<unknown[]>({
    queryKey: ['meal-plans', 'list'],
    queryFn: async () => (await mealPlansApi.list()).data,
  });
}
