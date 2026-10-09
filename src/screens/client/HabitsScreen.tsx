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

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { addDays, getLocalWeekStart, getTodayString } from '../../utils/date';
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
import HapticPressable from '../../components/HapticPressable';
import { Headline, Lede, Overline, PrimaryButton, QuietSection, Screen, TextLink } from '../../ui';
import { QuietError, QuietLoading } from '../../ui/states/QuietStates';

import { makeStyles } from './habits/styles';
import { type HabitView, type TabMode } from './habits/constants';
import { HabitCard } from './habits/HabitCard';
import { MoodEnergyPicker } from './habits/MoodEnergyPicker';
import { buildCheckInPayload } from './habits/checkInPayload';
import { AddHabitSheet } from './habits/AddHabitSheet';
import CompetencePill from '../../components/roman/CompetencePill';
import { featureFlags } from '../../config/featureFlags';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { ProtectedScreen } from '../../entitlements/ProtectedScreen';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Today's habits as one sentence ("Two of three done today."). */
export function habitsSummary(done: number, total: number): string {
  if (total === 1) return done ? 'Done for today.' : 'One habit waiting today.';
  if (done >= total) return `All ${word(total)} done today.`;
  if (done === 0) return `${cap(word(total))} habits waiting today.`;
  return `${cap(word(done))} of ${word(total)} done today.`;
}

export default function HabitsScreen() {
  const { colors: themeColors, semanticColors: sc } = useTheme();
  // Bridge the existing child props to semantic tokens, not the fixed palette.
  const colors = useMemo(() => ({
    ...themeColors,
    primary: sc.accentText,
    primaryPale: sc.bgPrimary,
    background: sc.bgPrimary,
    surface: sc.bgPrimary,
    textPrimary: sc.textPrimary,
    textSecondary: sc.textMuted,
    textMuted: sc.textMuted,
    textOnPrimary: sc.textOnAccent,
    border: sc.border,
  }), [themeColors, sc]);
  const styles = useMemo(() => makeStyles(colors, sc), [colors, sc]);
  const today = getTodayString();
  const [tab, setTab] = useState<TabMode>('habits');
  const [showAddModal, setShowAddModal] = useState(false);
  const { entitlementActive, status, confirmedActive, refreshEntitlement } = useEntitlement();
  // Match ProtectedScreen's confirmed-access policy before making a paid read.
  const checkInAccessible = entitlementActive === true ||
    (confirmedActive && (status === 'checking' || status === 'unavailable'));

  // Server reads (React Query)
  const habitsQ = useHabits();
  const logsQ = useHabitLogs(today);
  const todayCheckInQ = useTodayCheckIn(today, checkInAccessible);

  // Server writes
  const logHabit = useLogHabit();
  const createHabit = useCreateHabit();
  const createHabitInFlight = useRef(false);
  const deleteHabit = useDeleteHabit();
  const saveCheckIn = useSaveCheckIn();

  // Check-in form state — hydrated from server, edited locally before save.
  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [sleepHours, setSleepHours] = useState(7);
  const [notes, setNotes] = useState('');
  const [checkInToast, setCheckInToast] = useState(false);
  const [lastCheckInDate, setLastCheckInDate] = useState<string | null>(null);
  // ED.6 — coach's most-recent review of today's check-in (ISO or null). Read
  // straight off the check-in row the backend already returns; null while no
  // coach review exists OR the backend FEATURE_ROMAN_COACH_REVIEWED_AT flag is
  // OFF (the column stays NULL), so the pill stays hidden.
  const [coachReviewedAt, setCoachReviewedAt] = useState<string | null>(null);

  // Add-habit modal form
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('1');
  const [newUnit, setNewUnit] = useState('times');

  // Hydrate the form from today's check-in once the query resolves.
  useEffect(() => {
    const row = todayCheckInQ.data as
      | {
          mood?: number;
          energy?: number;
          sleep_hours?: number;
          notes?: string;
          date?: string;
          coach_reviewed_at?: string | null;
        }
      | null
      | undefined;
    if (!row) {
      setCoachReviewedAt(null);
      return;
    }
    setCoachReviewedAt(row.coach_reviewed_at ?? null);
    if (row.mood != null) setMood(Number(row.mood));
    if (row.energy != null) setEnergy(Number(row.energy));
    if (row.sleep_hours != null) setSleepHours(Number(row.sleep_hours));
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
        { completed: l.completed ?? false, count: l.value ?? l.count ?? 0 },
      ] as [string, { completed: boolean; count: number }];
    }),
  );
  const weekStart = getLocalWeekStart();
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const habits: HabitView[] = allHabits.map((h, index) => ({
    ...h,
    log: logsMap.get(h.id) || null,
    runDays: 0,
    weekDots: weekDates.map((date) =>
      date === today
        ? (logsMap.get(h.id)?.completed ?? false)
        : (habitsQ.data?.[index].logs?.some((log) => log.completed && log.date.slice(0, 10) === date) ?? false),
    ),
  }));

  const refreshing =
    habitsQ.isRefetching || logsQ.isRefetching || todayCheckInQ.isRefetching;

  const onRefresh = () => {
    habitsQ.refetch();
    logsQ.refetch();
    if (checkInAccessible) todayCheckInQ.refetch();
    else if (tab === 'checkin') void refreshEntitlement();
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
          Alert.alert("Couldn't update habit", errorMessage(err, 'The habit was not updated. Try again.'));
        },
      },
    );
  };

  const handleDelete = (habit: HabitView) => {
    Alert.alert(
      'Delete habit',
      `Are you sure you want to delete "${habit.name}"? This will remove the habit and all its history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteHabit.mutate(habit.id, {
              onError: (err) => {
                Alert.alert("Couldn't delete habit", errorMessage(err, 'The habit was not deleted. Try again.'));
              },
            });
          },
        },
      ],
    );
  };

  const handleAddHabit = () => {
    if (createHabitInFlight.current || !newName.trim()) return;
    createHabitInFlight.current = true;
    createHabit.mutate(
      {
        name: newName.trim(),
        category: 'custom',
        target_value: parseInt(newTarget) || 1,
        unit: newUnit || 'times',
      },
      {
        onSuccess: () => {
          setShowAddModal(false);
          setNewName('');
          setNewTarget('1');
          setNewUnit('times');
        },
        onError: (err) => {
          Alert.alert("Couldn't create habit", errorMessage(err, 'The habit was not created. Try again.'));
        },
        onSettled: () => {
          createHabitInFlight.current = false;
        },
      },
    );
  };

  const handleSaveCheckIn = () => {
    // Only fields POST /check-ins accepts: sending sleep_quality / stress
    // made every save fail with a 400 and the coach never got a check-in.
    saveCheckIn.mutate(
      buildCheckInPayload({ date: today, mood, energy, sleepHours, notes }),
      {
        onSuccess: () => {
          setLastCheckInDate(today);
          setCheckInToast(true);
          setTimeout(() => setCheckInToast(false), 2200);
        },
        onError: (err) => {
          Alert.alert("Couldn't save check-in", errorMessage(err, 'The check-in was not saved. Try again.'));
        },
      },
    );
  };

  const completedCount = habits.filter((h) => h.log?.completed).length;
  const dateLabel = new Date(today + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const tabButton = (mode: TabMode, label: string) => {
    const on = tab === mode;
    return (
      <HapticPressable
        intent="light"
        disableAnimation
        style={({ pressed }) => [styles.tab, on && styles.tabActive, pressed && styles.pressed]}
        onPress={() => setTab(mode)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        testID={`habits-tab-${mode}`}
      >
        <Text style={on ? styles.tabLabelActive : styles.tabLabel}>{label}</Text>
      </HapticPressable>
    );
  };

  return (
    // Under the Home stack's back-only native header inside the tab bar: the
    // header owns the top inset and the tab bar the bottom (no paddingTop 60).
    <Screen
      edges={[]}
      testID="habits-screen"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={sc.accent} colors={[sc.accent]} />
      }
    >
      <View style={styles.header}>
        <Overline>{dateLabel}</Overline>
        <Headline level="h1">Habits & check-in</Headline>
      </View>

      <View style={styles.tabRow} accessibilityRole="tablist">
        {tabButton('habits', 'Habits')}
        {tabButton('checkin', 'Daily check-in')}
      </View>

      {tab === 'habits' ? (
        <>
          {habitsQ.isLoading || logsQ.isLoading ? (
            <QuietLoading label="Loading habits" rows={3} testID="habits-loading" />
          ) : habitsQ.isError || logsQ.isError ? (
            <QuietError
              layout="inline"
              message="Habits did not load. Check your connection, then try again."
              onRetry={onRefresh}
              retrying={refreshing}
              testID="habits-error"
            />
          ) : habits.length === 0 ? (
            <QuietSection style={{ borderTopWidth: 0 }}>
              <Overline>Today</Overline>
              <Text style={styles.narrative}>No habits yet.</Text>
              <Lede size="small">Add a daily habit to start tracking it here.</Lede>
            </QuietSection>
          ) : (
            <>
              <QuietSection style={{ borderTopWidth: 0, marginBottom: 8 }}>
                <Overline>Today</Overline>
                <Text style={styles.narrative} testID="habits-summary">
                  {habitsSummary(completedCount, habits.length)}
                </Text>
                <Lede size="small">Tap a habit to mark it done. Hold it to delete.</Lede>
              </QuietSection>
              <Overline>This week</Overline>
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
            </>
          )}

          <TextLink
            label="Add habit"
            tone="accent"
            underline={false}
            align="start"
            onPress={() => setShowAddModal(true)}
            accessibilityHint="Opens the new habit sheet"
            style={styles.addLink}
            testID="habits-add"
          />
        </>
      ) : (
        <>
          {status === 'inactive' && (
            <Text style={[styles.note, { marginVertical: 12 }]}>Daily check-ins need active coaching access.</Text>
          )}
          <ProtectedScreen>
            {todayCheckInQ.isLoading ? (
              <QuietLoading label="Loading check-in" rows={4} testID="checkin-loading" />
            ) : todayCheckInQ.isError && todayCheckInQ.data === undefined ? (
              <QuietError
                layout="inline"
                message="Today's check-in did not load. Check your connection, then try again."
                onRetry={() => void todayCheckInQ.refetch()}
                retrying={todayCheckInQ.isRefetching}
                testID="checkin-error"
              />
            ) : (
              <>
                {checkInToast ? (
                  <View style={styles.savedRow} accessibilityLiveRegion="polite">
                    <Ionicons name="checkmark-circle-outline" size={18} color={sc.accentText} />
                    <Text style={styles.savedText}>Check-in saved</Text>
                  </View>
                ) : checkInSaved ? (
                  <View style={styles.savedRow}>
                    <Ionicons name="checkmark-circle-outline" size={18} color={sc.accentText} />
                    <Text style={styles.savedText}>Saved for today. Change anything and update.</Text>
                  </View>
                ) : null}
                {lastCheckInDate && lastCheckInDate !== today ? (
                  <Text style={[styles.note, { marginBottom: 8 }]}>
                    {`Last check-in ${new Date(lastCheckInDate + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}`}
                  </Text>
                ) : null}

                {/* ED.6 — coach-is-watching micro-signal, gated by the mobile flag; it
                    renders only once a coach has reviewed today's check-in. */}
                {featureFlags.romanCompetencePill && checkInSaved ? (
                  <CompetencePill
                    reviewedAt={coachReviewedAt}
                    surface="checkIn"
                    placement="bottom"
                    testID="checkin-competence-pill"
                  />
                ) : null}

                <MoodEnergyPicker
                  mood={mood}
                  setMood={setMood}
                  energy={energy}
                  setEnergy={setEnergy}
                  sleepHours={sleepHours}
                  setSleepHours={setSleepHours}
                  notes={notes}
                  setNotes={setNotes}
                  colors={colors}
                  styles={styles}
                />

                <PrimaryButton
                  label={checkInSaved ? 'Update check-in' : 'Save check-in'}
                  onPress={handleSaveCheckIn}
                  loading={saveCheckIn.isPending}
                  style={styles.saveBtn}
                  testID="checkin-save"
                />
              </>
            )}
          </ProtectedScreen>
        </>
      )}

      <AddHabitSheet
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        newName={newName}
        setNewName={setNewName}
        newTarget={newTarget}
        setNewTarget={setNewTarget}
        newUnit={newUnit}
        setNewUnit={setNewUnit}
        onAdd={handleAddHabit}
        isSaving={createHabit.isPending}
        colors={colors}
        styles={styles}
      />
    </Screen>
  );
}
