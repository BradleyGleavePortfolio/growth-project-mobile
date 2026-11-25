/**
 * YourWeeksScreen — the client's program a week at a time (REFINE-987R3, owner #203-E80 on 203-D38: "full program
 * button -> your weeks page"), drawn as the owner picked it: C1 Style C v2 C2_history
 * (planning/MOCKUP3/C1/style-c-v2/C2_history_ios390_100.png). Opened from Your workouts' "Full program".
 *
 * The "Train" eyebrow over the serif title; this week on the deep forest THIS WEEK card (the ring, one line per session:
 * its mark, day, name and done / planned / missed, opening its workout as Your workouts' cards do); "Coming up", one row
 * per later week holding a session, soonest first; "Earlier", one row per past week holding one, newest first; each
 * week row (its ring, span and line, the chevron) opens Your workouts for that week; the key. Round 2's parts, moved
 * here from ClientWorkoutViewerScreen.tsx. Reads only GET /assignments/me, as the list does; one week rule
 * (workouts/workoutWeeks.tsx over the Train tab's trainWeek / workoutWeek).
 */
import React, { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';
import { useMyWorkoutAssignments } from '../../../hooks/useWorkoutBuilder';
import { colors, layout, radius, spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import { getTodayString } from '../../../utils/date';
import { assignmentPrescription } from '../../../utils/workout/assignmentPrescription';
import { assignmentDay } from '../../../utils/workout/workoutDay';
import { useScreenInsets } from '../../../ui';
import { SegmentedRing, type SegmentState } from '../../../ui/charts/StyleCMarks';
import { doneLine, toGoLine, type WorkoutWeek } from '../../coach/client-detail/thisWeek';
import { TRAIN_COPY } from '../train/TrainToday';
import { sectionHead } from './workoutStyleC';
import { ListState, sessionDay, weekSpan, weeksOf, type WeekRow } from './workoutWeeks';

type Assignment = ClientWorkoutAssignmentWithPlan;

export default function YourWeeksScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const insets = useScreenInsets();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { data, isLoading, isError, refetch, isRefetching } = useMyWorkoutAssignments();

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const sorted = useMemo<Assignment[]>(
    () => (data ?? []).slice().sort((a, b) => assignmentDay(a).localeCompare(assignmentDay(b))),
    [data],
  );
  // The phone's own today, as Your workouts and the Train tab.
  const today = getTodayString();
  const weeks = useMemo(() => weeksOf(sorted, today), [sorted, today]);

  const openWorkout = (a: Assignment) => navigation.navigate('WorkoutAssignmentDetail', { assignmentId: a.id });
  // WINDOW-1: a week row opens Your workouts for that one week (a new page above this one).
  const openWeek = (monday: string) => navigation.navigate('ClientWorkoutViewer', { week: monday });

  return (
    <ScrollView
      testID="your-weeks-scroll"
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + layout.statusBarGap }]}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={sc.accent} />}
    >
      {/* C2_history "TRAIN" (cap rows 118-133) over the serif title. */}
      <Text style={styles.eyebrow}>Train</Text>
      <Text style={[typography.h1, { color: sc.textPrimary }]}>Your weeks</Text>

      {isLoading ? (
        <ListState state="loading" sc={sc} />
      ) : isError ? (
        <ListState state="failed" sc={sc} />
      ) : sorted.length === 0 ? (
        <ListState state="empty" sc={sc} />
      ) : (
        <>
          {weeks.rows.length > 0 ? (
            <View testID="week-card" style={styles.weekCard}>
              {/* C2_history rows 236-367: the eyebrow and the ring (cols 611-696) over the first rule. */}
              <View style={styles.weekHead}>
                <Text style={styles.weekEyebrow}>{TRAIN_COPY.week}</Text>
                <SegmentedRing onDark size={RING} segments={weeks.week.segments} label={doneLine(weeks.week)} testID="week-ring">
                  <Text maxFontSizeMultiplier={1.15} style={styles.weekCount}>{`${weeks.week.done}/${weeks.week.total}`}</Text>
                </SegmentedRing>
              </View>
              {weeks.rows.map((a, i) => (
                <WeekSession key={a.id} a={a} state={weeks.week.segments[i]} styles={styles} sc={sc} onPress={() => openWorkout(a)} />
              ))}
            </View>
          ) : null}

          {weeks.later.length > 0 ? (
            <View testID="week-coming">
              <Text style={styles.sectionHead}>Coming up</Text>
              {weeks.later.map((w) => (
                <WeekLine key={w.monday} kind="coming" row={w} line={toGoLine(w.week) ?? doneLine(w.week)} styles={styles} sc={sc} onPress={() => openWeek(w.monday)} />
              ))}
            </View>
          ) : null}

          {weeks.earlier.length > 0 ? (
            <View testID="week-earlier">
              <Text style={styles.sectionHead}>Earlier</Text>
              {weeks.earlier.map((w) => (
                <WeekLine key={w.monday} kind="earlier" row={w} line={doneLine(w.week)} styles={styles} sc={sc} onPress={() => openWeek(w.monday)} />
              ))}
            </View>
          ) : null}

          {weeks.rows.length > 0 || weeks.later.length > 0 || weeks.earlier.length > 0 ? (
            <View testID="week-legend" style={styles.legend}>
              {LEGEND.map((s) => (
                <View key={s} style={styles.legendItem}>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.legendMark, s === 'done' ? styles.legendDone : s === 'missed' ? styles.legendMissed : styles.legendPlanned]}
                  />
                  <Text style={[typography.body, { color: sc.textPrimary }]}>{TRAIN_COPY.day[s]}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const RING = 44; // C2_history cols 611-696 (this week) and 52-140 (each week row): 44 pt.
const LEGEND: SegmentState[] = ['done', 'planned', 'missed'];

/** One session on the THIS WEEK card, one line (C2_history rows 368-479); it opens its workout as the list's card does. */
function WeekSession({ a, state, styles, sc, onPress }: {
  a: Assignment; state: SegmentState; styles: Styles; sc: SemanticTokens; onPress: () => void;
}) {
  const name = useMemo(() => assignmentPrescription(a).name, [a]);
  const day = sessionDay(a);
  const word = state === 'done' ? sc.data.leaf : state === 'missed' ? sc.data.missedOnDark : sc.textOnMastheadMuted;
  return (
    <Pressable
      testID={`week-row-${a.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.weekRow, pressed ? { opacity: 0.85 } : null]}
      accessibilityRole="button"
      accessibilityLabel={`Open workout ${name}, ${day}, ${TRAIN_COPY.day[state]}`}
    >
      <View style={styles.weekLine}>
        <View
          testID={`week-mark-${state}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.mark, state === 'done' ? styles.markDone : state === 'missed' ? styles.markMissed : styles.markPlanned]}
        >
          {state === 'done' ? <Ionicons name="checkmark" size={14} color={colors.ink} /> : null}
        </View>
        <View style={styles.weekWhat}>
          <Text style={styles.weekDay}>{day}</Text>
          <Text style={styles.weekName}>{name}</Text>
        </View>
        <Text style={[styles.weekWord, { color: word }]}>{TRAIN_COPY.day[state]}</Text>
      </View>
    </Pressable>
  );
}

/** A week row under Coming up or Earlier (C2_history rows 900-1027): the ring, the span over its line, the chevron. */
function WeekLine({ kind, row, line, styles, sc, onPress }: {
  kind: 'coming' | 'earlier'; row: WeekRow; line: string; styles: Styles; sc: SemanticTokens; onPress: () => void;
}) {
  const { monday, week } = row;
  const span = weekSpan(monday);
  return (
    <Pressable
      testID={`${kind}-${monday}`}
      onPress={onPress}
      style={({ pressed }) => [styles.weekRowLight, pressed ? { opacity: 0.85 } : null]}
      accessibilityRole="button"
      accessibilityLabel={`${span}, ${line}`}
    >
      <Ring week={week} testID={`${kind}-ring-${monday}`} styles={styles} />
      <View style={styles.flex}>
        <Text style={[typography.h4, { color: sc.textPrimary }]}>{span}</Text>
        <Text style={[typography.body, { color: sc.textMuted }]}>{line}</Text>
      </View>
      {/* C2_history cols 708-720: the outline chevron, hidden from the screen reader as the list's card hides its own. */}
      <Ionicons name="chevron-forward" size={20} color={sc.textPrimary} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

function Ring({ week, testID, styles }: { week: WorkoutWeek; testID: string; styles: Styles }) {
  return (
    <SegmentedRing size={RING} segments={week.segments} label={doneLine(week)} testID={testID}>
      <Text maxFontSizeMultiplier={1.15} style={styles.weekRowCount}>{`${week.done}/${week.total}`}</Text>
    </SegmentedRing>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  const mark = { width: MARK, height: MARK, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' } as const;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    // C2_history: the 24 pt gutter (col 48); the top clears the status bar by 12 pt (inline, from the insets).
    content: { paddingHorizontal: layout.gutter, paddingBottom: spacing['3xl'] },
    eyebrow: { ...typography.eyebrow, color: sc.textMuted },
    // C2_history "EARLIER" (rows 876-899): the eyebrow over its own hairline; the first row follows the rule.
    sectionHead: { ...sectionHead(sc), marginBottom: 0 },
    // C2_history rows 236-843: deep forest, 16 pt corners (col 50 meets the ground at row 257), 16 pt in (col 80).
    weekCard: {
      marginTop: spacing.sm,
      backgroundColor: sc.surface.masthead,
      borderRadius: radius.card,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    weekHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm },
    weekEyebrow: { ...typography.eyebrow, color: sc.textOnMastheadMuted, flex: 1 },
    weekCount: { ...typography.bodySmall, fontFamily: typography.micro.fontFamily, color: sc.textOnAccent, fontVariant: ['tabular-nums'] },
    // A 56 pt session row under a 1 pt rule (rules at rows 368, 480, 592, 704: the forest band on deep).
    weekRow: { minHeight: layout.rowMinHeight, borderTopWidth: 1, borderTopColor: sc.surface.forestBand },
    weekLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: layout.rowMinHeight - 1 },
    // Day and name side by side (cols 145 and 269); under 112 pt left for the name, it goes under the day.
    weekWhat: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: spacing.md, paddingVertical: spacing.xs },
    weekDay: { ...typography.body, color: sc.textOnMastheadMuted, minWidth: 52, fontVariant: ['tabular-nums'] },
    weekName: { ...typography.h4, color: sc.textOnAccent, flexGrow: 1, flexShrink: 1, minWidth: 112 },
    weekWord: { ...typography.bodySmall, fontFamily: typography.micro.fontFamily },
    // The row marks (cols 80-123: 22 pt), from StyleCMarks' on-dark roles.
    mark,
    markDone: { backgroundColor: sc.data.leaf },
    markPlanned: { borderWidth: 1.5, borderColor: sc.data.plannedOnDark },
    markMissed: { borderWidth: 1.5, borderColor: sc.data.missedOnDark, borderStyle: 'dashed' },
    // C2_history rows 900-1027: 64 pt per week, the ring, the span over its line, the chevron, a hairline under.
    weekRowLight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      minHeight: layout.rowMinHeight + spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    weekRowCount: { ...typography.bodySmall, fontFamily: typography.micro.fontFamily, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
    flex: { flex: 1 },
    // C2_history rows 1434-1469: 18 pt marks, light ground (StyleCMarks' light roles).
    legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.sm, marginTop: spacing.lg },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.touchMin },
    legendMark: { width: LEGEND_MARK, height: LEGEND_MARK, borderRadius: radius.pill },
    legendDone: { borderWidth: 4, borderColor: sc.data.forest },
    legendPlanned: { borderWidth: 1.5, borderColor: sc.data.planned },
    legendMissed: { borderWidth: 1.5, borderColor: sc.data.missed, borderStyle: 'dashed' },
  });
}

const MARK = 22; // C2_history cols 80-123
const LEGEND_MARK = 18; // C2_history cols 48-83
