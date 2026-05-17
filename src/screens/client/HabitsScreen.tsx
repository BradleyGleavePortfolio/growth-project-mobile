/**
 * HabitsScreen — API-first via React Query (Fix #2).
 *
 * Reads come exclusively from the backend through useHabits / useHabitLogs /
 * useTodayCheckIn. Writes use useLogHabit / useCreateHabit /
 * useSaveCheckIn mutations, which auto-invalidate the relevant query keys.
 *
 * The local-SQLite functions (getDailyCheckIn / saveDailyCheckIn / seedHabits)
 * are no longer referenced — the persisted React Query cache (24h max) covers
 * offline reads, and the server is the single source of truth for writes.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getTodayString } from '../../utils/date';
import { useTheme } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import {
  useHabits,
  useHabitLogs,
  useLogHabit,
  useCreateHabit,
  useDeleteHabit,
  useTodayCheckIn,
  useSaveCheckIn,
  type ApiHabit,
  type ApiHabitLog,
} from '../../hooks/useApi';

import { makeStyles } from './habits/styles';
import { makeHABIT_COLORS, type HabitView, type TabMode } from './habits/constants';
import { HabitCard } from './habits/HabitCard';
import { MoodEnergyPicker } from './habits/MoodEnergyPicker';
import { AddHabitSheet } from './habits/AddHabitSheet';

export default function HabitsScreen() {
  const { colors, semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(colors, sc), [colors, sc]);
  const HABIT_COLORS = useMemo(() => makeHABIT_COLORS(colors), [colors]);
  const today = getTodayString();
  const [tab, setTab] = useState<TabMode>('habits');
  const [showAddModal, setShowAddModal] = useState(false);

  // Server reads (React Query)
  const habitsQ = useHabits();
  const logsQ = useHabitLogs(today);
  const todayCheckInQ = useTodayCheckIn(today);

  // Server writes
  const logHabit = useLogHabit();
  const createHabit = useCreateHabit();
  const deleteHabit = useDeleteHabit();
  const saveCheckIn = useSaveCheckIn();

  // Check-in form state — hydrated from server, edited locally before save.
  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [sleepHours, setSleepHours] = useState(7);
  const [sleepQuality, setSleepQuality] = useState(3);
  const [stress, setStress] = useState(3);
  const [notes, setNotes] = useState('');
  const [checkInToast, setCheckInToast] = useState(false);
  const [lastCheckInDate, setLastCheckInDate] = useState<string | null>(null);

  // Add-habit modal form
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('checkmark-circle');
  const [newColor, setNewColor] = useState(colors.primary);
  const [newTarget, setNewTarget] = useState('1');
  const [newUnit, setNewUnit] = useState('times');

  // Hydrate the form from today's check-in once the query resolves.
  useEffect(() => {
    const row = todayCheckInQ.data as
      | {
          mood?: number;
          energy?: number;
          sleep_hours?: number;
          sleep_quality?: number;
          stress?: number;
          notes?: string;
          date?: string;
        }
      | null
      | undefined;
    if (!row) return;
    if (row.mood != null) setMood(Number(row.mood));
    if (row.energy != null) setEnergy(Number(row.energy));
    if (row.sleep_hours != null) setSleepHours(Number(row.sleep_hours));
    if (row.sleep_quality != null) setSleepQuality(Number(row.sleep_quality));
    if (row.stress != null) setStress(Number(row.stress));
    if (row.notes) setNotes(String(row.notes));
    if (row.date) setLastCheckInDate(String(row.date).slice(0, 10));
  }, [todayCheckInQ.data]);

  // Build the per-habit view model from three independent queries.
  // Server rows may carry extra cosmetic fields the ApiHabit type does not yet
  // model. Read them through Record indexing rather than any-typing the row.
  const allHabits = (habitsQ.data || []).map((row) => {
    const h = row as ApiHabit & Partial<{ icon: string; color: string; frequency: string; target_count: number; target_value: number; unit: string; emoji: string }>;
    return {
      id: h.id,
      name: h.name,
      icon: h.icon || h.emoji || 'checkmark-circle',
      color: h.color || colors.primary,
      frequency: h.frequency || 'daily',
      targetCount: h.target_count || h.target_value || 1,
      unit: h.unit || 'times',
    };
  });
  const logsMap = new Map<string, { completed: boolean; count: number }>(
    (logsQ.data || []).map((row) => {
      const l = row as ApiHabitLog & Partial<{ habitId: string; count: number }>;
      return [
        l.habit_id || l.habitId || '',
        { completed: l.completed ?? false, count: l.count || 0 },
      ] as [string, { completed: boolean; count: number }];
    }),
  );
  const habits: HabitView[] = allHabits.map((h) => ({
    ...h,
    log: logsMap.get(h.id) || null,
    runDays: 0,
    weekDots: [false, false, false, false, false, false, false],
  }));

  const refreshing =
    habitsQ.isRefetching || logsQ.isRefetching || todayCheckInQ.isRefetching;

  const onRefresh = () => {
    habitsQ.refetch();
    logsQ.refetch();
    todayCheckInQ.refetch();
  };

  const checkInSaved = !!todayCheckInQ.data;

  const handleToggle = (habit: HabitView) => {
    const newCompleted = !habit.log?.completed;
    logHabit.mutate(
      {
        id: habit.id,
        date: today,
        completed: newCompleted,
        value: newCompleted ? habit.targetCount || 1 : 0,
      },
      {
        onError: (err) => {
          Alert.alert("Couldn't update habit", errorMessage(err, 'Please try again.'));
        },
      },
    );
  };

  const handleDelete = (habit: HabitView) => {
    Alert.alert(
      'Delete Habit',
      `Are you sure you want to delete "${habit.name}"? This will remove the habit and all its history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteHabit.mutate(habit.id, {
              onError: (err) => {
                Alert.alert("Couldn't delete habit", errorMessage(err, 'Please try again.'));
              },
            });
          },
        },
      ],
    );
  };

  const handleAddHabit = () => {
    if (!newName.trim()) return;
    createHabit.mutate(
      {
        name: newName.trim(),
        icon: newIcon,
        color: newColor,
        category: 'custom',
        frequency: 'daily',
        target_value: parseInt(newTarget) || 1,
        unit: newUnit || 'times',
      },
      {
        onSuccess: () => {
          setShowAddModal(false);
          setNewName('');
          setNewIcon('checkmark-circle');
          setNewColor(colors.primary);
          setNewTarget('1');
          setNewUnit('times');
        },
        onError: (err) => {
          Alert.alert("Couldn't create habit", errorMessage(err, 'Please try again.'));
        },
      },
    );
  };

  const handleSaveCheckIn = () => {
    saveCheckIn.mutate(
      {
        date: today,
        mood,
        energy,
        sleep_hours: sleepHours,
        // B10: previously dropped on the floor; the form collected these
        // values but the mutation payload omitted them, so the coach
        // dashboard never saw stress/sleep_quality.
        sleep_quality: sleepQuality,
        stress,
        notes: notes || null,
      },
      {
        onSuccess: () => {
          setLastCheckInDate(today);
          setCheckInToast(true);
          setTimeout(() => setCheckInToast(false), 2200);
        },
        onError: (err) => {
          Alert.alert("Couldn't save check-in", errorMessage(err, 'Please try again.'));
        },
      },
    );
  };

  const completedCount = habits.filter((h) => h.log?.completed).length;
  const completionPct = habits.length > 0 ? Math.round((completedCount / habits.length) * 100) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Habits & Check-in</Text>
        <Text style={styles.subtitle}>
          {new Date(today + 'T00:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'habits' && styles.tabBtnActive]}
          onPress={() => setTab('habits')}
        >
          <Ionicons
            name="checkmark-done"
            size={16}
            color={tab === 'habits' ? colors.textOnPrimary : colors.textSecondary}
          />
          <Text style={[styles.tabLabel, tab === 'habits' && styles.tabLabelActive]}>
            Habits
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'checkin' && styles.tabBtnActive]}
          onPress={() => setTab('checkin')}
        >
          <Ionicons
            name="heart"
            size={16}
            color={tab === 'checkin' ? colors.textOnPrimary : colors.textSecondary}
          />
          <Text style={[styles.tabLabel, tab === 'checkin' && styles.tabLabelActive]}>
            Daily Check-in
          </Text>
          {!checkInSaved && (
            <View style={styles.dotBadge} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {tab === 'habits' ? (
          <>
            {/* Progress */}
            <View style={styles.progressCard}>
              <View style={styles.progressCircle}>
                <Text style={styles.progressPct}>{completionPct}%</Text>
                <Text style={styles.progressLabel}>Done</Text>
              </View>
              <View style={styles.progressStats}>
                <Text style={styles.progressStatValue}>
                  {completedCount}/{habits.length}
                </Text>
                <Text style={styles.progressStatLabel}>habits completed</Text>
                <View style={styles.progressBar}>
                  <View style={[styles.progressBarFill, { width: `${completionPct}%` }]} />
                </View>
              </View>
            </View>

            {/* Habit Cards */}
            {habits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                onToggle={handleToggle}
                onLongPress={handleDelete}
                colors={colors}
                styles={styles}
              />
            ))}

            <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
              <Ionicons name="add-circle" size={22} color={colors.primary} />
              <Text style={styles.addBtnText}>Add New Habit</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {checkInToast && (
              <View style={styles.savedBanner} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                <Text style={styles.savedBannerText}>Check-in saved</Text>
              </View>
            )}
            {!checkInToast && checkInSaved && (
              <View style={styles.savedBanner}>
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                <Text style={styles.savedBannerText}>Saved.</Text>
              </View>
            )}
            {lastCheckInDate && lastCheckInDate !== today && (
              <View style={styles.lastCheckInRow}>
                <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                <Text style={styles.lastCheckInText}>
                  Last check-in: {new Date(lastCheckInDate + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            )}

            <MoodEnergyPicker
              mood={mood}
              setMood={setMood}
              energy={energy}
              setEnergy={setEnergy}
              sleepHours={sleepHours}
              setSleepHours={setSleepHours}
              sleepQuality={sleepQuality}
              setSleepQuality={setSleepQuality}
              stress={stress}
              setStress={setStress}
              notes={notes}
              setNotes={setNotes}
              colors={colors}
              styles={styles}
            />

            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCheckIn}>
              <Ionicons name="checkmark-circle" size={20} color={colors.textOnPrimary} />
              <Text style={styles.saveBtnText}>
                {checkInSaved ? 'Update Check-in' : 'Save Check-in'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <AddHabitSheet
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        newName={newName}
        setNewName={setNewName}
        newIcon={newIcon}
        setNewIcon={setNewIcon}
        newColor={newColor}
        setNewColor={setNewColor}
        newTarget={newTarget}
        setNewTarget={setNewTarget}
        newUnit={newUnit}
        setNewUnit={setNewUnit}
        HABIT_COLORS={HABIT_COLORS}
        onAdd={handleAddHabit}
        colors={colors}
        styles={styles}
      />
    </View>
  );
}
