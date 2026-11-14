/**
 * RoutineBuilderScreen: the client builds or edits a routine of their own.
 *
 * STYLE-LOGGING-M: Style C by its nearest picked drawings, K3 Style C (the owner's builder pick, drawn on C1 v2
 * tokens): C_day for the page (the deep forest masthead holding the bar and the routine's serif name, lettered rows
 * with their grip, the one forest action at the foot), C_row for the fields (the sage panel the numbers sit on; the
 * typed fields stay, no steppers) and C_picker for the Add exercise sheet. Words, saves and controls are main's; the
 * row's numeral becomes its letter (blockLetter).
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  FlatList,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, NavigationProp, ParamListBase } from '@react-navigation/native';

import { getAllExercises } from '../../db/workoutDb';
import { exerciseCatalogApi } from '../../api/exerciseCatalog';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, spacing, typography, type SemanticTokens } from '../../theme/tokens';
import { Screen, useScreenInsets } from '../../ui';
import { blockLetter } from './active-workout/blockLetter';
import { MastheadBand, mast, sectionHead, wsc } from './workouts/workoutStyleC';
import HapticPressable from '../../components/HapticPressable';
import { errorMessage } from '../../types/common';
import { toServerMuscleGroup } from '../../utils/workout/muscleGroup';
import {
  buildRoutinePayload,
  routineToBuilderExercises,
  type RoutineBuilderExercise,
} from '../../utils/workout/workoutLogging';
import {
  useRoutines,
  useCreateRoutine,
  useUpdateRoutine,
  useDeleteRoutine,
} from '../../hooks/useApi';

// lookupKey ties a row added here to its library-id lookup; it is never sent
// (buildRoutinePayload picks the fields it saves).
type RoutineExercise = RoutineBuilderExercise & { lookupKey?: string };

// How long Save waits for a library-id lookup still in flight before it saves
// the exercise without the id (the server stores null, as before).
export const LIBRARY_ID_WAIT_MS = 8000;

// Each row whose lookup has answered gets its library id (or keeps none).
function withLibraryIds(rows: RoutineExercise[], found: Map<string, string | null>): RoutineExercise[] {
  return rows.map((row) => {
    const id = row.lookupKey && !row.catalogExerciseId ? found.get(row.lookupKey) : null;
    return id ? { ...row, catalogExerciseId: id } : row;
  });
}

// Resolves when every lookup has answered or the wait is over, whichever is first.
function settleWithin(lookups: Array<Promise<unknown>>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([Promise.all(lookups).then(() => undefined), timeout])
    .finally(() => clearTimeout(timer));
}

interface Exercise {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
}

type RouteParams = {
  RoutineBuilder: { routineId?: string };
};

const MUSCLES = ['All', 'chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'core', 'full body', 'cardio'];

export default function RoutineBuilderScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);
  const insets = useScreenInsets();
  const route = useRoute<RouteProp<RouteParams, 'RoutineBuilder'>>();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const routineId = route.params?.routineId;

  const [name, setName] = useState('');
  const [exercises, setExercises] = useState<RoutineExercise[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [filteredExercises, setFilteredExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState('All');
  const [pickerStatus, setPickerStatus] = useState<'loading' | 'ready' | 'error'>('ready');
  const setInputs = useRef<Array<TextInput | null>>([]);
  const rowBounds = useRef<Array<{ y: number; height: number }>>([]);

  // Load existing routine via React Query so the cache is shared with the
  // routines list elsewhere in the app. When the screen is opened in "new"
  // mode (no routineId) the query simply isn't needed for hydration.
  const routinesQ = useRoutines();
  const createRoutine = useCreateRoutine();
  const updateRoutine = useUpdateRoutine();
  const deleteRoutine = useDeleteRoutine();
  const isSaving = createRoutine.isPending || updateRoutine.isPending;
  // Save waits for library-id lookups still in flight (LS-918 B1), in the same
  // busy state as the save itself.
  const [settling, setSettling] = useState(false);
  const busy = isSaving || settling;
  const nextLookupKey = useRef(0);
  const pendingLookups = useRef(new Map<string, Promise<unknown>>());
  const foundLibraryIds = useRef(new Map<string, string | null>());
  const latest = useRef({ name, exercises });
  latest.current = { name, exercises };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!routineId || !routinesQ.data) return;
    const routine = routinesQ.data.find((r) => r.id === routineId);
    if (!routine) return;
    setName(routine.name);
    // GET /routines returns RoutineExercise rows (default_sets /
    // default_reps / default_rest_seconds / muscle_group).
    const exs = routineToBuilderExercises(routine as unknown as Parameters<typeof routineToBuilderExercises>[0]);
    setExercises(exs);
  }, [routineId, routinesQ.data]);

  const openAddExercise = async () => {
    setShowAddModal(true);
    setSearchQuery('');
    setSelectedMuscle('All');
    setPickerStatus('loading');
    setFilteredExercises([]);
    try {
      const all = await getAllExercises();
      setAllExercises(all);
      setFilteredExercises(all);
      setPickerStatus('ready');
    } catch {
      setPickerStatus('error');
    }
  };

  const filterExercises = (query: string, muscle: string) => {
    let results = allExercises;
    if (muscle !== 'All') results = results.filter((e) => e.muscle === muscle);
    if (query.length >= 2) {
      const q = query.toLowerCase();
      results = results.filter((e) => e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q));
    }
    setFilteredExercises(results);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    filterExercises(query, selectedMuscle);
  };

  const handleMuscleFilter = (muscle: string) => {
    setSelectedMuscle(muscle);
    filterExercises(searchQuery, muscle);
  };

  const addExercise = (exercise: Exercise) => {
    const lookupKey = `lookup-${nextLookupKey.current++}`;
    setExercises((prev) => [
      ...prev,
      {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        sets: 3,
        reps: 10,
        restSec: 60,
        muscleGroup: toServerMuscleGroup(exercise.muscle),
        catalogExerciseId: null,
        lookupKey,
      },
    ]);
    setShowAddModal(false);
    // This list is the phone's own (its ids are not library ids): keep the
    // library item's id on the row so the saved routine carries it. It never
    // fails (no match or no answer is null); Save waits for it.
    const lookup = exerciseCatalogApi.libraryId(exercise.name)
      .catch(() => null)
      .then((catalogExerciseId) => {
        foundLibraryIds.current.set(lookupKey, catalogExerciseId);
        pendingLookups.current.delete(lookupKey);
        if (catalogExerciseId && mounted.current) {
          setExercises((prev) => withLibraryIds(prev, foundLibraryIds.current));
        }
      });
    pendingLookups.current.set(lookupKey, lookup);
  };

  const removeExercise = (idx: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateExerciseField = <K extends keyof RoutineExercise>(idx: number, field: K, value: RoutineExercise[K]) => {
    setExercises((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const moveExercise = (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === exercises.length - 1) return;
    setExercises((prev) => {
      const updated = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [updated[idx], updated[swapIdx]] = [updated[swapIdx], updated[idx]];
      return updated;
    });
  };

  const dragExercise = (idx: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderRelease: (_event, gesture) => {
      const row = rowBounds.current[idx];
      if (!row) return;
      const center = row.y + row.height / 2 + gesture.dy;
      const next = rowBounds.current.findIndex((bounds) => center < bounds.y + bounds.height);
      const target = next === -1 ? exercises.length - 1 : next;
      setExercises((prev) => {
        const reordered = [...prev];
        const [moved] = reordered.splice(idx, 1);
        reordered.splice(target, 0, moved);
        return reordered;
      });
    },
  }).panHandlers;

  const canSave = (routineName: string, rows: RoutineExercise[]) => {
    if (!routineName.trim()) {
      Alert.alert('Routine name needed', 'Give your routine a name.');
      return false;
    }
    if (rows.length === 0) {
      Alert.alert('Exercise needed', 'Add at least one exercise.');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (busy || !canSave(name, exercises)) return;
    // A row whose library-id lookup is still running would save without the
    // id: wait for it (removed rows are not waited for or saved).
    const waiting = exercises.flatMap((row) => {
      const lookup = row.lookupKey ? pendingLookups.current.get(row.lookupKey) : undefined;
      return lookup ? [lookup] : [];
    });
    if (waiting.length) {
      setSettling(true);
      await settleWithin(waiting, LIBRARY_ID_WAIT_MS);
      if (!mounted.current) return;
      setSettling(false);
      if (!canSave(latest.current.name, latest.current.exercises)) return;
    }
    const payload = buildRoutinePayload(latest.current.name, withLibraryIds(latest.current.exercises, foundLibraryIds.current));
    const onSuccess = () => navigation.goBack();
    const onError = (err: unknown) => {
      Alert.alert("Couldn't save routine", errorMessage(err, 'Check your connection and save the routine again.'));
    };
    if (routineId) {
      updateRoutine.mutate({ id: routineId, data: payload }, { onSuccess, onError });
    } else {
      createRoutine.mutate(payload, { onSuccess, onError });
    }
  };

  const handleDelete = () => {
    if (!routineId) return;
    Alert.alert('Delete routine?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRoutine.mutate(routineId, {
            onSuccess: () => navigation.goBack(),
            onError: (err) => {
              Alert.alert("Couldn't delete routine", errorMessage(err, 'Check your connection and delete the routine again.'));
            },
          });
        },
      },
    ]);
  };

  return (
    <Screen
      edges={[]}
      contentStyle={styles.content}
      header={<View style={[styles.masthead, { paddingTop: insets.top + spacing.xs }]}>
        <MastheadBand color={mast.ground} />
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Cancel routine" onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back-outline" size={24} color={mast.ink} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>{routineId ? 'Edit routine' : 'New routine'}</Text>
          {routineId ? (
            <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Delete routine" onPress={handleDelete}>
              <Ionicons name="trash-outline" size={22} color={mast.muted} />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconButton} />
          )}
        </View>
        {/* C_day draws the day's serif name on the masthead (rows 214-253): the routine's name field sits there. */}
        <Text style={styles.overline}>Routine name</Text>
        <TextInput
          accessibilityLabel="Routine name"
          style={styles.nameInput}
          placeholder="Routine name (e.g. Push Day)"
          placeholderTextColor={mast.muted}
          value={name}
          onChangeText={setName}
        />
      </View>}
      footer={
        <HapticPressable style={styles.saveBtn} disableAnimation accessibilityLabel="Save routine" accessibilityState={{ busy }} disabled={busy} onPress={() => { void handleSave(); }}>
          <Text style={styles.saveBtnText}>{busy ? 'Saving routine…' : 'Save routine'}</Text>
        </HapticPressable>
      }
    >
        <Text style={styles.sectionHead}>Exercises</Text>

        {exercises.map((ex, idx) => (
          <View key={`${ex.exerciseId}-${idx}`} testID={`exercise-row-${idx}`} style={styles.exerciseCard} onLayout={({ nativeEvent }) => { rowBounds.current[idx] = nativeEvent.layout; }}>
            <View style={styles.exerciseTop}>
              <View style={styles.exerciseTopLeft}>
                {/* C_day's letter chip (cols 48-103): the row's letter where its numeral was, read as it was. */}
                <View style={styles.letterChip}>
                  <Text style={styles.exerciseNum} maxFontSizeMultiplier={1.15}>{blockLetter(idx)}</Text>
                </View>
                <Text style={styles.exerciseName}>{ex.exerciseName}</Text>
                {/* C_day's grip at the row's right end (cols 690-725). */}
                <View style={styles.iconButton} accessibilityLabel={`Drag ${ex.exerciseName} to reorder`} {...dragExercise(idx)}>
                  <Ionicons name="reorder-two-outline" size={18} color={sc.textMuted} />
                </View>
              </View>
              <View style={styles.exerciseActions}>
                <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Move ${ex.exerciseName} up`} onPress={() => moveExercise(idx, 'up')} disabled={idx === 0}>
                  <Ionicons name="chevron-up" size={18} color={idx === 0 ? sc.border : sc.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Move ${ex.exerciseName} down`} onPress={() => moveExercise(idx, 'down')} disabled={idx === exercises.length - 1}>
                  <Ionicons name="chevron-down" size={18} color={idx === exercises.length - 1 ? sc.border : sc.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Edit ${ex.exerciseName}, exercise ${idx + 1}`} onPress={() => setInputs.current[idx]?.focus()}>
                  <Ionicons name="create-outline" size={20} color={sc.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Remove ${ex.exerciseName}, exercise ${idx + 1}`} onPress={() => removeExercise(idx)}>
                  <Ionicons name="trash-outline" size={20} color={sc.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
            {/* C_row's sage panel: one row per number, the label at the left and the typed value at the right. */}
            <View style={styles.fieldPanel}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Sets</Text>
                <TextInput
                  ref={(input) => { setInputs.current[idx] = input; }}
                  accessibilityLabel={`Sets for ${ex.exerciseName}, exercise ${idx + 1}`}
                  style={styles.fieldInput}
                  value={String(ex.sets)}
                  onChangeText={(v) => updateExerciseField(idx, 'sets', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
              <View style={[styles.field, styles.fieldRule]}>
                <Text style={styles.fieldLabel}>Reps</Text>
                <TextInput
                  accessibilityLabel={`Reps for ${ex.exerciseName}, exercise ${idx + 1}`}
                  style={styles.fieldInput}
                  value={String(ex.reps)}
                  onChangeText={(v) => updateExerciseField(idx, 'reps', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
              <View style={[styles.field, styles.fieldRule]}>
                <Text style={styles.fieldLabel}>Rest (s)</Text>
                <TextInput
                  accessibilityLabel={`Rest seconds for ${ex.exerciseName}, exercise ${idx + 1}`}
                  style={styles.fieldInput}
                  value={String(ex.restSec)}
                  onChangeText={(v) => updateExerciseField(idx, 'restSec', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addBtn} accessibilityRole="button" accessibilityLabel="Add exercise" onPress={() => { void openAddExercise(); }}>
          <Ionicons name="add-outline" size={22} color={sc.accentText} />
          <Text style={styles.addBtnText}>Add exercise</Text>
        </TouchableOpacity>

      {/* Exercise Picker Modal: C_picker's masthead (rows 0-433) holds the close, the title, the search and the chips. */}
      <Modal visible={showAddModal} animationType="none" presentationStyle="pageSheet" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.sheetMast}>
            <View style={styles.modalHeader}>
              <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close exercise picker" onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={mast.ink} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Add exercise</Text>
              <View style={styles.iconButton} />
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={mast.muted} />
              <TextInput
                accessibilityLabel="Search exercises"
                style={styles.searchInput}
                placeholder="Search exercises..."
                placeholderTextColor={mast.muted}
                value={searchQuery}
                onChangeText={handleSearchChange}
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.muscleFilter} contentContainerStyle={styles.muscleFilterContent}>
              {MUSCLES.map((m) => (
                <TouchableOpacity
                  key={m}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter ${m}`}
                  accessibilityState={{ selected: selectedMuscle === m }}
                  style={styles.muscleChip}
                  onPress={() => handleMuscleFilter(m)}
                >
                  <View style={[styles.musclePill, selectedMuscle === m && styles.musclePillActive]}>
                    <Text style={[styles.muscleChipText, selectedMuscle === m && styles.muscleChipTextActive]}>
                      {m === 'All' ? 'All' : m.charAt(0).toUpperCase() + m.slice(1)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <FlatList
            keyboardShouldPersistTaps="handled"
            data={filteredExercises}
            ListEmptyComponent={<Text style={styles.listState}>{pickerStatus === 'loading' ? 'Loading exercises.' : pickerStatus === 'error' ? 'Exercises did not load. Check your connection and try again.' : 'No exercises match. Try another search or muscle group.'}</Text>}
            ListFooterComponent={pickerStatus === 'error' ? <TouchableOpacity style={styles.retryBtn} accessibilityRole="button" accessibilityLabel="Try loading exercises again" onPress={openAddExercise}><Text style={styles.addBtnText}>Try again</Text></TouchableOpacity> : null}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.exerciseList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.exerciseListItem} accessibilityRole="button" accessibilityLabel={`Add ${item.name}`} onPress={() => addExercise(item)} activeOpacity={0.7}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exerciseListName}>{item.name}</Text>
                  <Text style={styles.exerciseListMeta}>
                    {item.muscle.charAt(0).toUpperCase() + item.muscle.slice(1)} · {item.equipment}
                  </Text>
                </View>
                <Ionicons name="add-circle-outline" size={22} color={sc.accentText} />
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </Screen>
  );
}

// The bar's title face: Inter semibold, as the K3 frames draw it (typography.micro's face; no 17 pt semibold role).
const semibold = typography.micro.fontFamily;

const makeStyles = (sc: SemanticTokens) =>
  StyleSheet.create({
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  // C_day rows 0-465: the deep forest masthead from the top edge, 24 pt bottom corners, the 24 pt gutter; it holds the
  // bar (its 44 pt row 4 pt under the inset: the back glyph's rows 129-162 centre at 73 pt) and the routine's name
  // (the status bar inset in its ground: MastheadBand).
  masthead: {
    backgroundColor: mast.ground,
    borderBottomLeftRadius: radius.sheet,
    borderBottomRightRadius: radius.sheet,
    paddingHorizontal: layout.gutter,
    paddingBottom: 14,
  },
  // The icon boxes reach 16 pt past the gutter so the back glyph lands at C_day cols 53-71 (26 pt).
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: -spacing.lg,
  },
  // C_day "Strength foundations" (S cap rows 134-157, from col 117): Inter semibold 17 in the masthead ink, after the back.
  topTitle: { ...typography.h4, fontFamily: semibold, fontWeight: '600', color: mast.ink, flex: 1, marginLeft: spacing.sm },
  overline: { ...typography.eyebrow, color: mast.muted, marginTop: spacing.sm },
  // Screen pins the save button above the tab bar, so no 120 pt clearance.
  content: { paddingTop: spacing.sm, paddingBottom: 24 },
  // C_day "Full body A" (rows 214-253): the serif name on forest, its hairline in the frame line.
  nameInput: {
    ...typography.h1,
    paddingVertical: spacing.sm,
    color: mast.ink,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: mast.line,
  },
  // C_day "5 EXERCISES" (rows 862-877, rule 928-929): the eyebrow over its own hairline; the first row follows it.
  sectionHead: { ...sectionHead(sc), marginBottom: 0 },
  exerciseCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
    paddingVertical: spacing.md,
  },
  exerciseTop: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: spacing.sm,
  },
  // C_day rows 954-1009: chip and name side by side, 14 pt apart (wsc.letterGap); the grip at the right end.
  exerciseTopLeft: { flexDirection: 'row', alignItems: 'center', gap: wsc.letterGap },
  letterChip: {
    width: wsc.letterChip,
    height: wsc.letterChip,
    borderRadius: radius.control,
    borderWidth: wsc.letterLine,
    borderColor: sc.data.moss,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseNum: { ...typography.h3, color: sc.textPrimary, textAlign: 'center' },
  // C_day "Back squat" (cap rows 966-989): Inter 17.
  exerciseName: { ...typography.h4, color: sc.textPrimary, flex: 1 },
  exerciseActions: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end' },
  // C_row rows 478-993: sage, a 1 pt sage line, 16 pt corners, 16 pt in from its edge.
  fieldPanel: {
    backgroundColor: sc.surface.sage,
    borderWidth: 1,
    borderColor: sc.surface.sageLine,
    borderRadius: radius.card,
    paddingHorizontal: spacing.lg,
  },
  // C_row: one row per number (60 pt pitch, rules 612-613, 732-733), the label at the left.
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingVertical: spacing.sm },
  fieldRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.surface.sageLine },
  // C_row "Sets" (cap rows 538-561): body text on the panel.
  fieldLabel: { ...typography.body, color: sc.textPrimary, flex: 1 },
  // The typed value in the drawn field ground (C_row rows 1066-1169: surface, 1 pt line, 12 pt corners); C_row's
  // value (cap rows 536-567) is Inter semibold 22, a size no scale role has (H2: screen-private).
  fieldInput: {
    fontFamily: semibold,
    fontWeight: '600',
    fontSize: 22,
    lineHeight: 28,
    minHeight: 44,
    // C_row's value sits between its steppers, cols 422-610 (94 pt): the typed field takes that width.
    width: 96,
    backgroundColor: sc.bgSurface,
    borderWidth: 1,
    borderColor: sc.border,
    borderRadius: radius.input,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontVariant: ['tabular-nums'],
    color: sc.textPrimary,
    textAlign: 'center',
  },
  // C_day's forest link ("Reorder", rows 860-879), in a 44 pt target.
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm,
    minHeight: layout.touchMin,
    marginTop: spacing.sm,
  },
  addBtnText: { ...typography.h4, color: sc.accentText },
  // C_day rows 1392-1499: the one forest action, 54 pt, 12 pt corners; the app's primary label.
  saveBtn: {
    backgroundColor: sc.accent,
    borderRadius: radius.button,
    minHeight: layout.buttonHeight,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { ...typography.bodyMd, color: sc.textOnAccent },
  // Modal: C_picker
  modalContainer: { flex: 1, backgroundColor: sc.bgPrimary },
  sheetMast: {
    backgroundColor: mast.ground,
    borderBottomLeftRadius: radius.sheet,
    borderBottomRightRadius: radius.sheet,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.lg,
    // rows 392-433: 20 pt under the pill, 6 of them inside its 44 pt target.
    paddingBottom: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: -spacing.lg,
  },
  // C_picker "Add to Full body A" (A cap rows 118-141, from col 117): Inter semibold 17 in the masthead ink.
  modalTitle: { ...typography.h4, fontFamily: semibold, fontWeight: '600', color: mast.ink, flex: 1, marginLeft: spacing.sm },
  // C_picker rows 204-295: the forest field, frame line, 12 pt corners, 46 pt.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    minHeight: wsc.searchHeight,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: mast.line,
    borderRadius: radius.input,
    backgroundColor: mast.field,
  },
  searchInput: { ...typography.body, flex: 1, minHeight: 44, color: mast.ink },
  // The chips scroll to the masthead's edges; the first starts on the gutter.
  muscleFilter: { marginTop: spacing.xs, marginHorizontal: -layout.gutter },
  muscleFilterContent: { paddingHorizontal: layout.gutter, gap: spacing.sm },
  // A 44 pt target holding C_picker's 32 pt pill (rows 331-392).
  muscleChip: { minHeight: layout.touchMin, minWidth: layout.touchMin, justifyContent: 'center' },
  musclePill: {
    minHeight: wsc.pillHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: mast.line,
  },
  // The chosen chip is filled leaf with deep text (C_picker rows 332-391).
  musclePillActive: { backgroundColor: mast.chosen, borderColor: mast.chosen },
  muscleChipText: { ...typography.bodySmall, color: mast.ink },
  muscleChipTextActive: { color: mast.ground },
  exerciseList: { paddingTop: spacing.sm, paddingBottom: 40 },
  // C_picker rows 766-879: 56 pt rows on the gutter, name over meta, the hairline from col 48 to 732.
  exerciseListItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.rowMinHeight,
    marginHorizontal: layout.gutter,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  exerciseListName: { ...typography.h4, color: sc.textPrimary },
  exerciseListMeta: { ...typography.bodySmall, color: sc.textMuted, marginTop: 2 },
  listState: { ...typography.bodySmall, color: sc.textMuted, paddingHorizontal: layout.gutter, paddingVertical: spacing.lg },
  retryBtn: { minHeight: layout.touchMin, justifyContent: 'center', paddingHorizontal: layout.gutter },
  });
