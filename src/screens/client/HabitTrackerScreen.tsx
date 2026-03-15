import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { Colors } from '../../constants/colors';
import FadeInView from '../../components/FadeInView';
import { getTodayString } from '../../utils/date';
import {
  Habit,
  HabitLog,
  DailyCheckIn,
  getHabits,
  getHabitLogsForDate,
  toggleHabit,
  getHabitStreak,
  getWeekCompletions,
  createHabit,
  deleteHabit,
  seedHabitsIfNeeded,
  getDailyCheckIn,
  saveDailyCheckIn,
} from '../../db/habitsDb';

const MOOD_LABELS = ['', 'Awful', 'Bad', 'Okay', 'Good', 'Great'];
const MOOD_EMOJIS = ['', '😞', '😕', '😐', '🙂', '😁'];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const HABIT_ICONS: Record<string, string> = {
  water: 'water',
  medical: 'medical',
  leaf: 'leaf',
  walk: 'walk',
  body: 'body',
  'close-circle': 'close-circle',
  book: 'book',
  happy: 'happy',
  'checkmark-circle': 'checkmark-circle',
  fitness: 'fitness',
  restaurant: 'restaurant',
  bed: 'bed',
  heart: 'heart',
};

interface HabitWithMeta extends Habit {
  completed: boolean;
  streak: number;
  weekDots: boolean[];
}

export default function HabitTrackerScreen() {
  const { currentUser } = useAuthStore();
  const [habits, setHabits] = useState<HabitWithMeta[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newHabitName, setNewHabitName] = useState('');
  const [newHabitIcon, setNewHabitIcon] = useState('checkmark-circle');
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [checkin, setCheckin] = useState<DailyCheckIn | null>(null);
  const [checkinForm, setCheckinForm] = useState({
    mood: 3,
    energyLevel: 3,
    sleepHours: 7,
    sleepQuality: 3,
    stressLevel: 2,
    notes: '',
  });

  const today = getTodayString();

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    await seedHabitsIfNeeded(currentUser.id);
    const [rawHabits, logs] = await Promise.all([
      getHabits(currentUser.id),
      getHabitLogsForDate(currentUser.id, today),
    ]);

    const enriched: HabitWithMeta[] = await Promise.all(
      rawHabits.map(async (h) => {
        const log = logs.find((l) => l.habitId === h.id);
        const streak = await getHabitStreak(h.id, currentUser.id);
        const weekDots = await getWeekCompletions(currentUser.id, h.id);
        return { ...h, completed: !!log?.completed, streak, weekDots };
      })
    );

    setHabits(enriched);

    const existing = await getDailyCheckIn(currentUser.id, today);
    setCheckin(existing);
    if (existing) {
      setCheckinForm({
        mood: existing.mood,
        energyLevel: existing.energyLevel,
        sleepHours: existing.sleepHours,
        sleepQuality: existing.sleepQuality,
        stressLevel: existing.stressLevel,
        notes: existing.notes,
      });
    }
    setLoading(false);
  }, [currentUser?.id, today]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleToggle = async (habit: HabitWithMeta) => {
    if (!currentUser) return;
    const result = await toggleHabit(currentUser.id, habit.id, today, habit.targetCount);
    setHabits((prev) =>
      prev.map((h) =>
        h.id === habit.id
          ? {
              ...h,
              completed: result.completed,
              streak: result.completed ? h.streak + 1 : Math.max(0, h.streak - 1),
            }
          : h
      )
    );
  };

  const handleAddHabit = async () => {
    if (!currentUser || !newHabitName.trim()) return;
    const colors = ['#4ECDC4', '#E76F51', '#2D6A4F', '#E9C46A', '#52B788', '#A78BFA', '#264653', '#E63946'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await createHabit({
      userId: currentUser.id,
      name: newHabitName.trim(),
      icon: newHabitIcon,
      color,
      frequency: 'daily',
      targetCount: 1,
      unit: 'times',
    });
    setNewHabitName('');
    setNewHabitIcon('checkmark-circle');
    setShowAddModal(false);
    await loadData();
  };

  const handleDeleteHabit = async (habitId: string) => {
    await deleteHabit(habitId);
    setHabits((prev) => prev.filter((h) => h.id !== habitId));
  };

  const handleSaveCheckin = async () => {
    if (!currentUser) return;
    await saveDailyCheckIn({
      userId: currentUser.id,
      date: today,
      ...checkinForm,
    });
    const saved = await getDailyCheckIn(currentUser.id, today);
    setCheckin(saved);
    setShowCheckinModal(false);
  };

  const completedCount = habits.filter((h) => h.completed).length;
  const completionPct = habits.length > 0 ? Math.round((completedCount / habits.length) * 100) : 0;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading habits...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        <FadeInView>
          <View style={styles.header}>
            <Text style={styles.title}>Habits</Text>
            <Text style={styles.subtitle}>{today}</Text>
          </View>
        </FadeInView>

        {/* Daily Progress Ring */}
        <FadeInView delay={100}>
          <View style={styles.progressCard}>
            <View style={styles.progressCircle}>
              <Text style={styles.progressPct}>{completionPct}%</Text>
            </View>
            <View style={styles.progressInfo}>
              <Text style={styles.progressLabel}>
                {completedCount} of {habits.length} completed
              </Text>
              <Text style={styles.progressSubLabel}>
                {completionPct === 100 ? 'All done today!' : 'Keep going!'}
              </Text>
            </View>
          </View>
        </FadeInView>

        {/* Check-in Banner */}
        <FadeInView delay={150}>
          <TouchableOpacity
            style={[styles.checkinBanner, checkin && styles.checkinBannerDone]}
            onPress={() => setShowCheckinModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.checkinBannerLeft}>
              <Ionicons
                name={checkin ? 'checkmark-circle' : 'sunny-outline'}
                size={28}
                color={checkin ? Colors.primary : Colors.warning}
              />
              <View>
                <Text style={styles.checkinBannerTitle}>
                  {checkin ? 'Check-in Complete' : 'Daily Check-in'}
                </Text>
                <Text style={styles.checkinBannerSub}>
                  {checkin
                    ? `Mood: ${MOOD_EMOJIS[checkin.mood]}  Energy: ${checkin.energyLevel}/5  Sleep: ${checkin.sleepHours}h`
                    : 'Log your mood, energy & sleep'}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </FadeInView>

        {/* Habit Cards */}
        <FadeInView delay={200}>
          <View style={styles.habitsSection}>
            <Text style={styles.sectionTitle}>Today's Habits</Text>
            {habits.map((habit) => (
              <TouchableOpacity
                key={habit.id}
                style={[styles.habitCard, habit.completed && styles.habitCardDone]}
                onPress={() => handleToggle(habit)}
                onLongPress={() => handleDeleteHabit(habit.id)}
                activeOpacity={0.7}
              >
                <View style={styles.habitLeft}>
                  <View style={[styles.habitIcon, { backgroundColor: habit.color + '20' }]}>
                    <Ionicons
                      name={(HABIT_ICONS[habit.icon] || 'checkmark-circle') as any}
                      size={22}
                      color={habit.color}
                    />
                  </View>
                  <View style={styles.habitInfo}>
                    <Text style={[styles.habitName, habit.completed && styles.habitNameDone]}>
                      {habit.name}
                    </Text>
                    <View style={styles.weekDotsRow}>
                      {habit.weekDots.map((done, i) => (
                        <View
                          key={i}
                          style={[
                            styles.weekDot,
                            done && { backgroundColor: habit.color },
                          ]}
                        >
                          <Text style={[styles.weekDotLabel, done && styles.weekDotLabelDone]}>
                            {DAY_LABELS[i]}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
                <View style={styles.habitRight}>
                  {habit.streak > 0 && (
                    <View style={styles.streakBadge}>
                      <Text style={styles.streakText}>{habit.streak}d</Text>
                    </View>
                  )}
                  <View
                    style={[
                      styles.checkCircle,
                      habit.completed && { backgroundColor: habit.color, borderColor: habit.color },
                    ]}
                  >
                    {habit.completed && (
                      <Ionicons name="checkmark" size={16} color="#fff" />
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </FadeInView>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowAddModal(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add Habit Modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Habit</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Habit name"
              placeholderTextColor={Colors.textMuted}
              value={newHabitName}
              onChangeText={setNewHabitName}
              maxLength={40}
            />
            <Text style={styles.modalLabel}>Icon</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.iconPicker}>
              {Object.keys(HABIT_ICONS).map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconOption,
                    newHabitIcon === icon && styles.iconOptionSelected,
                  ]}
                  onPress={() => setNewHabitIcon(icon)}
                >
                  <Ionicons name={icon as any} size={24} color={newHabitIcon === icon ? Colors.primary : Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, !newHabitName.trim() && styles.modalSaveBtnDisabled]}
                onPress={handleAddHabit}
                disabled={!newHabitName.trim()}
              >
                <Text style={styles.modalSaveText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Check-in Modal */}
      <Modal visible={showCheckinModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Daily Check-in</Text>

              {/* Mood */}
              <Text style={styles.modalLabel}>How are you feeling?</Text>
              <View style={styles.emojiRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.emojiBtn,
                      checkinForm.mood === val && styles.emojiBtnSelected,
                    ]}
                    onPress={() => setCheckinForm((p) => ({ ...p, mood: val }))}
                  >
                    <Text style={styles.emojiText}>{MOOD_EMOJIS[val]}</Text>
                    <Text style={styles.emojiLabel}>{MOOD_LABELS[val]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Energy */}
              <Text style={styles.modalLabel}>Energy Level</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.ratingBtn,
                      checkinForm.energyLevel === val && styles.ratingBtnSelected,
                    ]}
                    onPress={() => setCheckinForm((p) => ({ ...p, energyLevel: val }))}
                  >
                    <Text
                      style={[
                        styles.ratingText,
                        checkinForm.energyLevel === val && styles.ratingTextSelected,
                      ]}
                    >
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Sleep Hours */}
              <Text style={styles.modalLabel}>Hours of Sleep</Text>
              <View style={styles.sleepRow}>
                {[5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.sleepBtn,
                      checkinForm.sleepHours === val && styles.sleepBtnSelected,
                    ]}
                    onPress={() => setCheckinForm((p) => ({ ...p, sleepHours: val }))}
                  >
                    <Text
                      style={[
                        styles.sleepText,
                        checkinForm.sleepHours === val && styles.sleepTextSelected,
                      ]}
                    >
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Sleep Quality */}
              <Text style={styles.modalLabel}>Sleep Quality</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.ratingBtn,
                      checkinForm.sleepQuality === val && styles.ratingBtnSelected,
                    ]}
                    onPress={() => setCheckinForm((p) => ({ ...p, sleepQuality: val }))}
                  >
                    <Text
                      style={[
                        styles.ratingText,
                        checkinForm.sleepQuality === val && styles.ratingTextSelected,
                      ]}
                    >
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Stress */}
              <Text style={styles.modalLabel}>Stress Level</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.ratingBtn,
                      checkinForm.stressLevel === val && styles.ratingBtnSelected,
                    ]}
                    onPress={() => setCheckinForm((p) => ({ ...p, stressLevel: val }))}
                  >
                    <Text
                      style={[
                        styles.ratingText,
                        checkinForm.stressLevel === val && styles.ratingTextSelected,
                      ]}
                    >
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Notes */}
              <Text style={styles.modalLabel}>Notes (optional)</Text>
              <TextInput
                style={styles.notesInput}
                placeholder="Any thoughts for the day..."
                placeholderTextColor={Colors.textMuted}
                value={checkinForm.notes}
                onChangeText={(t) => setCheckinForm((p) => ({ ...p, notes: t }))}
                multiline
                maxLength={200}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowCheckinModal(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveCheckin}>
                  <Text style={styles.modalSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: 100 },
  loadingContainer: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 15, color: Colors.textSecondary },
  header: { paddingHorizontal: 24, paddingTop: 60, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  // Progress
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    marginBottom: 16,
  },
  progressCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressPct: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  progressInfo: { flex: 1 },
  progressLabel: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  progressSubLabel: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  // Check-in Banner
  checkinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    marginHorizontal: 24,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  checkinBannerDone: { borderColor: Colors.primary + '40' },
  checkinBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  checkinBannerTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  checkinBannerSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  // Habits
  habitsSection: { paddingHorizontal: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  habitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  habitCardDone: { opacity: 0.75 },
  habitLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  habitIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  habitInfo: { flex: 1 },
  habitName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  habitNameDone: { textDecorationLine: 'line-through', color: Colors.textSecondary },
  weekDotsRow: { flexDirection: 'row', gap: 4, marginTop: 6 },
  weekDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  weekDotLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted },
  weekDotLabelDone: { color: '#fff' },
  habitRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streakBadge: {
    backgroundColor: Colors.primaryPale,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  streakText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // FAB
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary, marginBottom: 20 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 12 },
  modalInput: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconPicker: { flexDirection: 'row', marginVertical: 8 },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryPale },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.background,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  modalSaveBtnDisabled: { opacity: 0.5 },
  modalSaveText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  // Check-in modal specifics
  emojiRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  emojiBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emojiBtnSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryPale },
  emojiText: { fontSize: 24 },
  emojiLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  ratingRow: { flexDirection: 'row', gap: 8 },
  ratingBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ratingBtnSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryPale },
  ratingText: { fontSize: 16, fontWeight: '700', color: Colors.textMuted },
  ratingTextSelected: { color: Colors.primary },
  sleepRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sleepBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sleepBtnSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryPale },
  sleepText: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  sleepTextSelected: { color: Colors.primary },
  notesInput: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 70,
    textAlignVertical: 'top',
  },
});
