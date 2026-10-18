import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { ClientsStackParamList } from '../../../navigation/CoachNavigator';
import type { IoniconName } from '../../../types/common';

// ── Types ────────────────────────────────────────────────────────────────────
export interface SessionSet {
  reps: number;
  weight: number;
  completed: boolean;
}

export interface SessionExercise {
  exerciseId: string;
  exerciseName: string;
  name?: string;
  sets: SessionSet[];
  /** The client's note on this exercise ('' when none). */
  notes?: string;
}

export interface WorkoutSession {
  id: string;
  routineName: string;
  startTime: string;
  endTime?: string;
  completed: boolean;
  exercises: string; // JSON array of SessionExercise
  /** The client's note on the whole workout ('' when none). */
  notes?: string;
  /** Minutes the client trained; null when not recorded. */
  durationMinutes?: number | null;
}

export interface WeekSummary {
  weekStart: string;    // ISO date string (Monday)
  weekEnd: string;      // ISO date string (Sunday)
  weekLabel: string;    // e.g. "Mar 24 – Mar 30"
  totalCalories: number;
  totalProtein: number;
  totalWeightMoved: number;
  latestWeight: number | null;
  workoutCount: number;
}

export type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'ClientDetail'>;
  route: RouteProp<ClientsStackParamList, 'ClientDetail'>;
};

export type TabKey =
  // K1-OVERVIEW: This week, the Style C file's first tab (featureFlags.coachTabsV2).
  | 'week'
  | 'summary'
  | 'logs'
  | 'progress'
  | 'healthFitness'
  | 'workouts'
  | 'timeline'
  | 'weekly'
  // PR-HK-3b — coach Sleep & Recovery tab (added after 'healthFitness' from HK-3a).
  | 'sleepRecovery';

export interface TimelineEvent {
  id: string;
  type: 'food' | 'weight' | 'workout' | 'fasting' | 'checkin';
  title: string;
  subtitle: string;
  date: string;
  icon: IoniconName;
  iconColor: string;
  /** Check-in rows only: what the coach needs to mark it reviewed. */
  checkIn?: { id: string; coachId: string | null; reviewed: boolean };
}

export interface CoachMealEntry {
  id: string;
  foodName: string;
  mealType: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
  originalQuantity?: number;
  originalUnit?: string;
}
