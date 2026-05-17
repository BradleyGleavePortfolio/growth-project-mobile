import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { ClientsStackParamList } from '../../../navigation/CoachNavigator';
import type { JsonRecord, IoniconName } from '../../../types/common';

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
}

export interface WorkoutSession {
  id: string;
  routineName: string;
  startTime: string;
  endTime?: string;
  completed: boolean;
  exercises: string; // JSON array of SessionExercise
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

export type TabKey = 'summary' | 'logs' | 'mealplan' | 'progress' | 'workouts' | 'timeline' | 'weekly';

// ── Coach-side meal plans (server) ──
export interface CoachMealPlanItem {
  name: string;
  calories?: number | null;
  protein?: number | null;
  notes?: string | null;
  time_of_day?: string | null;
}

export interface CoachMealPlan {
  id: string;
  title: string;
  notes?: string | null;
  items: CoachMealPlanItem[];
  created_at?: string | null;
}

export interface PlanItemDraft {
  name: string;
  calories: string;
  protein: string;
  notes: string;
  time_of_day: string;
}

export function emptyItemDraft(): PlanItemDraft {
  return { name: '', calories: '', protein: '', notes: '', time_of_day: 'breakfast' };
}

export function normaliseServerPlans(payload: unknown): CoachMealPlan[] {
  const root = (payload && typeof payload === 'object') ? (payload as JsonRecord) : null;
  const raw: JsonRecord[] = Array.isArray(payload)
    ? (payload as JsonRecord[])
    : Array.isArray(root?.plans)
      ? (root.plans as JsonRecord[])
      : Array.isArray(root?.meal_plans)
        ? (root.meal_plans as JsonRecord[])
        : [];
  return raw.map((p) => {
    const items = Array.isArray(p.items)
      ? (p.items as JsonRecord[])
      : Array.isArray(p.meal_items)
        ? (p.meal_items as JsonRecord[])
        : [];
    return {
      id: String(p.id),
      title: typeof p.title === 'string' && p.title ? p.title : 'Meal plan',
      notes: (p.notes as string | null | undefined) ?? null,
      items: items.map((it) => ({
        name: typeof it.name === 'string' ? it.name : '',
        calories: (it.calories as number | null | undefined) ?? (it.kcal as number | null | undefined) ?? null,
        protein: (it.protein as number | null | undefined) ?? (it.protein_g as number | null | undefined) ?? null,
        notes: (it.notes as string | null | undefined) ?? null,
        time_of_day: (it.time_of_day as string | null | undefined) ?? (it.timeOfDay as string | null | undefined) ?? null,
      })),
      created_at: (p.created_at as string | null | undefined) ?? (p.createdAt as string | null | undefined) ?? null,
    };
  });
}

export interface TimelineEvent {
  id: string;
  type: 'food' | 'weight' | 'workout' | 'fasting' | 'checkin';
  title: string;
  subtitle: string;
  date: string;
  icon: IoniconName;
  iconColor: string;
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
