/**
 * WORKOUT-SUMMARY-M: the workout summary of a coach-set workout, as C1 Style C v2 frame C5 draws it
 * (planning/MOCKUP3/C1/style-c-v2 C2_summary_* and, not sent, C2_error_*). Drawn by WorkoutFinishSummary behind
 * featureFlags.clientTrainV2; ActiveWorkoutScreen owns the save (main's Finish body, run by Send).
 * - The deep forest masthead (light status bar, radius 24 on its bottom corners): the day strip, the week ring with
 *   "{n} of {total}" over THIS WEEK (trainWeek over GET /assignments/me, no second rule), "Workout complete." and the
 *   totals. Not sent: the cream card at its top. Week loading, failed or empty: no ring and no strip.
 * - On bone: What moved, How hard 1 to 10 (a radio group), the note for the coach, and Send in the footer.
 * Reads only the signed-in client's own rows (useMyWorkoutAssignments) and coaches (useMyCoaches). No haptic of its own
 * but the number tap's selection tick: Send's success or error haptic is the save's.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStatusBarBand } from '../../../components/StatusBarBand';
import { Colors } from '../../../constants/colors';
import { useMyCoaches } from '../../../hooks/useCalendar';
import { useMyWorkoutAssignments } from '../../../hooks/useWorkoutBuilder';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, layout, radius, typography } from '../../../theme/tokens';
import { Overline, PrimaryButton, Screen, useScreenInsets } from '../../../ui';
import { DayMark, PeakStar, SegmentedRing } from '../../../ui/charts/StyleCMarks';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { doneLine } from '../../coach/client-detail/thisWeek';
import { DAY_LABELS } from '../habits/constants';
import { TRAIN_COPY } from '../train/TrainToday';
import { NOTE_MAX, SUMMARY_COPY as c, summaryWeek, type MovedLine } from './summaryC5';

const CAP = 1.3;
const RING = 176;

export interface WorkoutSummaryC5Props {
  assignmentId: string;
  /** The client's own calendar day, YYYY-MM-DD. */
  today: string;
  minutes: number;
  sets: number;
  volume: number;
  lines: MovedLine[];
  effort: number | null;
  note: string;
  onEffort: (n: number | null) => void;
  onNote: (text: string) => void;
  /** open: nothing saved yet; sending: Send tapped; notSent: queued on the phone, the server did not answer. */
  status: 'open' | 'sending' | 'notSent';
  /** The queue key once Send was tapped: the one event the ring's segment and the day mark draw for. */
  sentKey: string | null;
  onSend: () => void;
  onTryAgain: () => void;
  onBack: () => void;
  /** Drawn under a record line (WorkoutFinishSummary's Share link, SHARE-A). */
  recordAction?: (line: MovedLine) => React.ReactNode;
}

const firstName = (name?: string | null) => name?.trim().split(/\s+/)[0] || null;

export default function WorkoutSummaryC5(p: WorkoutSummaryC5Props) {
  const sc = useTheme().semanticColors;
  const insets = useScreenInsets();
  useStatusBarBand(sc.surface.masthead);
  const rowsQuery = useMyWorkoutAssignments();
  const coaches = useMyCoaches(true).data;
  const rows = rowsQuery.data;
  const mine = rows?.find((r) => r.id === p.assignmentId);
  const coach = firstName((coaches?.find((x) => x.coach_id === mine?.assigned_by_coach_id) ?? coaches?.[0])?.name) ?? c.yourCoach;
  const { week, drawIndex, drawDay } = summaryWeek(rows ?? [], p.today, p.assignmentId, p.sentKey != null);
  const showWeek = !!rows && week.total > 0;
  const locked = p.status !== 'open';
  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  // FIX-974R1 (LS-974R1 B1): C2_summary draws no row for back. With the week drawn it sits beside the ring (no height of
  // its own); without the week, at the top as before. Not while Send is saving (LO-974R1 C3).
  const back = (
    <Pressable
      testID="summary-back" onPress={p.status === 'sending' ? undefined : p.onBack} disabled={p.status === 'sending'}
      accessibilityRole="button" accessibilityState={{ disabled: p.status === 'sending' }} hitSlop={8}
      accessibilityLabel={p.status === 'notSent' ? c.leave : c.back} style={showWeek ? s.backBeside : s.back}
    >
      <Ionicons name="chevron-back" size={24} color={sc.textOnAccent} />
    </Pressable>
  );

  return (
    <Screen
      edges={[]}
      testID="workout-summary-c5"
      contentStyle={s.content}
      footer={p.status === 'notSent'
        ? <PrimaryButton label={c.tryAgain} onPress={p.onTryAgain} testID="summary-try-again" />
        : <PrimaryButton label={c.send(coach)} onPress={p.onSend} loading={p.status === 'sending'} testID="send-to-coach" />}
    >
      <View style={[s.mast, { backgroundColor: sc.surface.masthead, paddingTop: insets.top + layout.statusBarGap }]}>
        {showWeek ? null : back}
        {p.status === 'notSent' ? (
          <View testID="summary-not-sent" accessibilityRole="alert" style={s.card}>
            <Text maxFontSizeMultiplier={CAP} style={[s.cardTitle, { color: colors.ink }]}>{c.notSent(coach)}</Text>
            <Text maxFontSizeMultiplier={CAP} style={[s.cardBody, { color: colors.ink }]}>{c.safe(coach)}</Text>
          </View>
        ) : null}
        {showWeek ? (
          <>
            <View style={s.strip} testID="summary-strip">
              {week.days.map((mark, d) => (
                <View key={d} style={s.day}>
                  <Text maxFontSizeMultiplier={CAP} style={[typography.caption, muted]} importantForAccessibility="no" aria-hidden>{DAY_LABELS[d]}</Text>
                  <DayMark
                    onDark state={mark} day={week.dates[d]} label={`${week.dates[d]}, ${TRAIN_COPY.day[mark]}`}
                    event={d === drawDay ? p.sentKey ?? undefined : undefined} testID={`summary-day-${d}`}
                  />
                </View>
              ))}
            </View>
            <View style={s.ringWrap}>
              {back}
              <SegmentedRing
                onDark size={RING} segments={week.segments} label={doneLine(week)} testID="summary-ring"
                drawIndex={drawIndex ?? undefined} event={p.sentKey ?? undefined}
              >
                <Text maxFontSizeMultiplier={1.15} style={[s.ringCount, light]}>{c.ring(week.done, week.total)}</Text>
                <Text maxFontSizeMultiplier={1.15} style={[typography.eyebrow, muted]}>{c.week}</Text>
              </SegmentedRing>
            </View>
          </>
        ) : null}
        <Text maxFontSizeMultiplier={CAP} accessibilityRole="header" style={[s.complete, light]}>{c.complete}</Text>
        <Text maxFontSizeMultiplier={CAP} testID="summary-totals" style={[s.totals, muted]}>{c.totals(p.minutes, p.sets, p.volume)}</Text>
      </View>

      <View style={s.body}>
        {p.lines.length > 0 ? (
          <View testID="what-moved" style={s.section}>
            <Overline>{c.moved}</Overline>
            {p.lines.map((line, i) => (
              <View key={`${line.exercise}-${i}`} testID={`what-moved-${i}`}>
                <View style={s.moved}>
                  {line.kind === 'best' ? (
                    <View style={[s.tile, { backgroundColor: sc.surface.masthead }]}>
                      <PeakStar onDark size={16} label={c.recentBest} />
                    </View>
                  ) : (
                    <View style={[s.tile, { backgroundColor: sc.surface.sage, borderColor: sc.surface.sageLine, borderWidth: StyleSheet.hairlineWidth }]} aria-hidden importantForAccessibility="no-hide-descendants">
                      <Ionicons name="trending-up" size={16} color={sc.data.forest} />
                    </View>
                  )}
                  <Text maxFontSizeMultiplier={CAP} style={[s.movedText, { color: sc.textPrimary }]}>{line.text}</Text>
                </View>
                {line.kind === 'best' ? p.recordAction?.(line) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={s.section}>
          <Overline>{c.howHard}</Overline>
          <EffortMeter value={p.effort} onChange={p.onEffort} locked={locked} />
        </View>
        {p.status === 'notSent' ? (
          <View style={[s.rule, { backgroundColor: sc.border }]} />
        ) : (
          <TextInput
            testID="coach-note" value={p.note} onChangeText={p.onNote} editable={!locked} multiline maxLength={NOTE_MAX}
            placeholder={c.note(coach)} accessibilityLabel={c.note(coach)} placeholderTextColor={sc.textMuted}
            maxFontSizeMultiplier={CAP} style={[s.note, { backgroundColor: sc.bgSurface, borderColor: sc.border, color: sc.textPrimary }]}
          />
        )}
      </View>
    </Screen>
  );
}

/** "How hard, 1 to 10" (index-v2 section 1): fills leaf (1-2), fern, moss, forest, deep (9-10) up to the choice. */
function EffortMeter({ value, onChange, locked }: { value: number | null; onChange: (n: number | null) => void; locked: boolean }) {
  const sc = useTheme().semanticColors;
  const d = sc.data;
  const step = (n: number) => (n <= 2 ? d.leaf : n <= 4 ? d.fern : n <= 6 ? d.moss : n <= 8 ? d.forest : d.deep);
  return (
    <View testID="effort-meter" accessibilityRole="radiogroup" accessibilityLabel={c.howHard} style={s.meter}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const filled = value != null && n <= value;
        const chosen = n === value;
        const fill = filled ? step(n) : sc.bgSurface;
        const ink = !filled || n <= 4 ? colors.ink : sc.textOnAccent;
        return (
          <Pressable
            key={n} testID={`effort-${n}`} accessibilityRole="radio" accessibilityLabel={String(n)}
            accessibilityState={{ checked: chosen, disabled: locked }}
            onPress={() => {
              if (locked) return;
              HapticService.selection();
              onChange(chosen ? null : n);
            }}
            style={[s.step, chosen && { borderColor: d.deep, borderWidth: 2, padding: 2 }]}
          >
            {/* The chosen number keeps its fill inside a deep ring, a light gap between (colour plus a second cue). */}
            <View style={[s.stepFill, { backgroundColor: fill, borderColor: filled ? sc.bgSurface : sc.textMuted }]}>
              <Text maxFontSizeMultiplier={CAP} style={[s.stepText, { color: ink }]}>{n}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 0 },
  mast: {
    paddingHorizontal: layout.gutter, paddingBottom: 28,
    borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet,
  },
  back: { width: layout.touchMin, height: layout.touchMin, justifyContent: 'center', marginLeft: -10 },
  backBeside: { position: 'absolute', left: -10, top: 0, width: layout.touchMin, height: layout.touchMin, justifyContent: 'center', zIndex: 1 },
  card: {
    backgroundColor: Colors.noticeWarningBg, borderColor: Colors.offlineBanner, borderWidth: 1, borderRadius: radius.card,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16,
  },
  cardTitle: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontSize: 17, lineHeight: 24 },
  cardBody: { fontFamily: typography.bodySmall.fontFamily, fontSize: 15, lineHeight: 21, marginTop: 4 },
  strip: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', gap: 6 },
  ringWrap: { alignItems: 'center', marginTop: 20 },
  ringCount: { ...typography.display, fontVariant: ['tabular-nums'] },
  complete: { ...typography.h1, textAlign: 'center', marginTop: 20 },
  totals: { fontFamily: typography.bodySmall.fontFamily, fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 2 },
  body: { paddingHorizontal: layout.gutter, paddingTop: 20, gap: 20 },
  section: { gap: 12 },
  moved: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { width: 30, height: 30, borderRadius: radius.input / 2, alignItems: 'center', justifyContent: 'center' },
  movedText: { flex: 1, fontFamily: typography.bodySmall.fontFamily, fontSize: 16, lineHeight: 22 },
  meter: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  step: { flexBasis: '17%', flexGrow: 1, minWidth: layout.touchMin, minHeight: layout.touchMin, borderRadius: radius.button + 4 },
  stepFill: { flex: 1, borderWidth: 1, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 20, fontVariant: ['tabular-nums'] },
  note: {
    minHeight: 72, borderWidth: 1, borderRadius: radius.card, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    fontFamily: typography.bodySmall.fontFamily, fontSize: 16, lineHeight: 22, textAlignVertical: 'top',
  },
  rule: { height: StyleSheet.hairlineWidth },
});
