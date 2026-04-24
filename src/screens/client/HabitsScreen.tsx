import React, { useEffect, useState, useCallback } from 'react';
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
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Colors } from '../../constants/colors';
import { getTodayString } from '../../utils/date';
import { habitsApi, checkInsApi } from '../../services/api';
import {
  DailyCheckIn,
  getDailyCheckIn,
  saveDailyCheckIn,
} from '../../db/habitsDb';

interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: string;
  targetCount: number;
  unit: string;
}

interface HabitLog {
  habitId: string;
  completed: boolean;
  count: number;
}

type TabMode = 'habits' | 'checkin';

const MOOD_LABELS = ['', 'Awful', 'Bad', 'Okay', 'Good', 'Great'];
const MOOD_EMOJIS = ['', '😞', '😕', '😐', '🙂', '😄'];
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

const HABIT_COLORS = [
  '#2D6A4F', '#52B788', '#4ECDC4', '#457B9D',
  '#E9C46A', '#E76F51', '#A78BFA', '#E63946',
  '#264653', '#6A4C93', '#F4A261', '#74C69D',
];

interface HabitWithMeta extends Habit {
  log: HabitLog | null;
  streak: number;
  weekDots: boolean[];
}

export default function HabitsScreen() {
  const currentUser = useCurrentUser();
  const [tab, setTab] = useState<TabMode>('habits');
  const [habits, setHabits] = useState<HabitWithMeta[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Check-in state
  const [_checkIn, setCheckIn] = useState<DailyCheckIn | null>(null);
  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [sleepHours, setSleepHours] = useState(7);
  const [sleepQuality, setSleepQuality] = useState(3);
  const [stress, setStress] = useState(3);
  const [notes, setNotes] = useState('');
  const [checkInSaved, setCheckInSaved] = useState(false);
  const [lastCheckInDate, setLastCheckInDate] = useState<string | null>(null);
  const [checkInToast, setCheckInToast] = useState(false);

  // Add habit form
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('checkmark-circle');
  const [newColor, setNewColor] = useState('#2D6A4F');
  const [newTarget, setNewTarget] = useState('1');
  const [newUnit, setNewUnit] = useState('times');

  const today = getTodayString();

  const loadHabits = useCallback(async () => {
    if (!currentUser) return;
    try {
      const habitsRes = await habitsApi.getAll();
      const allHabits: Habit[] = (habitsRes.data || []).map((h: any) => ({
        id: h.id,
        name: h.name,
        icon: h.icon || 'checkmark-circle',
        color: h.color || '#2D6A4F',
        frequency: h.frequency || 'daily',
        targetCount: h.target_count || h.targetCount || 1,
        unit: h.unit || 'times',
      }));

      // Load today's logs
      let logsMap = new Map<string, HabitLog>();
      try {
        const logsRes = await habitsApi.getLogs(today);
        const logs: HabitLog[] = (logsRes.data || []).map((l: any) => ({
          habitId: l.habit_id || l.habitId,
          completed: l.completed ?? false,
          count: l.count || 0,
        }));
        logsMap = new Map(logs.map((l) => [l.habitId, l]));
      } catch (err) {
        // Best-effort read: today's habit logs are optional; habits list
        // still renders with zero completions.
        console.error('HabitsScreen: habitsApi.getLogs failed', err);
      }

      // Load streaks
      let streaksMap = new Map<string, number>();
      try {
        const streaksRes = await habitsApi.getStreaks();
        const streaks = streaksRes.data || [];
        streaks.forEach((s: any) => {
          streaksMap.set(s.habit_id || s.habitId, s.streak || 0);
        });
      } catch (err) {
        // Best-effort: streaks display as 0 when unavailable.
        console.error('HabitsScreen: habitsApi.getStreaks failed', err);
      }

      const withMeta: HabitWithMeta[] = allHabits.map((h) => ({
        ...h,
        log: logsMap.get(h.id) || null,
        streak: streaksMap.get(h.id) || 0,
        weekDots: [false, false, false, false, false, false, false],
      }));
      setHabits(withMeta);
    } catch (err) {
      // Outer read failure (probably /habits list): we leave the existing
      // state in place. Empty screen on first load is acceptable.
      console.error('HabitsScreen: loadHabits failed', err);
    }
  }, [currentUser, today]);

  const loadCheckIn = useCallback(async () => {
    if (!currentUser) return;
    // Local cache seeds the form so the user sees their last-saved values even
    // if the server fetch is slow/fails. Server call below is the source of
    // truth for "last check-in" — if it succeeds with data for today, we use
    // those values instead.
    const cached = await getDailyCheckIn(currentUser.id, today);
    if (cached) {
      setCheckIn(cached);
      setMood(cached.mood);
      setEnergy(cached.energyLevel);
      setSleepHours(cached.sleepHours);
      setSleepQuality(cached.sleepQuality);
      setStress(cached.stressLevel);
      setNotes(cached.notes);
      setCheckInSaved(true);
    }
    try {
      const res = await checkInsApi.list({ limit: 7 });
      const rows: any[] = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.check_ins)
          ? res.data.check_ins
          : [];
      if (rows.length > 0) {
        const latest = rows[0];
        const latestDate: string = (latest?.date || '').slice(0, 10);
        setLastCheckInDate(latestDate || null);
        if (latestDate === today) {
          setCheckInSaved(true);
          if (latest.mood != null) setMood(Number(latest.mood));
          if (latest.energy != null) setEnergy(Number(latest.energy));
          if (latest.sleep_hours != null) setSleepHours(Number(latest.sleep_hours));
          if (latest.notes) setNotes(String(latest.notes));
        }
      }
    } catch (err) {
      // Best-effort — the form still works, just without the "last check-in"
      // banner. Local cache already hydrated the inputs above.
      console.error('HabitsScreen: checkInsApi.list failed', err);
    }
  }, [currentUser, today]);

  useEffect(() => {
    loadHabits();
    loadCheckIn();
  }, [loadHabits, loadCheckIn]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHabits();
    await loadCheckIn();
    setRefreshing(false);
  }, [loadHabits, loadCheckIn]);

  const handleToggle = async (habit: HabitWithMeta) => {
    if (!currentUser) return;
    try {
      const newCompleted = !(habit.log?.completed);
      await habitsApi.logHabit(habit.id, {
        date: today,
        completed: newCompleted,
        value: newCompleted ? (habit.targetCount || 1) : 0,
      });
    } catch (err: any) {
      // Destructive-ish write (optimistic toggle). Surface so the user knows
      // their tap didn't stick.
      console.error('HabitsScreen: handleToggle failed', err);
      Alert.alert("Couldn't update habit", err?.message || 'Please try again.');
    }
    await loadHabits();
  };

  const handleDelete = (habit: HabitWithMeta) => {
    Alert.alert('Delete Habit', `Remove "${habit.name}" from your habits?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // No delete endpoint in API — just reload
          // habitsApi doesn't expose delete, so we skip
          await loadHabits();
        },
      },
    ]);
  };

  const handleAddHabit = async () => {
    if (!currentUser || !newName.trim()) return;
    try {
      await habitsApi.create({
        name: newName.trim(),
        icon: newIcon,
        color: newColor,
        category: 'custom',
        frequency: 'daily',
        target_value: parseInt(newTarget) || 1,
        unit: newUnit || 'times',
      });
    } catch (err: any) {
      // Destructive write: surface failure so user can retry before the modal
      // closes and they think the habit was created.
      console.error('HabitsScreen: handleAddHabit failed', err);
      Alert.alert("Couldn't create habit", err?.message || 'Please try again.');
      return;
    }
    setShowAddModal(false);
    setNewName('');
    setNewIcon('checkmark-circle');
    setNewColor('#2D6A4F');
    setNewTarget('1');
    setNewUnit('times');
    await loadHabits();
  };

  const handleSaveCheckIn = async () => {
    if (!currentUser) return;
    // Server is the source of truth — if this fails, surface it instead of
    // silently persisting only locally (which is what got us in trouble pre-Tier-2).
    try {
      await checkInsApi.save({
        date: today,
        mood,
        energy,
        sleep_hours: sleepHours,
        notes: notes || null,
      });
    } catch (err: any) {
      console.error('HabitsScreen: checkInsApi.save failed', err);
      Alert.alert(
        "Couldn't save check-in",
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
      return;
    }
    // Keep the local cache in sync so offline reads still work.
    await saveDailyCheckIn({
      userId: currentUser.id,
      date: today,
      mood,
      energyLevel: energy,
      sleepHours,
      sleepQuality,
      stressLevel: stress,
      notes,
    });
    setCheckInSaved(true);
    setLastCheckInDate(today);
    setCheckInToast(true);
    setTimeout(() => setCheckInToast(false), 2200);
    await loadCheckIn();
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
            color={tab === 'habits' ? Colors.textOnPrimary : Colors.textSecondary}
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
            color={tab === 'checkin' ? Colors.textOnPrimary : Colors.textSecondary}
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
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
                      name={(habit.icon || 'checkmark-circle') as any}
                      size={22}
                      color={habit.color}
                    />
                  </View>
                  <View style={styles.habitInfo}>
                    <Text style={[styles.habitName, habit.log?.completed && styles.habitNameDone]}>
                      {habit.name}
                    </Text>
                    <View style={styles.habitMeta}>
                      {habit.streak > 0 && (
                        <View style={styles.streakBadge}>
                          <Ionicons name="flame" size={12} color={Colors.streak} />
                          <Text style={styles.streakText}>{habit.streak}d</Text>
                        </View>
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
                    <Ionicons name="checkmark" size={18} color={Colors.textOnPrimary} />
                  )}
                </View>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
              <Ionicons name="add-circle" size={22} color={Colors.primary} />
              <Text style={styles.addBtnText}>Add New Habit</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {checkInToast && (
              <View style={styles.savedBanner} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                <Text style={styles.savedBannerText}>Check-in saved</Text>
              </View>
            )}
            {!checkInToast && checkInSaved && (
              <View style={styles.savedBanner}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                <Text style={styles.savedBannerText}>Today's check-in saved!</Text>
              </View>
            )}
            {lastCheckInDate && lastCheckInDate !== today && (
              <View style={styles.lastCheckInRow}>
                <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
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
                      color={energy === val ? Colors.primary : Colors.textMuted}
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
                      <Ionicons name="remove" size={18} color={Colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{sleepHours}h</Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setSleepHours((h) => Math.min(14, h + 0.5))}
                    >
                      <Ionicons name="add" size={18} color={Colors.textPrimary} />
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
                          color={val <= sleepQuality ? Colors.warning : Colors.textMuted}
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
                            val <= 2 ? Colors.primary : val === 3 ? Colors.warning : Colors.error,
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
                placeholderTextColor={Colors.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
                maxLength={500}
              />
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCheckIn}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.textOnPrimary} />
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
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Habit Name</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. Drink 8 glasses of water"
              placeholderTextColor={Colors.textMuted}
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
                    name={item.icon as any}
                    size={20}
                    color={newIcon === item.icon ? Colors.primary : Colors.textMuted}
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
                  placeholderTextColor={Colors.textMuted}
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
                  placeholderTextColor={Colors.textMuted}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 24, paddingTop: 60, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
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
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabLabel: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  tabLabelActive: { color: Colors.textOnPrimary },
  dotBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error,
  },
  scrollContent: { paddingHorizontal: 24 },
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    gap: 20,
  },
  progressCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressPct: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  progressLabel: { fontSize: 11, color: Colors.textSecondary },
  progressStats: { flex: 1, gap: 6 },
  progressStatValue: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  progressStatLabel: { fontSize: 13, color: Colors.textSecondary },
  progressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  habitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  habitLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  habitIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  habitInfo: { flex: 1, gap: 4 },
  habitName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  habitNameDone: { textDecorationLine: 'line-through', color: Colors.textMuted },
  habitMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  streakText: { fontSize: 12, fontWeight: '600', color: Colors.streak },
  habitTarget: { fontSize: 12, color: Colors.textMuted },
  weekDots: { flexDirection: 'row', gap: 6, marginTop: 4 },
  weekDotCol: { alignItems: 'center', gap: 2 },
  weekDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  weekDotLabel: { fontSize: 9, color: Colors.textMuted },
  checkCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addBtnText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryPale,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  savedBannerText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  lastCheckInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  lastCheckInText: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  checkInCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  checkInLabel: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  ratingRow: { flexDirection: 'row', justifyContent: 'space-between' },
  ratingBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 12,
    flex: 1,
  },
  ratingBtnActive: {
    backgroundColor: Colors.primaryPale,
  },
  ratingEmoji: { fontSize: 22 },
  ratingLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  ratingLabelActive: { color: Colors.primary, fontWeight: '700' },
  sleepRow: { flexDirection: 'row', gap: 20 },
  sleepControl: { flex: 1 },
  sleepLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValue: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, minWidth: 50, textAlign: 'center' },
  qualityRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  stressDot: { width: 16, height: 16, borderRadius: 8, marginBottom: 4 },
  notesInput: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: Colors.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 8,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.textOnPrimary },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 12 },
  fieldInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconOption: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryPale },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorOption: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  colorOptionActive: { borderWidth: 3, borderColor: Colors.textPrimary },
  targetRow: { flexDirection: 'row', gap: 12 },
  targetField: { flex: 1 },
  modalSaveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  modalSaveBtnDisabled: { opacity: 0.5 },
  modalSaveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.textOnPrimary },
});
