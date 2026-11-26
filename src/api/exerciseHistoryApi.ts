/**
 * WORKOUT-DETAIL-M: the client's own history of one exercise, over all their workouts (TRAIN-BE2,
 * GET /workouts/exercise-history; growth-project-backend workout.service.ts getExerciseHistory). The server reads
 * only the caller's own sets. Sessions come newest first (at most 100); best and first read all history; a date is
 * the workout's calendar day (YYYY-MM-DD). The answer carries no unit, so a timed set's seconds arrive as reps.
 *
 * The phone sends the exercise's name only: it never logs a catalog id on a set, so every set it saved matches by
 * name (case-insensitive, exact). One read per page open and per Retry of the page; nothing is kept after it.
 */
import api from '../services/api';

export interface TopSet {
  weight_lbs: number;
  reps: number;
}
export interface HistoryPoint {
  date: string;
  top_set: TopSet | null;
}
export interface CoachComment {
  coach_name: string;
  body: string;
}
export interface HistorySession {
  workout_id: string;
  date: string;
  sets: number;
  reps_per_set: number[];
  weight_per_set_lbs: number[];
  rpe: number | null;
  top_set: TopSet | null;
  est_1rm_lbs: number | null;
  volume_lbs: number;
  coach_comments: CoachComment[];
}
export interface ExerciseHistory {
  best: HistoryPoint | null;
  first: HistoryPoint | null;
  sessions: HistorySession[];
}

export const exerciseHistoryApi = {
  get: async (name: string): Promise<ExerciseHistory> => {
    const wanted = (name ?? '').trim();
    if (!wanted) throw new Error('exercise history: no name');
    const res = await api.get<ExerciseHistory>(`/workouts/exercise-history?name=${encodeURIComponent(wanted)}`);
    const data = res?.data;
    if (!data || !Array.isArray(data.sessions)) throw new Error('exercise history: unexpected answer');
    return data;
  },
};
