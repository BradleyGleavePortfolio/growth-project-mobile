import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ClientsStackParamList } from '../../navigation/CoachNavigator';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { coachApi } from '../../services/api';
import { Colors } from '../../constants/colors';
import { ClientProfile, FoodLog, WeightLog } from '../../types';
import { getTodayString } from '../../utils/date';

// ── Types ────────────────────────────────────────────────────────────────────
interface SessionSet {
  reps: number;
  weight: number;
  completed: boolean;
}

interface SessionExercise {
  exerciseId: string;
  exerciseName: string;
  name?: string;
  sets: SessionSet[];
}

interface WorkoutSession {
  id: string;
  routineName: string;
  startTime: string;
  endTime?: string;
  completed: boolean;
  exercises: string; // JSON array of SessionExercise
}

interface WeekSummary {
  weekStart: string;    // ISO date string (Monday)
  weekEnd: string;      // ISO date string (Sunday)
  weekLabel: string;    // e.g. "Mar 24 – Mar 30"
  totalCalories: number;
  totalProtein: number;
  totalWeightMoved: number;
  latestWeight: number | null;
  workoutCount: number;
}

type Props = {
  navigation: NativeStackNavigationProp<ClientsStackParamList, 'ClientDetail'>;
  route: RouteProp<ClientsStackParamList, 'ClientDetail'>;
};

type TabKey = 'summary' | 'logs' | 'mealplan' | 'progress' | 'workouts' | 'timeline' | 'weekly';

// ── Coach-side meal plans (server) ──
interface CoachMealPlanItem {
  name: string;
  calories?: number | null;
  protein?: number | null;
  notes?: string | null;
  time_of_day?: string | null;
}

interface CoachMealPlan {
  id: string;
  title: string;
  notes?: string | null;
  items: CoachMealPlanItem[];
  created_at?: string | null;
}

interface PlanItemDraft {
  name: string;
  calories: string;
  protein: string;
  notes: string;
  time_of_day: string;
}

function emptyItemDraft(): PlanItemDraft {
  return { name: '', calories: '', protein: '', notes: '', time_of_day: 'breakfast' };
}

function normaliseServerPlans(payload: any): CoachMealPlan[] {
  const raw: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.plans)
      ? payload.plans
      : Array.isArray(payload?.meal_plans)
        ? payload.meal_plans
        : [];
  return raw.map((p) => ({
    id: String(p.id),
    title: p.title || 'Meal plan',
    notes: p.notes ?? null,
    items: (Array.isArray(p.items) ? p.items : Array.isArray(p.meal_items) ? p.meal_items : []).map(
      (it: any) => ({
        name: it.name || '',
        calories: it.calories ?? it.kcal ?? null,
        protein: it.protein ?? it.protein_g ?? null,
        notes: it.notes ?? null,
        time_of_day: it.time_of_day ?? it.timeOfDay ?? null,
      }),
    ),
    created_at: p.created_at ?? p.createdAt ?? null,
  }));
}

interface TimelineEvent {
  id: string;
  type: 'food' | 'weight' | 'workout' | 'fasting' | 'checkin';
  title: string;
  subtitle: string;
  date: string;
  icon: string;
  iconColor: string;
}

export default function ClientDetailScreen({ navigation, route }: Props) {
  const { clientId, clientName } = route.params;
  const currentUser = useCurrentUser();

  const [activeTab, setActiveTab] = useState<TabKey>('summary');
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>([]);
  const [totals, setTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [weekSummaries, setWeekSummaries] = useState<WeekSummary[]>([]);
  const [selectedDays, setSelectedDays] = useState<7 | 30 | 90>(90);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNudgeModal, setShowNudgeModal] = useState(false);
  const [nudgeTitle, setNudgeTitle] = useState('');
  const [nudgeBody, setNudgeBody] = useState('');
  const [nudgeSending, setNudgeSending] = useState(false);
  const [nudgeError, setNudgeError] = useState('');
  const [nudgeSuccess, setNudgeSuccess] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  // Server-side meal plans (Tier 2). The local-SQLite `planData` above is now
  // legacy — kept only because GroceryListScreen / PrepGuideScreen still read
  // from mealPlanDb on the client side. When those move to server-sourced
  // plans the local block can go.
  const [serverMealPlans, setServerMealPlans] = useState<CoachMealPlan[]>([]);
  const [mealPlansLoading, setMealPlansLoading] = useState(false);
  const [mealPlansError, setMealPlansError] = useState<string | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CoachMealPlan | null>(null);
  const [planTitle, setPlanTitle] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [planItems, setPlanItems] = useState<PlanItemDraft[]>([emptyItemDraft()]);
  const [planSaving, setPlanSaving] = useState(false);
  const [planFormError, setPlanFormError] = useState('');

  const loadData = useCallback(async () => {
    try {
      if (!refreshing) setIsLoading(true);
      const today = getTodayString();

      const res = await coachApi.getClientSummary(clientId);
      const data = res.data;
      if (data.error) return;
      // Reflect archived status from summary (client.archived_at)
      if (data.client) setIsArchived(!!data.client.archived_at);

      // Set profile
      setProfile(data.profile ? {
        ...data.profile,
        name: data.client_name,
      } : null);

      // Set food logs (map API response to expected shape)
      const logs = (data.today?.entries || []).map((e: any) => ({
        id: e.id,
        foodName: e.food_item?.name || '',
        calories: Math.round((e.food_item?.calories || 0) * (e.quantity_multiplier || 1)),
        protein: Math.round((e.food_item?.protein_g || 0) * (e.quantity_multiplier || 1)),
        carbs: Math.round((e.food_item?.carbs_g || 0) * (e.quantity_multiplier || 1)),
        fat: Math.round((e.food_item?.fat_g || 0) * (e.quantity_multiplier || 1)),
        mealType: e.meal_type,
        date: today,
      }));
      setFoodLogs(logs);

      // Set totals
      setTotals({
        calories: data.today?.total_calories || 0,
        protein: data.today?.total_protein_g || 0,
        carbs: data.today?.total_carbs_g || 0,
        fat: data.today?.total_fat_g || 0,
      });

      // Weight logs
      setWeightLogs((data.weight_logs || []).map((w: any) => ({
        id: w.id,
        weight: w.weight_lbs,
        date: typeof w.date === 'string' ? w.date.slice(0, 10) : new Date(w.date).toISOString().split('T')[0],
        notes: w.notes || '',
      })));

      // Workout sessions
      setWorkoutSessions((data.recent_workouts || []).map((s: any) => ({
        id: s.id,
        routineName: s.name || 'Workout',
        startTime: s.created_at,
        endTime: s.completed_at,
        completed: true,
        exercises: JSON.stringify((s.exercises || []).map((ex: any) => ({
          exerciseId: ex.id || '',
          exerciseName: ex.exercise_name || ex.name,
          sets: ex.sets_data || [],
        }))),
      })));

    } catch (err) {
      // Read-only client detail load — we log and let the UI render whatever
      // partial state we accumulated before the throw. User can pull-to-refresh.
      console.error('ClientDetailScreen: load failed', err);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, refreshing]);

  useEffect(() => {
    loadData();
  }, []);

  const loadServerMealPlans = useCallback(async () => {
    setMealPlansLoading(true);
    setMealPlansError(null);
    try {
      const res = await coachApi.listClientMealPlans(clientId);
      setServerMealPlans(normaliseServerPlans(res.data));
    } catch (err: any) {
      console.error('ClientDetailScreen: listClientMealPlans failed', err);
      setMealPlansError(err?.response?.data?.message || 'Could not load meal plans.');
    } finally {
      setMealPlansLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (activeTab === 'timeline') {
      loadTimeline();
    }
    if (activeTab === 'weekly') {
      loadWeeklySummaries();
    }
    if (activeTab === 'mealplan') {
      loadServerMealPlans();
    }
  }, [activeTab, selectedDays]);

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanTitle('');
    setPlanNotes('');
    setPlanItems([emptyItemDraft()]);
    setPlanFormError('');
    setShowPlanModal(true);
  };

  const openEditPlan = (plan: CoachMealPlan) => {
    setEditingPlan(plan);
    setPlanTitle(plan.title);
    setPlanNotes(plan.notes || '');
    setPlanItems(
      plan.items.length > 0
        ? plan.items.map((it) => ({
            name: it.name || '',
            calories: it.calories != null ? String(it.calories) : '',
            protein: it.protein != null ? String(it.protein) : '',
            notes: it.notes || '',
            time_of_day: it.time_of_day || '',
          }))
        : [emptyItemDraft()],
    );
    setPlanFormError('');
    setShowPlanModal(true);
  };

  const submitPlanForm = async () => {
    setPlanFormError('');
    if (!planTitle.trim()) {
      setPlanFormError('Give the plan a title.');
      return;
    }
    const items = planItems
      .filter((it) => it.name.trim().length > 0)
      .map((it) => {
        const row: Record<string, any> = { name: it.name.trim() };
        const cal = Number(it.calories);
        if (it.calories && !Number.isNaN(cal)) row.calories = cal;
        const prot = Number(it.protein);
        if (it.protein && !Number.isNaN(prot)) row.protein = prot;
        if (it.notes.trim()) row.notes = it.notes.trim();
        if (it.time_of_day.trim()) row.time_of_day = it.time_of_day.trim().toLowerCase();
        return row;
      });
    if (items.length === 0) {
      setPlanFormError('Add at least one meal item.');
      return;
    }
    setPlanSaving(true);
    try {
      const body: Record<string, any> = {
        title: planTitle.trim(),
        notes: planNotes.trim() || null,
        items,
      };
      if (editingPlan) {
        await coachApi.updateMealPlan(editingPlan.id, body);
      } else {
        await coachApi.createClientMealPlan(clientId, body);
      }
      setShowPlanModal(false);
      await loadServerMealPlans();
    } catch (err: any) {
      setPlanFormError(err?.response?.data?.message || 'Save failed. Try again.');
    } finally {
      setPlanSaving(false);
    }
  };

  const archivePlan = (plan: CoachMealPlan) => {
    Alert.alert(
      'Archive meal plan?',
      `"${plan.title}" will no longer show up for this client.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            try {
              await coachApi.archiveMealPlan(plan.id);
              await loadServerMealPlans();
            } catch (err: any) {
              Alert.alert(
                'Archive failed',
                err?.response?.data?.message || err?.message || 'Try again.',
              );
            }
          },
        },
      ],
    );
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const sendNudge = async () => {
    setNudgeError('');
    if (!nudgeTitle.trim() || !nudgeBody.trim()) {
      setNudgeError('Title and message are both required.');
      return;
    }
    setNudgeSending(true);
    try {
      await coachApi.sendNudge(clientId, {
        title: nudgeTitle.trim(),
        body: nudgeBody.trim(),
      });
      setNudgeTitle('');
      setNudgeBody('');
      setNudgeSuccess(true);
      setShowNudgeModal(false);
      // Toast-like transient banner — auto-hide.
      setTimeout(() => setNudgeSuccess(false), 2500);
    } catch (err: any) {
      setNudgeError(err?.response?.data?.message || 'Failed to send nudge.');
    } finally {
      setNudgeSending(false);
    }
  };

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'summary', label: 'Summary', icon: 'pie-chart-outline' },
    { key: 'logs', label: 'Logs', icon: 'restaurant-outline' },
    { key: 'workouts', label: 'Workouts', icon: 'barbell-outline' },
    { key: 'mealplan', label: 'Plan', icon: 'calendar-outline' },
    { key: 'progress', label: 'Progress', icon: 'trending-up-outline' },
    { key: 'timeline', label: 'Timeline', icon: 'time-outline' },
    { key: 'weekly', label: 'Weekly', icon: 'stats-chart-outline' },
  ];

  const loadTimeline = useCallback(async () => {
    try {
      const res = await coachApi.getClientTimeline(clientId, selectedDays);
      const data = res.data;
      if (data.error) return;

      const events: TimelineEvent[] = [];

      // Food events grouped by date
      const mealsByDate = new Map<string, { count: number; totalCals: number }>();
      for (const meal of (data.meals || [])) {
        const dateStr = (meal.logged_at || '').slice(0, 10);
        if (!dateStr) continue;
        const existing = mealsByDate.get(dateStr) || { count: 0, totalCals: 0 };
        existing.count += 1;
        existing.totalCals += (meal.food_item?.calories || 0) * (meal.quantity_multiplier || 1);
        mealsByDate.set(dateStr, existing);
      }
      for (const [dateStr, info] of mealsByDate) {
        events.push({
          id: `food_${dateStr}`,
          type: 'food',
          title: `${info.count} meals logged`,
          subtitle: `${Math.round(info.totalCals)} kcal total`,
          date: dateStr + 'T12:00:00',
          icon: 'restaurant',
          iconColor: Colors.primary,
        });
      }

      // Weight events
      for (const w of (data.weights || [])) {
        const dateStr = (w.date || '').slice(0, 10);
        events.push({
          id: `weight_${w.id}`,
          type: 'weight',
          title: `Weight: ${w.weight_lbs} lbs`,
          subtitle: w.notes || 'Weight logged',
          date: dateStr + 'T08:00:00',
          icon: 'scale',
          iconColor: Colors.info,
        });
      }

      // Workout events
      for (const s of (data.workouts || [])) {
        events.push({
          id: `workout_${s.id}`,
          type: 'workout',
          title: s.name || 'Workout',
          subtitle: s.completed_at ? `Completed` : 'Logged',
          date: s.created_at || s.date,
          icon: 'barbell',
          iconColor: Colors.primaryDark, // Round 3: hex → token (workout event icon)
        });
      }

      // Check-in events
      for (const c of (data.checkIns || [])) {
        events.push({
          id: `checkin_${c.id}`,
          type: 'checkin',
          title: 'Check-in',
          subtitle: c.notes || `Mood: ${c.mood_rating}/5`,
          date: c.date + 'T09:00:00',
          icon: 'chatbubble-ellipses',
          iconColor: Colors.primary,
        });
      }

      events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTimeline(events);
    } catch (err) {
      // Timeline is a read-only aggregate — empty state is acceptable here.
      console.error('ClientDetailScreen: loadTimeline failed', err);
    }
  }, [clientId, selectedDays]);

  // ── Weekly Summary ────────────────────────────────────────────────────────────
  const loadWeeklySummaries = useCallback(async () => {
    try {
      // Use the backend API to get timeline data for the selected period
      const res = await coachApi.getClientTimeline(clientId, selectedDays);
      const data = res.data;

      if (data.error) return;

      const { meals, workouts, weights } = data;

      // Helper: get Monday of the week for a given date string
      const getMondayOf = (dateStr: string): string => {
        const d = new Date(dateStr + 'T00:00:00');
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d.toISOString().split('T')[0];
      };

      const getSundayOf = (mondayStr: string): string => {
        const d = new Date(mondayStr + 'T00:00:00');
        d.setDate(d.getDate() + 6);
        return d.toISOString().split('T')[0];
      };

      const formatWeekLabel = (startStr: string, endStr: string): string => {
        const start = new Date(startStr + 'T00:00:00');
        const end = new Date(endStr + 'T00:00:00');
        const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${fmt(start)} – ${fmt(end)}`;
      };

      // Build a map of weekStart -> WeekSummary
      const weekMap = new Map<string, WeekSummary>();

      const ensureWeek = (dateStr: string): WeekSummary => {
        const monday = getMondayOf(dateStr);
        if (!weekMap.has(monday)) {
          const sunday = getSundayOf(monday);
          weekMap.set(monday, {
            weekStart: monday,
            weekEnd: sunday,
            weekLabel: formatWeekLabel(monday, sunday),
            totalCalories: 0,
            totalProtein: 0,
            totalWeightMoved: 0,
            latestWeight: null,
            workoutCount: 0,
          });
        }
        return weekMap.get(monday)!;
      };

      // Aggregate food logs
      if (Array.isArray(meals)) {
        for (const meal of meals) {
          const dateStr = (meal.logged_at || meal.date || '').slice(0, 10);
          if (!dateStr) continue;
          const week = ensureWeek(dateStr);
          week.totalCalories += meal.calories || meal.food_item?.calories || 0;
          week.totalProtein += meal.protein || meal.food_item?.protein || 0;
        }
      }

      // Aggregate workout sessions
      if (Array.isArray(workouts)) {
        for (const session of workouts) {
          const dateStr = (session.created_at || session.date || '').slice(0, 10);
          if (!dateStr) continue;
          const week = ensureWeek(dateStr);
          week.workoutCount += 1;
          // Sum volume from exercises
          if (Array.isArray(session.exercises)) {
            for (const ex of session.exercises) {
              const sets = ex.sets || [];
              if (Array.isArray(sets)) {
                for (const set of sets) {
                  if (set.completed) {
                    week.totalWeightMoved += (set.weight || 0) * (set.reps || 0);
                  }
                }
              }
            }
          }
        }
      }

      // Latest weight per week
      if (Array.isArray(weights)) {
        for (const w of weights) {
          const dateStr = (w.date || '').slice(0, 10);
          if (!dateStr) continue;
          const week = ensureWeek(dateStr);
          // weights are ordered desc, so first one per week is the latest
          if (week.latestWeight === null) {
            week.latestWeight = w.weight_lbs || w.weight || null;
          }
        }
      }

      // Sort weeks newest first
      const sorted = Array.from(weekMap.values()).sort(
        (a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()
      );

      setWeekSummaries(sorted);
    } catch (err) {
      // Read-only summary aggregation — partial state is acceptable.
      console.error('ClientDetailScreen: loadWeeklySummaries failed', err);
    }
  }, [clientId, selectedDays]);

  const parseExercises = (json: string): SessionExercise[] => {
    try { return JSON.parse(json); } catch { return []; }
  };

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return 'In progress';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const min = Math.round(ms / 60000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
  };

  const handleToggleArchive = async () => {
    setArchiveBusy(true);
    try {
      if (isArchived) {
        await coachApi.unarchiveClient(clientId);
        setIsArchived(false);
        Alert.alert('Unarchived', `${clientName} has been restored to active.`);
      } else {
        await coachApi.archiveClient(clientId);
        setIsArchived(true);
        Alert.alert('Archived', `${clientName} has been archived.`);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to update client status.');
    } finally {
      setArchiveBusy(false);
    }
  };

  if (isLoading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const calTarget = profile?.calorieTarget || 0;
  const calPct = calTarget > 0 ? Math.min(100, Math.round((totals.calories / calTarget) * 100)) : 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {clientName.split(' ').map((n) => n[0]).join('')}
            </Text>
          </View>
          <View>
            <Text style={styles.clientName}>{clientName}</Text>
            <Text style={styles.clientStatus}>
              {profile?.primaryGoal?.replace(/_/g, ' ') || 'Active client'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.msgIconBtn}
          onPress={() => {
            if (!currentUser) return;
            navigation.getParent()?.navigate('Messages', { clientId, clientName });
          }}
        >
          <Ionicons name="chatbubble-outline" size={20} color={Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.msgIconBtn, { marginLeft: 4 }]}
          onPress={handleToggleArchive}
          disabled={archiveBusy}
          accessibilityRole="button"
          accessibilityLabel={isArchived ? 'Unarchive client' : 'Archive client'}
        >
          <Ionicons
            name={isArchived ? 'archive' : 'archive-outline'}
            size={20}
            color={isArchived ? Colors.warning : Colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabRow}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon as any}
              size={16}
              color={activeTab === tab.key ? Colors.textOnPrimary : Colors.textSecondary}
            />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
        }
      >
        {activeTab === 'summary' && (
          <>
            {/* Calorie Ring Card */}
            <View style={styles.calorieCard}>
              <View style={styles.calorieMain}>
                <Text style={styles.calorieValue}>{Math.round(totals.calories)}</Text>
                <Text style={styles.calorieTarget}>/ {calTarget || '—'} kcal</Text>
              </View>
              <View style={styles.caloriePctBg}>
                <View style={[styles.caloriePctFill, { width: `${calPct}%` }]} />
              </View>
              <Text style={styles.caloriePctText}>{calPct}% of daily target</Text>
            </View>

            {/* Macro Cards */}
            <View style={styles.macroGrid}>
              <MacroCard label="Protein" value={totals.protein} target={profile?.proteinTarget} unit="g" color={Colors.protein} />
              <MacroCard label="Carbs" value={totals.carbs} target={profile?.carbTarget} unit="g" color={Colors.carbs} />
              <MacroCard label="Fat" value={totals.fat} target={profile?.fatTarget} unit="g" color={Colors.fat} />
            </View>

            {/* Profile Info */}
            <Text style={styles.sectionTitle}>Profile</Text>
            <View style={styles.profileGrid}>
              <ProfileRow label="Goal" value={profile?.primaryGoal?.replace(/_/g, ' ') || '—'} />
              <ProfileRow label="Activity" value={profile?.activityLevel?.replace(/_/g, ' ') || '—'} />
              <ProfileRow label="Weight" value={profile?.currentWeight ? `${profile.currentWeight} lbs` : '—'} />
              <ProfileRow label="Target" value={profile?.targetWeight ? `${profile.targetWeight} lbs` : '—'} />
              <ProfileRow label="TDEE" value={profile?.tdee ? `${Math.round(profile.tdee)} kcal` : '—'} />
              <ProfileRow label="Fitness" value={profile?.fitnessLevel || '—'} />
            </View>

            {/* Coach → Client actions */}
            <Text style={styles.sectionTitle}>Actions</Text>
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.actionPill}
                onPress={() =>
                  navigation.navigate('ClientMessages', {
                    clientId,
                    clientName: route.params.clientName,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Open messages"
              >
                <Ionicons name="chatbubble-outline" size={18} color={Colors.primary} />
                <Text style={styles.actionPillText}>Messages</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionPill}
                onPress={() => {
                  setShowNudgeModal(true);
                  setNudgeError('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Send nudge notification"
              >
                <Ionicons name="notifications-outline" size={18} color={Colors.primary} />
                <Text style={styles.actionPillText}>Send Nudge</Text>
              </TouchableOpacity>
            </View>
            {nudgeSuccess && (
              <View style={styles.successBanner} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={styles.successBannerText}>Nudge sent</Text>
              </View>
            )}
          </>
        )}

        {activeTab === 'logs' && (
          <>
            <Text style={styles.sectionTitle}>Today's Food Logs</Text>
            {foodLogs.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="restaurant-outline" size={32} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No logs for today</Text>
              </View>
            ) : (
              foodLogs.map((log) => (
                <View key={log.id} style={styles.logItem}>
                  <View style={styles.logHeader}>
                    <Text style={styles.logMeal}>{log.mealType}</Text>
                    <Text style={styles.logCalories}>{Math.round(log.calories)} kcal</Text>
                  </View>
                  <Text style={styles.logFood}>{log.foodName}</Text>
                  <Text style={styles.logMacros}>
                    P: {Math.round(log.protein)}g  |  C: {Math.round(log.carbs)}g  |  F: {Math.round(log.fat)}g
                  </Text>
                </View>
              ))
            )}
          </>
        )}

        {activeTab === 'workouts' && (
          <>
            <Text style={styles.sectionTitle}>Recent Workouts</Text>
            {workoutSessions.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="barbell-outline" size={32} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No workout sessions yet</Text>
              </View>
            ) : (
              workoutSessions.map((session) => {
                const exList = parseExercises(session.exercises);
                const totalSets = exList.reduce((s, e) => s + e.sets.length, 0);
                const completedSets = exList.reduce((s, e) => s + e.sets.filter((st) => st.completed).length, 0);
                return (
                  <View key={session.id} style={styles.sessionCard}>
                    <View style={styles.sessionTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sessionName}>{session.routineName}</Text>
                        <Text style={styles.sessionDate}>
                          {new Date(session.startTime).toLocaleDateString()} · {formatDuration(session.startTime, session.endTime || undefined)}
                        </Text>
                      </View>
                      {session.completed ? (
                        <View style={styles.completedBadge}>
                          <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                          <Text style={styles.completedText}>Done</Text>
                        </View>
                      ) : (
                        <Text style={styles.inProgressText}>In progress</Text>
                      )}
                    </View>
                    {/* Exercise breakdown */}
                    <View style={styles.sessionStats}>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValue}>{exList.length}</Text>
                        <Text style={styles.sessionStatLabel}>Exercises</Text>
                      </View>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValue}>{completedSets}/{totalSets}</Text>
                        <Text style={styles.sessionStatLabel}>Sets</Text>
                      </View>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValue}>
                          {Math.round(exList.reduce((s, e) => s + e.sets.reduce((ss, st) => ss + (st.completed ? st.weight * st.reps : 0), 0), 0))}
                        </Text>
                        <Text style={styles.sessionStatLabel}>Volume (lbs)</Text>
                      </View>
                    </View>
                    {/* Exercise names */}
                    <Text style={styles.sessionExercises} numberOfLines={2}>
                      {exList.map((e) => e.exerciseName).join(' · ')}
                    </Text>
                  </View>
                );
              })
            )}
          </>
        )}

        {activeTab === 'mealplan' && (
          <>
            <View style={styles.mealPlansHeader}>
              <Text style={styles.sectionTitle}>Meal Plans</Text>
              <TouchableOpacity
                style={styles.createPlanBtn}
                onPress={openCreatePlan}
                accessibilityRole="button"
                accessibilityLabel="Create meal plan"
              >
                <Ionicons name="add" size={16} color={Colors.textOnPrimary} />
                <Text style={styles.createPlanBtnText}>New plan</Text>
              </TouchableOpacity>
            </View>

            {mealPlansLoading && serverMealPlans.length === 0 ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 20 }} />
            ) : mealPlansError && serverMealPlans.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="cloud-offline-outline" size={32} color={Colors.textMuted} />
                <Text style={styles.emptyText}>{mealPlansError}</Text>
                <TouchableOpacity onPress={loadServerMealPlans} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : serverMealPlans.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="restaurant-outline" size={32} color={Colors.textMuted} />
                <Text style={styles.emptyText}>
                  No meal plans yet. Tap "New plan" to assign one — the client will see it
                  on their Plan tab.
                </Text>
              </View>
            ) : (
              serverMealPlans.map((plan) => (
                <View key={plan.id} style={styles.serverPlanCard}>
                  <View style={styles.serverPlanHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.serverPlanTitle}>{plan.title}</Text>
                      {plan.created_at && (
                        <Text style={styles.serverPlanMeta}>
                          Assigned{' '}
                          {new Date(plan.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </Text>
                      )}
                    </View>
                    <View style={styles.serverPlanActions}>
                      <TouchableOpacity
                        onPress={() => openEditPlan(plan)}
                        style={styles.planIconBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${plan.title}`}
                      >
                        <Ionicons name="create-outline" size={18} color={Colors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => archivePlan(plan)}
                        style={styles.planIconBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Archive ${plan.title}`}
                      >
                        <Ionicons name="archive-outline" size={18} color={Colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {plan.notes ? (
                    <Text style={styles.serverPlanNotes}>{plan.notes}</Text>
                  ) : null}
                  {plan.items.length === 0 ? (
                    <Text style={styles.serverPlanEmpty}>No items in this plan.</Text>
                  ) : (
                    plan.items.map((it, idx) => (
                      <View key={idx} style={styles.serverPlanRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.serverPlanItemName}>
                            {it.name || '—'}
                            {it.time_of_day ? (
                              <Text style={styles.serverPlanItemTod}>
                                {'  · '}
                                {it.time_of_day}
                              </Text>
                            ) : null}
                          </Text>
                          {it.notes ? (
                            <Text style={styles.serverPlanItemNotes}>{it.notes}</Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          {it.calories != null && (
                            <Text style={styles.serverPlanItemCal}>
                              {Math.round(Number(it.calories))} kcal
                            </Text>
                          )}
                          {it.protein != null && (
                            <Text style={styles.serverPlanItemProt}>
                              P {Math.round(Number(it.protein))}g
                            </Text>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              ))
            )}
          </>
        )}

        {activeTab === 'progress' && (
          <>
            <Text style={styles.sectionTitle}>Weight (Last 30 Days)</Text>
            {weightLogs.length > 0 ? (
              <>
                <View style={styles.progressStatsRow}>
                  <View style={styles.progressStat}>
                    <Text style={styles.progressStatValue}>{weightLogs[0]?.weight || '—'}</Text>
                    <Text style={styles.progressStatLabel}>First</Text>
                  </View>
                  <View style={styles.progressStat}>
                    <Text style={[styles.progressStatValue, { color: Colors.primary }]}>
                      {weightLogs[weightLogs.length - 1]?.weight || '—'}
                    </Text>
                    <Text style={styles.progressStatLabel}>Latest</Text>
                  </View>
                  <View style={styles.progressStat}>
                    <Text
                      style={[
                        styles.progressStatValue,
                        {
                          color:
                            (weightLogs[weightLogs.length - 1]?.weight || 0) - (weightLogs[0]?.weight || 0) <= 0
                              ? Colors.success
                              : Colors.warning,
                        },
                      ]}
                    >
                      {((weightLogs[weightLogs.length - 1]?.weight || 0) - (weightLogs[0]?.weight || 0)).toFixed(1)}
                    </Text>
                    <Text style={styles.progressStatLabel}>Change</Text>
                  </View>
                </View>
                {weightLogs.map((log) => (
                  <View key={log.id} style={styles.logItem}>
                    <View style={styles.logHeader}>
                      <Text style={styles.logMeal}>{log.date}</Text>
                      <Text style={styles.logCalories}>{log.weight} {log.unit}</Text>
                    </View>
                    {log.notes ? <Text style={styles.logMacros}>{log.notes}</Text> : null}
                  </View>
                ))}
              </>
            ) : (
              <View style={styles.emptyCard}>
                <Ionicons name="scale-outline" size={32} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No weight logs in the last 30 days</Text>
              </View>
            )}
          </>
        )}

        {activeTab === 'timeline' && (
          <>
            {/* Date Range Selector */}
            <DateRangeSelector
              selectedDays={selectedDays}
              onSelect={(d) => {
                setSelectedDays(d);
                setTimeline([]);
              }}
            />
            <TimelineTab
              events={timeline}
              onLoad={loadTimeline}
              days={selectedDays}
            />
          </>
        )}

        {activeTab === 'weekly' && (
          <>
            {/* Date Range Selector */}
            <DateRangeSelector
              selectedDays={selectedDays}
              onSelect={(d) => {
                setSelectedDays(d);
                setWeekSummaries([]);
              }}
            />
            <WeeklySummaryTab
              summaries={weekSummaries}
              days={selectedDays}
              expandedWeeks={expandedWeeks}
              onToggleWeek={(weekStart) => {
                setExpandedWeeks((prev) => {
                  const next = new Set(prev);
                  if (next.has(weekStart)) {
                    next.delete(weekStart);
                  } else {
                    next.add(weekStart);
                  }
                  return next;
                });
              }}
            />
          </>
        )}
      </ScrollView>

      <Modal
        visible={showPlanModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPlanModal(false)}
      >
        <View style={styles.planModalContainer}>
          <View style={styles.planModalHeader}>
            <Text style={styles.planModalTitle}>
              {editingPlan ? 'Edit meal plan' : 'New meal plan'}
            </Text>
            <TouchableOpacity
              onPress={() => setShowPlanModal(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.planModalContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.planFieldLabel}>Title</Text>
            <TextInput
              style={styles.planInput}
              placeholder="e.g. Cutting Week 1"
              placeholderTextColor={Colors.textMuted}
              value={planTitle}
              onChangeText={setPlanTitle}
              maxLength={120}
              accessibilityLabel="Plan title"
            />

            <Text style={styles.planFieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.planInput, styles.planInputMulti]}
              placeholder="Overall guidance for this plan..."
              placeholderTextColor={Colors.textMuted}
              value={planNotes}
              onChangeText={setPlanNotes}
              multiline
              maxLength={1000}
              accessibilityLabel="Plan notes"
            />

            <View style={styles.planItemsHeader}>
              <Text style={styles.planFieldLabel}>Items</Text>
              <TouchableOpacity
                onPress={() => setPlanItems((prev) => [...prev, emptyItemDraft()])}
                style={styles.planAddItemBtn}
                accessibilityRole="button"
                accessibilityLabel="Add meal item"
              >
                <Ionicons name="add" size={14} color={Colors.primary} />
                <Text style={styles.planAddItemText}>Add item</Text>
              </TouchableOpacity>
            </View>

            {planItems.map((it, idx) => (
              <View key={idx} style={styles.planItemCard}>
                <View style={styles.planItemTopRow}>
                  <Text style={styles.planItemIndex}>#{idx + 1}</Text>
                  {planItems.length > 1 && (
                    <TouchableOpacity
                      onPress={() =>
                        setPlanItems((prev) => prev.filter((_, i) => i !== idx))
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Remove item"
                    >
                      <Ionicons name="trash-outline" size={16} color={Colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  style={styles.planItemInput}
                  placeholder="Meal name (e.g. Chicken & rice)"
                  placeholderTextColor={Colors.textMuted}
                  value={it.name}
                  onChangeText={(t) =>
                    setPlanItems((prev) =>
                      prev.map((p, i) => (i === idx ? { ...p, name: t } : p)),
                    )
                  }
                  maxLength={120}
                  accessibilityLabel={`Item ${idx + 1} name`}
                />
                <View style={styles.planItemRow}>
                  <TextInput
                    style={[styles.planItemInput, { flex: 1 }]}
                    placeholder="kcal"
                    placeholderTextColor={Colors.textMuted}
                    value={it.calories}
                    onChangeText={(t) =>
                      setPlanItems((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, calories: t } : p)),
                      )
                    }
                    keyboardType="number-pad"
                    maxLength={6}
                    accessibilityLabel={`Item ${idx + 1} calories`}
                  />
                  <TextInput
                    style={[styles.planItemInput, { flex: 1 }]}
                    placeholder="protein (g)"
                    placeholderTextColor={Colors.textMuted}
                    value={it.protein}
                    onChangeText={(t) =>
                      setPlanItems((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, protein: t } : p)),
                      )
                    }
                    keyboardType="number-pad"
                    maxLength={5}
                    accessibilityLabel={`Item ${idx + 1} protein`}
                  />
                </View>
                <TextInput
                  style={styles.planItemInput}
                  placeholder="time of day (breakfast / lunch / dinner / snack)"
                  placeholderTextColor={Colors.textMuted}
                  value={it.time_of_day}
                  onChangeText={(t) =>
                    setPlanItems((prev) =>
                      prev.map((p, i) => (i === idx ? { ...p, time_of_day: t } : p)),
                    )
                  }
                  maxLength={32}
                  autoCapitalize="none"
                  accessibilityLabel={`Item ${idx + 1} time of day`}
                />
                <TextInput
                  style={[styles.planItemInput, styles.planInputMulti]}
                  placeholder="Notes (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={it.notes}
                  onChangeText={(t) =>
                    setPlanItems((prev) =>
                      prev.map((p, i) => (i === idx ? { ...p, notes: t } : p)),
                    )
                  }
                  multiline
                  maxLength={300}
                  accessibilityLabel={`Item ${idx + 1} notes`}
                />
              </View>
            ))}

            {planFormError ? (
              <Text style={styles.planFormError} accessibilityLiveRegion="assertive">
                {planFormError}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[styles.planSubmitBtn, planSaving && { opacity: 0.6 }]}
              onPress={submitPlanForm}
              disabled={planSaving}
              accessibilityRole="button"
              accessibilityLabel={editingPlan ? 'Save changes' : 'Create plan'}
            >
              <Text style={styles.planSubmitText}>
                {planSaving ? 'Saving…' : editingPlan ? 'Save changes' : 'Create plan'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showNudgeModal} transparent animationType="fade" onRequestClose={() => setShowNudgeModal(false)}>
        <View style={styles.nudgeModalOverlay}>
          <View style={styles.nudgeModalContent}>
            <Text style={styles.nudgeModalTitle}>Send Nudge</Text>
            <Text style={styles.nudgeModalDesc}>
              Send a push-style notification to {route.params.clientName}.
            </Text>

            <Text style={styles.nudgeLabel}>Title</Text>
            <TextInput
              style={styles.nudgeInput}
              placeholder="e.g. Great job today"
              placeholderTextColor={Colors.textMuted}
              value={nudgeTitle}
              onChangeText={setNudgeTitle}
              maxLength={80}
              accessibilityLabel="Nudge title"
            />

            <Text style={styles.nudgeLabel}>Message</Text>
            <TextInput
              style={[styles.nudgeInput, styles.nudgeInputMulti]}
              placeholder="Write a short message..."
              placeholderTextColor={Colors.textMuted}
              value={nudgeBody}
              onChangeText={setNudgeBody}
              multiline
              maxLength={500}
              accessibilityLabel="Nudge message"
            />

            {nudgeError ? (
              <Text style={styles.nudgeErrorText} accessibilityLiveRegion="assertive">
                {nudgeError}
              </Text>
            ) : null}

            <View style={styles.nudgeButtons}>
              <TouchableOpacity
                style={styles.nudgeCancelBtn}
                onPress={() => {
                  setShowNudgeModal(false);
                  setNudgeError('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.nudgeCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.nudgeSendBtn, nudgeSending && { opacity: 0.6 }]}
                onPress={sendNudge}
                disabled={nudgeSending}
                accessibilityRole="button"
                accessibilityLabel="Send nudge"
              >
                <Text style={styles.nudgeSendText}>{nudgeSending ? 'Sending…' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Date Range Selector ───────────────────────────────────────────────────

function DateRangeSelector({
  selectedDays,
  onSelect,
}: {
  selectedDays: 7 | 30 | 90;
  onSelect: (days: 7 | 30 | 90) => void;
}) {
  const options: { label: string; value: 7 | 30 | 90 }[] = [
    { label: '7 days', value: 7 },
    { label: '30 days', value: 30 },
    { label: '90 days', value: 90 },
  ];
  return (
    <View style={drStyles.row}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[
            drStyles.chip,
            selectedDays === opt.value && drStyles.chipActive,
          ]}
          onPress={() => onSelect(opt.value)}
        >
          <Text
            style={[
              drStyles.chipText,
              selectedDays === opt.value && drStyles.chipTextActive,
            ]}
          >
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const drStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.textOnPrimary, // Round 3: hex → token
  },
});

// ── Timeline Tab Component ───────────────────────────────────────────────

function TimelineTab({ events, onLoad, days }: { events: TimelineEvent[]; onLoad: () => void; days: number }) {
  React.useEffect(() => {
    onLoad();
  }, [days]);

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return `${diff} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (events.length === 0) {
    return (
      <View style={tlStyles.empty}>
        <Ionicons name="time-outline" size={40} color={Colors.textMuted} />
        <Text style={tlStyles.emptyText}>No activity in the last {days} days</Text>
      </View>
    );
  }

  return (
    <View style={tlStyles.container}>
      <Text style={tlStyles.header}>Activity — Last {days} Days</Text>
      {events.map((event, idx) => (
        <View key={event.id} style={tlStyles.eventRow}>
          {/* Left column: icon + line */}
          <View style={tlStyles.leftCol}>
            <View style={[tlStyles.iconCircle, { backgroundColor: event.iconColor + '20' }]}>
              <Ionicons name={event.icon as any} size={16} color={event.iconColor} />
            </View>
            {idx < events.length - 1 && <View style={tlStyles.line} />}
          </View>
          {/* Right column: content */}
          <View style={tlStyles.content}>
            <Text style={tlStyles.title}>{event.title}</Text>
            <Text style={tlStyles.subtitle}>{event.subtitle}</Text>
            <Text style={tlStyles.date}>{formatDate(event.date)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const tlStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  header: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 16,
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  eventRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 0,
  },
  leftCol: {
    alignItems: 'center',
    width: 32,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 4, // radius.lg
    justifyContent: 'center',
    alignItems: 'center',
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 16,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  content: {
    flex: 1,
    paddingBottom: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  date: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 3,
    fontWeight: '600',
  },
});

// ── Weekly Summary Tab Component ──────────────────────────────────────────────

function WeeklySummaryTab({
  summaries,
  days,
  expandedWeeks,
  onToggleWeek,
}: {
  summaries: WeekSummary[];
  days: number;
  expandedWeeks: Set<string>;
  onToggleWeek: (weekStart: string) => void;
}) {
  if (summaries.length === 0) {
    return (
      <View style={wsStyles.empty}>
        <Ionicons name="stats-chart-outline" size={40} color={Colors.textMuted} />
        <Text style={wsStyles.emptyText}>No data in the last {days} days</Text>
      </View>
    );
  }

  return (
    <View style={wsStyles.container}>
      <Text style={wsStyles.header}>Week-by-Week Summary — Last {days} Days</Text>
      {summaries.map((week) => {
        const isExpanded = expandedWeeks.has(week.weekStart);
        return (
          <TouchableOpacity
            key={week.weekStart}
            style={wsStyles.card}
            onPress={() => onToggleWeek(week.weekStart)}
            activeOpacity={0.85}
          >
            {/* Card Header */}
            <View style={wsStyles.cardHeader}>
              <View style={wsStyles.cardHeaderLeft}>
                <Text style={wsStyles.weekLabel}>{week.weekLabel}</Text>
                <View style={wsStyles.pillRow}>
                  {week.workoutCount > 0 && (
                    <View style={wsStyles.pill}>
                      <Ionicons name="barbell" size={10} color={Colors.primary} />
                      <Text style={wsStyles.pillText}>{week.workoutCount} workout{week.workoutCount !== 1 ? 's' : ''}</Text>
                    </View>
                  )}
                  {week.latestWeight !== null && (
                    <View style={[wsStyles.pill, wsStyles.pillGrey]}>
                      <Ionicons name="scale" size={10} color={Colors.textSecondary} />
                      <Text style={[wsStyles.pillText, { color: Colors.textSecondary }]}>{week.latestWeight} lbs</Text>
                    </View>
                  )}
                </View>
              </View>
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={Colors.textMuted}
              />
            </View>

            {/* Quick stats row (always visible) */}
            <View style={wsStyles.statsRow}>
              <View style={wsStyles.statBox}>
                <Text style={wsStyles.statValue}>{Math.round(week.totalCalories).toLocaleString()}</Text>
                <Text style={wsStyles.statLabel}>kcal eaten</Text>
              </View>
              <View style={[wsStyles.statBox, wsStyles.statBoxMiddle]}>
                <Text style={[wsStyles.statValue, { color: Colors.protein }]}>{Math.round(week.totalProtein)}g</Text>
                <Text style={wsStyles.statLabel}>protein</Text>
              </View>
              <View style={wsStyles.statBox}>
                <Text style={[wsStyles.statValue, { color: Colors.accent }]}>
                  {week.totalWeightMoved > 0 ? `${Math.round(week.totalWeightMoved).toLocaleString()}` : '—'}
                </Text>
                <Text style={wsStyles.statLabel}>vol (lbs)</Text>
              </View>
            </View>

            {/* Expanded detail */}
            {isExpanded && (
              <View style={wsStyles.expandedSection}>
                <View style={wsStyles.divider} />
                <View style={wsStyles.detailRow}>
                  <Ionicons name="flame-outline" size={14} color={Colors.warning} />
                  <Text style={wsStyles.detailLabel}>Total Calories</Text>
                  <Text style={wsStyles.detailValue}>{Math.round(week.totalCalories).toLocaleString()} kcal</Text>
                </View>
                <View style={wsStyles.detailRow}>
                  <Ionicons name="nutrition-outline" size={14} color={Colors.protein} />
                  <Text style={wsStyles.detailLabel}>Total Protein</Text>
                  <Text style={wsStyles.detailValue}>{Math.round(week.totalProtein)}g</Text>
                </View>
                <View style={wsStyles.detailRow}>
                  <Ionicons name="barbell-outline" size={14} color={Colors.primary} />
                  <Text style={wsStyles.detailLabel}>Workouts</Text>
                  <Text style={wsStyles.detailValue}>{week.workoutCount}</Text>
                </View>
                <View style={wsStyles.detailRow}>
                  <Ionicons name="trending-up-outline" size={14} color={Colors.accent} />
                  <Text style={wsStyles.detailLabel}>Weight Moved</Text>
                  <Text style={wsStyles.detailValue}>
                    {week.totalWeightMoved > 0 ? `${Math.round(week.totalWeightMoved).toLocaleString()} lbs` : 'N/A'}
                  </Text>
                </View>
                <View style={wsStyles.detailRow}>
                  <Ionicons name="scale-outline" size={14} color={Colors.info} />
                  <Text style={wsStyles.detailLabel}>Weight Logged</Text>
                  <Text style={wsStyles.detailValue}>
                    {week.latestWeight !== null ? `${week.latestWeight} lbs` : 'Not logged'}
                  </Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const wsStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 24,
  },
  header: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 14,
  },
  empty: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  weekLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryPale,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillGrey: {
    backgroundColor: Colors.surfaceElevated,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 4, // radius.lg
    padding: 10,
    alignItems: 'center',
  },
  statBoxMiddle: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 0,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  expandedSection: {
    marginTop: 12,
    gap: 8,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailLabel: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
});

function MacroCard({ label, value, target, unit, color }: {
  label: string; value: number; target?: number; unit: string; color: string;
}) {
  const pct = target && target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <View style={styles.macroCard}>
      <Text style={[styles.macroCardValue, { color }]}>{Math.round(value)}{unit}</Text>
      <Text style={styles.macroCardLabel}>{label}</Text>
      {target ? (
        <>
          <View style={styles.macroBarBg}>
            <View style={[styles.macroBarFill, { width: `${pct}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.macroCardTarget}>{target}{unit}</Text>
        </>
      ) : null}
    </View>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileLabel}>{label}</Text>
      <Text style={styles.profileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingTop: 56 },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16, gap: 14,
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primaryDark,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: Colors.textOnPrimary, fontSize: 16, fontWeight: '700' },
  clientName: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  clientStatus: { fontSize: 12, color: Colors.textSecondary, textTransform: 'capitalize', marginTop: 1 },
  msgIconBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primaryPale,
    justifyContent: 'center', alignItems: 'center',
  },
  tabScroll: { maxHeight: 44, marginBottom: 16 },
  tabRow: { paddingHorizontal: 20, gap: 8 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 4, // radius.lg
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.textOnPrimary },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12, marginTop: 4 },
  // Calorie card
  calorieCard: {
    backgroundColor: Colors.surface, borderRadius: 4, padding: 20, marginBottom: 16, alignItems: 'center',
  },
  calorieMain: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 12 },
  calorieValue: { fontSize: 36, fontWeight: '800', color: Colors.textPrimary },
  calorieTarget: { fontSize: 16, color: Colors.textSecondary },
  caloriePctBg: { width: '100%', height: 6, borderRadius: 3, backgroundColor: Colors.primaryPale },
  caloriePctFill: { height: '100%', borderRadius: 3, backgroundColor: Colors.primary },
  caloriePctText: { fontSize: 12, color: Colors.textMuted, marginTop: 6 },
  // Macro cards
  macroGrid: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  macroCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 2, padding: 14, alignItems: 'center', gap: 4 },
  macroCardValue: { fontSize: 20, fontWeight: '800' },
  macroCardLabel: { fontSize: 11, color: Colors.textSecondary },
  macroBarBg: { width: '100%', height: 4, borderRadius: 2, backgroundColor: Colors.primaryPale, marginTop: 4 },
  macroBarFill: { height: '100%', borderRadius: 2 },
  macroCardTarget: { fontSize: 10, color: Colors.textMuted },
  // Profile
  profileGrid: { backgroundColor: Colors.surface, borderRadius: 2, padding: 16, gap: 12, marginBottom: 20 },
  profileRow: { flexDirection: 'row', justifyContent: 'space-between' },
  profileLabel: { fontSize: 14, color: Colors.textSecondary, textTransform: 'capitalize' },
  profileValue: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, textTransform: 'capitalize' },
  // Coach actions (messages + nudge)
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  actionPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primaryPale,
  },
  actionPillText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.success + '18',
    borderRadius: 4, // radius.lg
    marginBottom: 12,
  },
  successBannerText: { fontSize: 13, fontWeight: '600', color: Colors.success },
  nudgeModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  nudgeModalContent: { width: '85%', backgroundColor: Colors.surface, borderRadius: 4, padding: 24 },
  nudgeModalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginBottom: 6 },
  nudgeModalDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  nudgeLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginBottom: 6, marginTop: 8 },
  nudgeInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  nudgeInputMulti: { minHeight: 90, textAlignVertical: 'top' },
  nudgeErrorText: { color: Colors.error, fontSize: 13, marginTop: 10, textAlign: 'center' },
  nudgeButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  nudgeCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 4, backgroundColor: Colors.surfaceElevated, alignItems: 'center' },
  nudgeCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  nudgeSendBtn: { flex: 1, paddingVertical: 12, borderRadius: 4, backgroundColor: Colors.primary, alignItems: 'center' },
  nudgeSendText: { fontSize: 15, fontWeight: '700', color: Colors.textOnPrimary },
  // Logs
  logItem: { backgroundColor: Colors.surface, borderRadius: 2, padding: 16, marginBottom: 10 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  logMeal: { fontSize: 12, fontWeight: '600', color: Colors.primary, textTransform: 'uppercase' },
  logCalories: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  logFood: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary, marginBottom: 4 },
  logMacros: { fontSize: 13, color: Colors.textSecondary },
  // Workouts
  sessionCard: { backgroundColor: Colors.surface, borderRadius: 4, padding: 16, marginBottom: 10 },
  sessionTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  sessionName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  sessionDate: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  completedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  completedText: { fontSize: 12, fontWeight: '600', color: Colors.success },
  inProgressText: { fontSize: 12, fontWeight: '600', color: Colors.warning },
  sessionStats: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sessionStat: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 4, padding: 10, alignItems: 'center',
  },
  sessionStatValue: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  sessionStatLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  sessionExercises: { fontSize: 12, color: Colors.textMuted },
  // Progress
  progressStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  progressStat: { flex: 1, backgroundColor: Colors.surface, borderRadius: 2, padding: 14, alignItems: 'center', gap: 4 },
  progressStatValue: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary },
  progressStatLabel: { fontSize: 12, color: Colors.textSecondary },
  // Meal plan
  planDayCard: { backgroundColor: Colors.surface, borderRadius: 2, padding: 14, marginBottom: 10 },
  planDayLabel: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  planSlotRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  planSlotLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, width: 70 },
  planSlotMeal: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  planSlotCals: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  planEmpty: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },
  // Empty
  emptyCard: { backgroundColor: Colors.surface, borderRadius: 4, padding: 32, alignItems: 'center', gap: 8 },
  emptyText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center' },
  // ── Server meal plans (coach side) ──
  mealPlansHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 4,
  },
  createPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4, // radius.lg
  },
  createPlanBtnText: {
    color: Colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primaryPale,
  },
  retryBtnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  serverPlanCard: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  serverPlanHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  serverPlanTitle: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  serverPlanMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  serverPlanActions: { flexDirection: 'row', gap: 4 },
  planIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 4, // radius.lg
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.primaryPale,
  },
  serverPlanNotes: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  serverPlanEmpty: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 6,
  },
  serverPlanRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
  },
  serverPlanItemName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  serverPlanItemTod: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },
  serverPlanItemNotes: { fontSize: 12, color: Colors.textMuted, marginTop: 2, lineHeight: 16 },
  serverPlanItemCal: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  serverPlanItemProt: { fontSize: 11, fontWeight: '700', color: Colors.primary, marginTop: 2 },
  // ── Plan form modal ──
  planModalContainer: { flex: 1, backgroundColor: Colors.background },
  planModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  planModalTitle: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  planModalContent: { padding: 20, paddingBottom: 60 },
  planFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginTop: 8,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  planInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4, // radius.lg
    padding: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    marginBottom: 10,
  },
  planInputMulti: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  planItemsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  planAddItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.primaryPale,
    borderRadius: 4, // radius.lg
  },
  planAddItemText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  planItemCard: {
    backgroundColor: Colors.surface,
    borderRadius: 2, // radius.md
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  planItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  planItemIndex: { fontSize: 12, fontWeight: '700', color: Colors.textMuted },
  planItemInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 0, // radius.sm
    padding: 10,
    fontSize: 13,
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  planItemRow: { flexDirection: 'row', gap: 8 },
  planFormError: {
    color: Colors.error,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 8,
  },
  planSubmitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 2, // radius.md
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  planSubmitText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textOnPrimary,
  },
});
