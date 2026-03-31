import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ClientsStackParamList } from '../../navigation/CoachNavigator';
import { useAuthStore } from '../../store/authStore';
import { getProfileByUserId } from '../../db/profileDb';
import { getFoodLogsByDateForCoach, getDailyTotals, getFoodLogsByDate } from '../../db/foodLogDb';
import { getFastingHistory } from '../../db/fastingDb';
import { getMealPlan, parsePlanData, PlanData, PlanDay } from '../../db/mealPlanDb';
import { getWeightLogsForPeriod } from '../../db/weightLogDb';
import { getWorkoutSessions, WorkoutSession, SessionExercise } from '../../db/workoutDb';
import { createNotification } from '../../db/notificationsDb';
import { coachApi } from '../../services/api';
import { Colors } from '../../constants/colors';
import { ClientProfile, FoodLog, WeightLog } from '../../types';
import { getTodayString, addDays } from '../../utils/date';

// ── Types ────────────────────────────────────────────────────────────────────
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

interface TimelineEvent {
  id: string;
  type: 'food' | 'weight' | 'workout' | 'fasting';
  title: string;
  subtitle: string;
  date: string;
  icon: string;
  iconColor: string;
}

export default function ClientDetailScreen({ navigation, route }: Props) {
  const { clientId, clientName } = route.params;
  const { currentUser } = useAuthStore();

  const [activeTab, setActiveTab] = useState<TabKey>('summary');
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>([]);
  const [totals, setTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [planData, setPlanData] = useState<PlanData>({});
  const [weekStart, setWeekStart] = useState('');
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [weekSummaries, setWeekSummaries] = useState<WeekSummary[]>([]);
  const [selectedDays, setSelectedDays] = useState<7 | 30 | 90>(90);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notifMsg, setNotifMsg] = useState('');
  const [sending, setSending] = useState(false);

  const loadData = useCallback(async () => {
    try {
      if (!refreshing) setIsLoading(true);
      const today = getTodayString();
      const d = new Date(today + 'T00:00:00');
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      const ws = d.toISOString().split('T')[0];
      setWeekStart(ws);

      const [p, logs, t, plan, wLogs, sessions] = await Promise.all([
        getProfileByUserId(clientId),
        currentUser
          ? getFoodLogsByDateForCoach(clientId, currentUser.id, today)
          : Promise.resolve([]),
        getDailyTotals(clientId, today),
        getMealPlan(clientId, ws),
        getWeightLogsForPeriod(clientId, 30),
        getWorkoutSessions(clientId, 10),
      ]);
      setProfile(p);
      setFoodLogs(logs);
      setTotals(t);
      setPlanData(plan ? parsePlanData(plan.planData) : {});
      setWeightLogs(wLogs);
      setWorkoutSessions(sessions);
    } catch (err) {
      console.error('loadData error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, currentUser?.id, refreshing]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'timeline') {
      loadTimeline();
    }
    if (activeTab === 'weekly') {
      loadWeeklySummaries();
    }
  }, [activeTab, selectedDays]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const sendNotification = async () => {
    if (!notifMsg.trim() || !currentUser) return;
    setSending(true);
    try {
      await createNotification({
        userId: clientId,
        type: 'coach',
        title: `Message from ${currentUser.firstName}`,
        body: notifMsg.trim(),
      });
      Alert.alert('Sent', 'Notification sent to client');
      setNotifMsg('');
    } catch {
      Alert.alert('Error', 'Failed to send notification');
    } finally {
      setSending(false);
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
      const events: TimelineEvent[] = [];
      const daysToLoad = selectedDays;

      // Food logs (grouped by date)
      const foodDates = new Set<string>();
      let dayOffset = 0;
      while (dayOffset < daysToLoad) {
        const d = new Date();
        d.setDate(d.getDate() - dayOffset);
        const dateStr = d.toISOString().split('T')[0];
        if (!foodDates.has(dateStr)) {
          foodDates.add(dateStr);
          const logs = await getFoodLogsByDate(clientId, dateStr);
          if (logs.length > 0) {
            const totalCals = logs.reduce((s, l) => s + l.calories, 0);
            events.push({
              id: `food_${dateStr}`,
              type: 'food',
              title: `${logs.length} meals logged`,
              subtitle: `${Math.round(totalCals)} kcal total`,
              date: dateStr + 'T12:00:00',
              icon: 'restaurant',
              iconColor: Colors.primary,
            });
          }
        }
        dayOffset++;
      }

      // Weight logs
      const wLogs = await getWeightLogsForPeriod(clientId, daysToLoad);
      for (const w of wLogs) {
        events.push({
          id: `weight_${w.id}`,
          type: 'weight',
          title: `Weight: ${w.weight} lbs`,
          subtitle: w.notes || 'Weight logged',
          date: w.date + 'T08:00:00',
          icon: 'scale',
          iconColor: Colors.info,
        });
      }

      // Workout sessions
      const wSessions = await getWorkoutSessions(clientId, 50);
      for (const s of wSessions) {
        if (!s.completed) continue;
        events.push({
          id: `workout_${s.id}`,
          type: 'workout',
          title: s.routineName,
          subtitle: s.endTime ? `Completed · ${Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000)} min` : 'Completed',
          date: s.startTime,
          icon: 'barbell',
          iconColor: '#9B72AA',
        });
      }

      // Fasting sessions
      const fSessions = await getFastingHistory(clientId);
      for (const f of fSessions.slice(0, 20)) {
        if (!f.completed) continue;
        events.push({
          id: `fast_${f.id}`,
          type: 'fasting',
          title: `${f.targetHours}h fast completed`,
          subtitle: f.endTime ? `Ended ${new Date(f.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Completed',
          date: f.startTime,
          icon: 'timer',
          iconColor: Colors.warning,
        });
      }

      // Sort by date DESC
      events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTimeline(events);
    } catch (err) {
      console.warn('loadTimeline error:', err);
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
      console.warn('loadWeeklySummaries error:', err);
    }
  }, [clientId, selectedDays]);

  const SLOT_LABELS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
  const SLOT_KEYS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const getWeekDates = () => {
    if (!weekStart) return [];
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  };

  const getDayPlan = (dateStr: string): PlanDay =>
    planData[dateStr] || { breakfast: null, lunch: null, dinner: null, snacks: null };

  const parseExercises = (json: string): SessionExercise[] => {
    try { return JSON.parse(json); } catch { return []; }
  };

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return 'In progress';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const min = Math.round(ms / 60000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
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
              color={activeTab === tab.key ? '#fff' : Colors.textSecondary}
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

            {/* Send Notification */}
            <Text style={styles.sectionTitle}>Send Notification</Text>
            <View style={styles.notifCard}>
              <TextInput
                style={styles.notifInput}
                placeholder="Type a message to send as notification..."
                placeholderTextColor={Colors.textMuted}
                value={notifMsg}
                onChangeText={setNotifMsg}
                multiline
              />
              <TouchableOpacity
                style={[styles.notifSendBtn, (!notifMsg.trim() || sending) && styles.notifSendDisabled]}
                onPress={sendNotification}
                disabled={!notifMsg.trim() || sending}
              >
                <Ionicons name="send" size={16} color="#fff" />
                <Text style={styles.notifSendText}>{sending ? 'Sending...' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
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
            <Text style={styles.sectionTitle}>This Week's Meal Plan</Text>
            {weekStart ? (
              getWeekDates().map((date, dayIdx) => {
                const dayPlan = getDayPlan(date);
                const hasAny = SLOT_KEYS.some((k) => dayPlan[k] !== null);
                return (
                  <View key={date} style={styles.planDayCard}>
                    <Text style={styles.planDayLabel}>
                      {DAY_LABELS[dayIdx]} — {new Date(date + 'T00:00:00').getDate()}
                    </Text>
                    {hasAny ? (
                      SLOT_KEYS.map((slot, si) =>
                        dayPlan[slot] ? (
                          <View key={slot} style={styles.planSlotRow}>
                            <Text style={styles.planSlotLabel}>{SLOT_LABELS[si]}</Text>
                            <Text style={styles.planSlotMeal}>{dayPlan[slot]!.name}</Text>
                            <Text style={styles.planSlotCals}>{dayPlan[slot]!.calories} kcal</Text>
                          </View>
                        ) : null
                      )
                    ) : (
                      <Text style={styles.planEmpty}>No meals planned</Text>
                    )}
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyText}>Loading...</Text>
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
    borderRadius: 20,
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
    color: '#fff',
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
    borderRadius: 16,
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
    borderRadius: 14,
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
    borderRadius: 10,
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
    borderRadius: 10,
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
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
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
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: '#fff' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12, marginTop: 4 },
  // Calorie card
  calorieCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 20, marginBottom: 16, alignItems: 'center',
  },
  calorieMain: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 12 },
  calorieValue: { fontSize: 36, fontWeight: '800', color: Colors.textPrimary },
  calorieTarget: { fontSize: 16, color: Colors.textSecondary },
  caloriePctBg: { width: '100%', height: 6, borderRadius: 3, backgroundColor: Colors.primaryPale },
  caloriePctFill: { height: '100%', borderRadius: 3, backgroundColor: Colors.primary },
  caloriePctText: { fontSize: 12, color: Colors.textMuted, marginTop: 6 },
  // Macro cards
  macroGrid: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  macroCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, alignItems: 'center', gap: 4 },
  macroCardValue: { fontSize: 20, fontWeight: '800' },
  macroCardLabel: { fontSize: 11, color: Colors.textSecondary },
  macroBarBg: { width: '100%', height: 4, borderRadius: 2, backgroundColor: Colors.primaryPale, marginTop: 4 },
  macroBarFill: { height: '100%', borderRadius: 2 },
  macroCardTarget: { fontSize: 10, color: Colors.textMuted },
  // Profile
  profileGrid: { backgroundColor: Colors.surface, borderRadius: 12, padding: 16, gap: 12, marginBottom: 20 },
  profileRow: { flexDirection: 'row', justifyContent: 'space-between' },
  profileLabel: { fontSize: 14, color: Colors.textSecondary, textTransform: 'capitalize' },
  profileValue: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, textTransform: 'capitalize' },
  // Notification sender
  notifCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, gap: 12, marginBottom: 20 },
  notifInput: {
    backgroundColor: Colors.background, borderRadius: 10, padding: 12,
    fontSize: 14, color: Colors.textPrimary, minHeight: 60, textAlignVertical: 'top',
  },
  notifSendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10,
  },
  notifSendDisabled: { opacity: 0.5 },
  notifSendText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  // Logs
  logItem: { backgroundColor: Colors.surface, borderRadius: 12, padding: 16, marginBottom: 10 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  logMeal: { fontSize: 12, fontWeight: '600', color: Colors.primary, textTransform: 'uppercase' },
  logCalories: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  logFood: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary, marginBottom: 4 },
  logMacros: { fontSize: 13, color: Colors.textSecondary },
  // Workouts
  sessionCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 10 },
  sessionTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  sessionName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  sessionDate: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  completedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  completedText: { fontSize: 12, fontWeight: '600', color: Colors.success },
  inProgressText: { fontSize: 12, fontWeight: '600', color: Colors.warning },
  sessionStats: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sessionStat: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 10, padding: 10, alignItems: 'center',
  },
  sessionStatValue: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  sessionStatLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  sessionExercises: { fontSize: 12, color: Colors.textMuted },
  // Progress
  progressStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  progressStat: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, alignItems: 'center', gap: 4 },
  progressStatValue: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary },
  progressStatLabel: { fontSize: 12, color: Colors.textSecondary },
  // Meal plan
  planDayCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 10 },
  planDayLabel: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  planSlotRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  planSlotLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, width: 70 },
  planSlotMeal: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  planSlotCals: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  planEmpty: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },
  // Empty
  emptyCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 32, alignItems: 'center', gap: 8 },
  emptyText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center' },
});
