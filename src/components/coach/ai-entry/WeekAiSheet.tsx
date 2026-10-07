/**
 * AIB-6 — week-level Ask AI from the program editor: "Progress this week with AI" / "Make this a deload week".
 * One propose per filled day (max 7), in day order, under one shared staged reveal; cards grouped by day with keep toggles;
 * Apply sends each day's kept change ids (a day with none kept is discarded). Nothing changes before Apply.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { spacing, typography } from '../../../theme/tokens';
import { useReduceMotion } from '../../../screens/client/wearables/components/useReduceMotion';
import { DAY_LABELS, type ProgramDay } from '../../../api/programsApi';
import {
  aiBuilderApi, toAiBuilderError, type AiBuilderChange, type AiBuilderErrorCode, type AiBuilderProposal, type AiBuilderStatus,
} from '../../../api/aiBuilderApi';
import {
  AI_LABEL, AI_STAGES, applyLabel, describeAiBuilderError, droppedLine, formatRow, KIND_LABELS, noCreditsCopy, PAUSED_COPY, QUICK_ACTIONS,
  SCREENING_COPY,
} from '../ai-builder/aiBuilderCopy';
import { fireAiHaptic } from '../ai-builder/useAiBuilder';

export type WeekAiAction = 'progress' | 'deload';
export const WEEK_AI_TITLES: Record<WeekAiAction, string> = {
  progress: 'Progress this week with AI',
  deload: 'Make this a deload week',
};
const MAX_DAYS = 7;
/** Per-day refusals that leave the other days worth asking; anything else stops the run. */
const PER_DAY: AiBuilderErrorCode[] = ['no_safe_proposal', 'stale', 'contract'];

type DayResult = { day: ProgramDay; proposal?: AiBuilderProposal; error?: string };
type Props = {
  action: WeekAiAction; week: number; days: ProgramDay[]; status: AiBuilderStatus | null;
  onClose: () => void; onApplied: (changes: number, days: number) => void;
};

/** Same rule as the builder sheet: paused and not_configured (a server switch) read as paused. */
export function blockedCopy(status: AiBuilderStatus | null): string | null {
  const st = status?.state;
  if (st === 'paused' || st === 'not_configured') return PAUSED_COPY;
  return st === 'no_credits' ? noCreditsCopy(status?.credits.resets_at ?? null) : null;
}

/** A failed reject leaves the draft pending server-side (it expires); no plan changes either way. */
async function quietDiscard(draftId: string): Promise<void> {
  try {
    await aiBuilderApi.discard(draftId);
  } catch {
    // Nothing to undo: the plan is unchanged.
  }
}

const dayTitle = (d: ProgramDay) => `${DAY_LABELS[d.day_index] ?? `Day ${d.day_index + 1}`}: ${d.name}`;

export default function WeekAiSheet({ action, week, days, status, onClose, onApplied }: Props) {
  const { semanticColors: sc } = useTheme();
  const reduceMotion = useReduceMotion();
  const blocked = blockedCopy(status);
  const queue = useRef([...days].sort((a, b) => a.day_index - b.day_index).slice(0, MAX_DAYS)).current;
  const [phase, setPhase] = useState<'thinking' | 'review' | 'applying'>(blocked ? 'review' : 'thinking');
  const [answered, setAnswered] = useState(0);
  const [results, setResults] = useState<DayResult[]>([]);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);

  useEffect(() => {
    if (blocked) return;
    void (async () => {
      fireAiHaptic('medium');
      const out: DayResult[] = [];
      for (const day of queue) {
        try {
          const proposal = await aiBuilderApi.propose({
            mode: 'edit', plan_id: day.plan_id, instruction: QUICK_ACTIONS[action].instruction, quick_action: action,
          });
          out.push({ day, proposal });
        } catch (err) {
          const e = toAiBuilderError(err);
          const copy = describeAiBuilderError(e.code, e.resetsAt);
          if (!PER_DAY.includes(e.code)) {
            if (live.current) setError(copy);
            break;
          }
          out.push({ day, error: copy });
        }
        if (!live.current) return; // closed mid-run: unapplied drafts expire server-side, no plan changed
        setAnswered(out.length);
      }
      const ids = out.flatMap((r) => r.proposal?.changes.map((c) => c.change_id) ?? []);
      setResults(out);
      setKept(Object.fromEntries(ids.map((id) => [id, true])));
      setPhase('review');
      if (out.some((r) => r.error) || !ids.length) fireAiHaptic('error');
      ids.slice(0, 5).forEach((_, i) => setTimeout(() => fireAiHaptic('light'), i * 60));
    })();
    // Runs once per sheet: the week and action are fixed while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = results.filter((r) => r.proposal);
  const accepted = (r: DayResult) => r.proposal?.changes.filter((c) => kept[c.change_id]).map((c) => c.change_id) ?? [];
  const n = pending.reduce((sum, r) => sum + accepted(r).length, 0);

  const discardAll = (list: DayResult[]) => list.forEach((r) => r.proposal && void quietDiscard(r.proposal.draft_id));
  const close = () => {
    if (phase === 'applying') return;
    if (pending.length) fireAiHaptic('warning');
    discardAll(pending);
    onClose();
  };
  const toggle = (id: string) => {
    fireAiHaptic(kept[id] ? 'warning' : 'selection');
    setKept((cur) => ({ ...cur, [id]: !cur[id] }));
  };

  const apply = async () => {
    if (phase !== 'review' || n === 0) return;
    setPhase('applying');
    setError(null);
    let changes = 0;
    let applied = 0;
    const left: DayResult[] = [];
    for (const r of pending) {
      const ids = accepted(r);
      if (!r.proposal) continue;
      try {
        if (!ids.length) {
          await quietDiscard(r.proposal.draft_id);
          continue;
        }
        await aiBuilderApi.apply(r.proposal.draft_id, ids);
        changes += ids.length;
        applied += 1;
      } catch (err) {
        const e = toAiBuilderError(err);
        left.push({ day: r.day, error: `Not changed. ${describeAiBuilderError(e.code, e.resetsAt)}` });
      }
    }
    if (!live.current) return;
    if (changes) onApplied(changes, applied);
    if (!left.length) {
      fireAiHaptic('success');
      return onClose();
    }
    fireAiHaptic('error');
    setResults(left);
    setPhase('review');
    if (changes) setError(`Applied ${changes} ${changes === 1 ? 'change' : 'changes'}. The days below were not changed.`);
  };

  const screening = pending.some((r) => r.proposal?.screening_flag);
  return (
    <Modal visible transparent animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={close}>
      <View style={[styles.backdrop, { backgroundColor: sc.overlay }]}>
        <View testID="week-ai-sheet" style={[styles.sheet, { backgroundColor: sc.bgPrimary, borderColor: sc.border }]}>
          <View style={styles.row}>
            <Text accessibilityRole="header" style={[typography.h4, styles.grow, { color: sc.textPrimary }]}>
              {`Week ${week + 1}: ${WEEK_AI_TITLES[action]}`}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={12} disabled={phase === 'applying'}>
              <Text style={[typography.bodyMd, { color: sc.accentText }]}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }}>
            {blocked ? <Text testID="week-ai-blocked" style={[typography.body, { color: sc.textPrimary }]}>{blocked}</Text> : null}
            {phase === 'thinking' ? (
              <View testID="week-ai-thinking" accessibilityLiveRegion="polite" style={styles.stages}>
                <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>
                  {`Day ${Math.min(answered + 1, queue.length)} of ${queue.length}: ${queue[answered] ? dayTitle(queue[answered]) : ''}`}
                </Text>
                {AI_STAGES.map((label) => <Text key={label} style={[typography.body, { color: sc.textMuted }]}>{label}</Text>)}
                <ActivityIndicator color={sc.accentText} accessibilityLabel="Asking AI about each day" />
              </View>
            ) : null}
            {error ? <Text testID="week-ai-error" accessibilityRole="alert" style={[typography.body, styles.alert, { color: sc.textPrimary, borderColor: sc.accentText }]}>{error}</Text> : null}
            {screening ? <Text style={[typography.body, styles.alert, { color: sc.textPrimary, borderColor: sc.accentText }]}>{SCREENING_COPY}</Text> : null}
            {phase !== 'thinking' ? results.map((r, di) => (
              <View key={r.day.plan_id} testID={`week-ai-day-${r.day.day_index}`} style={styles.day}>
                <Text accessibilityRole="header" style={[typography.bodyMd, { color: sc.textPrimary }]}>{dayTitle(r.day)}</Text>
                {r.error ? <Text style={[typography.caption, { color: sc.textMuted }]}>{r.error}</Text> : null}
                {r.proposal ? <Text style={[typography.caption, { color: sc.textMuted }]}>{r.proposal.summary}</Text> : null}
                {r.proposal?.changes.map((c, i) => (
                  <WeekChangeRow key={c.change_id} change={c} kept={!!kept[c.change_id]} delay={reduceMotion ? 0 : (di * 3 + i) * 60}
                    reduceMotion={reduceMotion} onToggle={toggle} />
                ))}
                {r.proposal?.dropped.length ? (
                  <Text style={[typography.caption, { color: sc.textMuted }]}>{droppedLine(r.proposal.dropped.length, r.proposal.dropped[0]?.reason ?? null)}</Text>
                ) : null}
              </View>
            )) : null}
            {pending.length ? <Text style={[typography.caption, { color: sc.textMuted }]}>{AI_LABEL}</Text> : null}
          </ScrollView>
          {pending.length ? (
            <View style={styles.row}>
              <Pressable testID="week-ai-discard" accessibilityRole="button" accessibilityLabel="Discard all suggestions" onPress={close}
                disabled={phase === 'applying'} style={[styles.button, styles.outline, { borderColor: sc.border }]}>
                <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>Discard</Text>
              </Pressable>
              <Pressable testID="week-ai-apply" accessibilityRole="button" accessibilityLabel={applyLabel(n)}
                accessibilityState={{ disabled: phase !== 'review' || !n }} disabled={phase !== 'review' || !n} onPress={() => void apply()}
                style={[styles.button, styles.grow, { backgroundColor: n ? sc.accent : sc.disabledBg }]}>
                <Text style={[typography.bodyMd, { color: n ? sc.textOnAccent : sc.textOnDisabled }]}>{phase === 'applying' ? 'Applying' : applyLabel(n)}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

type RowProps = { change: AiBuilderChange; kept: boolean; delay: number; reduceMotion: boolean; onToggle: (id: string) => void };
function WeekChangeRow({ change, kept, delay, reduceMotion, onToggle }: RowProps) {
  const { semanticColors: sc } = useTheme();
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return anim.setValue(1);
    Animated.timing(anim, { toValue: 1, duration: 220, delay, useNativeDriver: true }).start();
  }, [anim, delay, reduceMotion]);
  const kind = KIND_LABELS[change.kind];
  const before = formatRow(change.before);
  const after = formatRow(change.after);
  const delta = before && after ? `${before} -> ${after}` : after || before;
  return (
    <Animated.View testID={`week-ai-change-${change.change_id}`} style={[styles.card, { borderColor: sc.border, backgroundColor: sc.bgSurface, opacity: anim }]}>
      <View style={styles.row}>
        <Text style={[typography.caption, styles.badge, { color: sc.accentText, borderColor: sc.accentText }]}>{kind}</Text>
        <Text numberOfLines={2} style={[typography.bodyMd, styles.grow, { color: sc.textPrimary }, change.kind === 'removed' && styles.strike]}>
          {change.exercise.name}
        </Text>
        <Switch testID={`week-ai-keep-${change.change_id}`} value={kept} onValueChange={() => onToggle(change.change_id)}
          accessibilityLabel={`Keep this change: ${kind} ${change.exercise.name}${delta ? `, ${delta}` : ''}. ${change.reason}`} />
      </View>
      {delta ? <Text style={[typography.body, { color: sc.textPrimary }]}>{delta}</Text> : null}
      <Text style={[typography.caption, { color: sc.textMuted }]}>{change.reason}</Text>
      {change.warnings.map((w) => <Text key={w} style={[typography.caption, { color: sc.textPrimary }]}>{`Warning: ${w}`}</Text>)}
      {!kept ? <Text style={[typography.caption, { color: sc.textMuted }]}>Not applied.</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', minHeight: '50%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  grow: { flex: 1 },
  stages: { gap: spacing.xs, marginVertical: spacing.md },
  alert: { borderLeftWidth: 3, paddingLeft: spacing.sm, marginVertical: spacing.sm },
  day: { gap: spacing.xs, marginBottom: spacing.md },
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  strike: { textDecorationLine: 'line-through' },
  button: { borderRadius: 12, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center' },
  outline: { borderWidth: 1 },
});
