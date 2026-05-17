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
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getTodayString } from '../../utils/date';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { errorMessage, type IoniconName } from '../../types/common';
import { Colors } from '../../constants/colors';
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

interface HabitView {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: string;
  targetCount: number;
  unit: string;
  log: { completed: boolean; count: number } | null;
  runDays: number;
  weekDots: boolean[];
}

type TabMode = 'habits' | 'checkin';

const MOOD_LABELS = ['', 'Awful', 'Bad', 'Okay', 'Good', 'Great'];
const MOOD_EMOJIS = ['', 'low', 'off', 'flat', 'good', 'strong'];
const ENERGY_LABELS = ['', 'Exhausted', 'Low', 'Normal', 'High', 'Energized'];
const STRESS_LABELS = ['', 'Minimal', 'Low', 'Moderate', 'High', 'Extreme'];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const HABIT_ICONS: { icon: string; label: string }[] = [
  { icon: 'water', label: 'Water' },
  { icon: 'medical', label: 'Vitamins' },
  { icon: 'leaf', label: 'Veggies' },
  { icon: 'walk', label: 'Steps' },
  { icon: 'body', label: 'Stretch' },
  { icon: 'book', label: 'Read' },
  { icon: 'happy', label: 'Meditate' },
  { icon: 'close-circle', label: 'Avoid' },
  { icon: 'barbell', label: 'Exercise' },
  { icon: 'bed', label: 'Sleep' },
  { icon: 'nutrition', label: 'Eat' },
  { icon: 'checkmark-circle', label: 'Custom' },
];

// Habit colour palette — picker swatches the user assigns per habit.
// Pulled from the new bone/forest palette plus muted secondaries so the
// chosen colour reads as a quiet luxury accent rather than a neon tag.
function makeHABIT_COLORS(colors: ThemeColors) {
  return [
  colors.primary,        // forest (default)
  colors.primaryDark,    // deep forest
  colors.primaryLight,   // pale forest
  colors.info,           // muted blue
  colors.warning,        // mutedGold
  Colors.border,             // camel
  Colors.templateMobility,             // muted lavender
  Colors.noticeCriticalAccent,             // muted oxblood
  Colors.muscleCore,             // deep teal
  Colors.textSecondary, // charcoal grey
  Colors.textMuted,             // stone
  Colors.primaryLight,             // mid forest
];
}

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
              <TouchableOpacity
                key={habit.id}
                style={styles.habitCard}
                onPress={() => handleToggle(habit)}
                onLongPress={() => handleDelete(habit)}
                activeOpacity={0.7}
              >
                <View style={styles.habitLeft}>
                  <View style={[styles.habitIconBox, { backgroundColor: habit.color + '20' }]}>
                    <Ionicons
                      name={(habit.icon || 'checkmark-circle') as IoniconName}
                      size={22}
                      color={habit.color}
                    />
                  </View>
                  <View style={styles.habitInfo}>
                    <Text style={[styles.habitName, habit.log?.completed && styles.habitNameDone]}>
                      {habit.name}
                    </Text>
                    <View style={styles.habitMeta}>
                      {habit.runDays > 0 && (
                        <Text style={styles.runText}>· {habit.runDays}d</Text>
                      )}
                      <Text style={styles.habitTarget}>
                        {habit.targetCount > 1
                          ? `${habit.log?.count || 0}/${habit.targetCount} ${habit.unit}`
                          : habit.unit}
                      </Text>
                    </View>
                    <View style={styles.weekDots}>
                      {habit.weekDots.map((done, i) => (
                        <View key={i} style={styles.weekDotCol}>
                          <View
                            style={[
                              styles.weekDot,
                              done && { backgroundColor: habit.color },
                            ]}
                          />
                          <Text style={styles.weekDotLabel}>{DAY_LABELS[i]}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
                <View
                  style={[
                    styles.checkCircle,
                    habit.log?.completed && { backgroundColor: habit.color, borderColor: habit.color },
                  ]}
                >
                  {habit.log?.completed && (
                    <Ionicons name="checkmark" size={18} color={colors.textOnPrimary} />
                  )}
                </View>
              </TouchableOpacity>
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

            {/* Mood */}
            <View style={styles.checkInCard}>
              <Text style={styles.checkInLabel}>How are you feeling?</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[styles.ratingBtn, mood === val && styles.ratingBtnActive]}
                    onPress={() => setMood(val)}
                  >
                    <Text style={styles.ratingEmoji}>{MOOD_EMOJIS[val]}</Text>
                    <Text style={[styles.ratingLabel, mood === val && styles.ratingLabelActive]}>
                      {MOOD_LABELS[val]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Energy */}
            <View style={styles.checkInCard}>
              <Text style={styles.checkInLabel}>Energy Level</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[styles.ratingBtn, energy === val && styles.ratingBtnActive]}
                    onPress={() => setEnergy(val)}
                  >
                    <Ionicons
                      name="flash"
                      size={20}
                      color={energy === val ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.ratingLabel, energy === val && styles.ratingLabelActive]}>
                      {ENERGY_LABELS[val]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Sleep */}
            <View style={styles.checkInCard}>
              <Text style={styles.checkInLabel}>Sleep</Text>
              <View style={styles.sleepRow}>
                <View style={styles.sleepControl}>
                  <Text style={styles.sleepLabel}>Hours</Text>
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setSleepHours((h) => Math.max(0, h - 0.5))}
                    >
                      <Ionicons name="remove" size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{sleepHours}h</Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setSleepHours((h) => Math.min(14, h + 0.5))}
                    >
                      <Ionicons name="add" size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.sleepControl}>
                  <Text style={styles.sleepLabel}>Quality</Text>
                  <View style={styles.qualityRow}>
                    {[1, 2, 3, 4, 5].map((val) => (
                      <TouchableOpacity key={val} onPress={() => setSleepQuality(val)}>
                        <Ionicons
                          name={val <= sleepQuality ? 'star' : 'star-outline'}
                          size={22}
                          color={val <= sleepQuality ? colors.warning : colors.textMuted}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            </View>

            {/* Stress */}
            <View style={styles.checkInCard}>
              <Text style={styles.checkInLabel}>Stress Level</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[styles.ratingBtn, stress === val && styles.ratingBtnActive]}
                    onPress={() => setStress(val)}
                  >
                    <View
                      style={[
                        styles.stressDot,
                        {
                          backgroundColor:
                            val <= 2 ? colors.primary : val === 3 ? colors.warning : colors.error,
                          opacity: stress === val ? 1 : 0.4,
                        },
                      ]}
                    />
                    <Text style={[styles.ratingLabel, stress === val && styles.ratingLabelActive]}>
                      {STRESS_LABELS[val]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Notes */}
            <View style={styles.checkInCard}>
              <Text style={styles.checkInLabel}>Notes</Text>
              <TextInput
                style={styles.notesInput}
                placeholder="How's your day going? Anything noteworthy?"
                placeholderTextColor={colors.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
                maxLength={500}
              />
            </View>

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

      {/* Add Habit Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Habit</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Habit Name</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. Drink 8 glasses of water"
              placeholderTextColor={colors.textMuted}
              value={newName}
              onChangeText={setNewName}
              maxLength={60}
            />

            <Text style={styles.fieldLabel}>Icon</Text>
            <View style={styles.iconGrid}>
              {HABIT_ICONS.map((item) => (
                <TouchableOpacity
                  key={item.icon}
                  style={[styles.iconOption, newIcon === item.icon && styles.iconOptionActive]}
                  onPress={() => setNewIcon(item.icon)}
                >
                  <Ionicons
                    name={item.icon as IoniconName}
                    size={20}
                    color={newIcon === item.icon ? colors.primary : colors.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Color</Text>
            <View style={styles.colorGrid}>
              {HABIT_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorOption, { backgroundColor: c }, newColor === c && styles.colorOptionActive]}
                  onPress={() => setNewColor(c)}
                />
              ))}
            </View>

            <View style={styles.targetRow}>
              <View style={styles.targetField}>
                <Text style={styles.fieldLabel}>Target</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                  value={newTarget}
                  onChangeText={setNewTarget}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.targetField}>
                <Text style={styles.fieldLabel}>Unit</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="times"
                  placeholderTextColor={colors.textMuted}
                  value={newUnit}
                  onChangeText={setNewUnit}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.modalSaveBtn, !newName.trim() && styles.modalSaveBtnDisabled]}
              onPress={handleAddHabit}
              disabled={!newName.trim()}
            >
              <Text style={styles.modalSaveBtnText}>Add Habit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors, sc: SemanticTokens) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: sc.bgPrimary },
  header: { paddingHorizontal: 24, paddingTop: 60, marginBottom: 8 },
  title: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 1.98,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: 8,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 12,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  tabLabelActive: { color: colors.textOnPrimary },
  dotBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  scrollContent: { paddingHorizontal: 24 },
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 20,
    marginBottom: 16,
    gap: 20,
  },
  progressCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressPct: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.primary,
  },
  progressLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  progressStats: { flex: 1, gap: 6 },
  progressStatValue: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  progressStatLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  progressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  habitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    marginBottom: 10,
  },
  habitLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  habitIconBox: {
    width: 44,
    height: 44,
    borderRadius: 2, // radius.md
    justifyContent: 'center',
    alignItems: 'center',
  },
  habitInfo: { flex: 1, gap: 4 },
  habitName: { fontFamily: 'Inter_500Medium', fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  habitNameDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  habitMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  runText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted },
  habitTarget: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted },
  weekDots: { flexDirection: 'row', gap: 6, marginTop: 4 },
  weekDotCol: { alignItems: 'center', gap: 2 },
  weekDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  weekDotLabel: { fontSize: 9, color: colors.textMuted },
  checkCircle: {
    width: 30,
    height: 30,
    borderRadius: 4, // radius.lg
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 4, // radius.lg
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primaryPale,
    padding: 12,
    borderRadius: 2, // radius.md
    marginBottom: 16,
  },
  savedBannerText: { fontFamily: 'Inter_500Medium', fontSize: 13, fontWeight: '500', color: colors.primary },
  lastCheckInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  lastCheckInText: { fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.textMuted, fontWeight: '500', letterSpacing: 1.5, textTransform: 'uppercase' },
  checkInCard: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 12,
  },
  checkInLabel: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  ratingRow: { flexDirection: 'row', justifyContent: 'space-between' },
  ratingBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 2, // radius.md
    flex: 1,
  },
  ratingBtnActive: {
    backgroundColor: colors.primaryPale,
  },
  ratingEmoji: { fontSize: 22 },
  ratingLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: 4,
  },
  ratingLabelActive: { color: colors.primary, fontWeight: '500' },
  sleepRow: { flexDirection: 'row', gap: 20 },
  sleepControl: { flex: 1 },
  sleepLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: 8,
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValue: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    minWidth: 50,
    textAlign: 'center',
  },
  qualityRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  stressDot: { width: 16, height: 16, borderRadius: 0, marginBottom: 4 },
  notesInput: {
    backgroundColor: colors.background,
    borderRadius: 2, // radius.md
    padding: 14,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
    marginTop: 8,
  },
  saveBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textOnPrimary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,26,24,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: 0.5,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  fieldLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.98,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: 8,
    marginTop: 12,
  },
  fieldInput: {
    backgroundColor: colors.surface,
    borderRadius: 2, // radius.md
    padding: 14,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconOption: {
    width: 40,
    height: 40,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconOptionActive: { borderColor: colors.primary, backgroundColor: colors.primaryPale },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorOption: {
    width: 32,
    height: 32,
    borderRadius: 4, // radius.lg
  },
  colorOptionActive: { borderWidth: 3, borderColor: colors.textPrimary },
  targetRow: { flexDirection: 'row', gap: 12 },
  targetField: { flex: 1 },
  modalSaveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  modalSaveBtnDisabled: { opacity: 0.5 },
  modalSaveBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textOnPrimary,
  },

  });
