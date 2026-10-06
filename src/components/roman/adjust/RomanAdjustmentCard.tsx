/**
 * RomanAdjustmentCard — one approve-to-adjust suggestion on the coach side.
 *
 * Roman's sentence first (avatar + serif-free body copy), the evidence as
 * quiet chips, the exact change, then three actions: Approve, Edit, Dismiss.
 *
 * Every decision waits ADJUST_CLIENT_UNDO_SECONDS on the card with an Undo
 * button before anything is sent, so a mis-tap costs nothing. After a change
 * is applied, the server keeps a short undo window too (undo_until), and the
 * card offers Undo until it closes.
 *
 * Errors are specific (romanAdjustCopy.adjustErrorView); a settled
 * suggestion (already handled, workout started or edited, consent withdrawn)
 * asks the list to refresh instead of offering a retry that cannot work.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import RomanAvatar from '../RomanAvatar';
import { colors, spacing, typography } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import {
  approveAdjustment,
  dismissAdjustment,
  editAdjustment,
  undoAdjustment,
  type DismissReason,
  type EditInput,
  type RomanAdjustment,
} from '../../../api/romanAdjustApi';
import {
  ADJUST_CLIENT_UNDO_SECONDS,
  DISMISS_REASONS,
  adjustErrorView,
  appliedLine,
  changeSummary,
  pendingLine,
  signalLabel,
  type AdjustAction,
} from './romanAdjustCopy';

export interface RomanAdjustDeps {
  approve: (id: string) => Promise<RomanAdjustment>;
  edit: (id: string, input: EditInput) => Promise<RomanAdjustment>;
  dismiss: (id: string, reason: DismissReason | null) => Promise<RomanAdjustment>;
  undo: (id: string) => Promise<RomanAdjustment>;
  now: () => number;
}

const DEFAULT_DEPS: RomanAdjustDeps = {
  approve: approveAdjustment,
  edit: editAdjustment,
  dismiss: dismissAdjustment,
  undo: undoAdjustment,
  now: () => Date.now(),
};

export interface RomanAdjustmentCardProps {
  proposal: RomanAdjustment;
  /** The suggestion was dismissed, undone or can no longer be acted on. */
  onSettled: (id: string, opts: { refresh: boolean; notice?: string }) => void;
  /** The server returned a new version of the suggestion. */
  onChanged: (next: RomanAdjustment) => void;
  deps?: Partial<RomanAdjustDeps>;
  testID?: string;
}

type Pending =
  | { kind: 'approve' }
  | { kind: 'edit'; input: EditInput }
  | { kind: 'dismiss'; reason: DismissReason | null };

type Mode = 'idle' | 'editing' | 'reasons' | 'countdown' | 'sending';

const PCT_CHOICES = [10, 15, 20, 25, 30] as const;

export default function RomanAdjustmentCard({ proposal, onSettled, onChanged, deps, testID = 'roman-adjust-card' }: RomanAdjustmentCardProps) {
  const d = useMemo(() => ({ ...DEFAULT_DEPS, ...deps }), [deps]);
  const [mode, setMode] = useState<Mode>('idle');
  const [pending, setPending] = useState<Pending | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ADJUST_CLIENT_UNDO_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [showSets, setShowSets] = useState(false);
  const [editPct, setEditPct] = useState<number | null>(proposal.proposed_change.volume_pct);
  const [editSets, setEditSets] = useState<Record<number, number>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const applied = proposal.status === 'approved' || proposal.status === 'edited';
  const undoOpen = applied && proposal.undo_until !== null && Date.parse(proposal.undo_until) > d.now();
  const nameOf = (id: string, order: number) => proposal.exercise_names[id] ?? `Exercise ${order + 1}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const fail = useCallback(
    (err: unknown, action: AdjustAction) => {
      const v = adjustErrorView(err, action);
      void HapticService.warning();
      setError(v.message);
      setMode('idle');
      setPending(null);
      if (v.refresh) onSettled(proposal.id, { refresh: true, notice: v.message });
    },
    [onSettled, proposal.id],
  );

  const send = useCallback(
    async (p: Pending) => {
      setMode('sending');
      try {
        if (p.kind === 'approve') onChanged(await d.approve(proposal.id));
        else if (p.kind === 'edit') onChanged(await d.edit(proposal.id, p.input));
        else {
          await d.dismiss(proposal.id, p.reason);
          if (mounted.current) onSettled(proposal.id, { refresh: false });
          return;
        }
        void HapticService.success();
        if (mounted.current) {
          setMode('idle');
          setPending(null);
        }
      } catch (err) {
        if (mounted.current) fail(err, p.kind);
      }
    },
    [d, fail, onChanged, onSettled, proposal.id],
  );

  const startCountdown = useCallback(
    (p: Pending) => {
      void HapticService.selection();
      setError(null);
      setPending(p);
      setSecondsLeft(ADJUST_CLIENT_UNDO_SECONDS);
      setMode('countdown');
      if (timer.current) clearInterval(timer.current);
      let left = ADJUST_CLIENT_UNDO_SECONDS;
      timer.current = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          void send(p);
        } else {
          setSecondsLeft(left);
        }
      }, 1000);
    },
    [send],
  );

  const cancelCountdown = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPending(null);
    setMode('idle');
  }, []);

  const serverUndo = useCallback(async () => {
    setMode('sending');
    setError(null);
    try {
      await d.undo(proposal.id);
      if (mounted.current) onSettled(proposal.id, { refresh: false });
    } catch (err) {
      if (mounted.current) fail(err, 'undo');
    }
  }, [d, fail, onSettled, proposal.id]);

  const saveEdit = () => {
    const rows = Object.entries(editSets).map(([order, sets]) => ({ order: Number(order), sets }));
    startCountdown({ kind: 'edit', input: rows.length > 0 ? { sets: rows } : { volume_pct: editPct ?? proposal.proposed_change.volume_pct } });
  };

  const change = applied && proposal.applied_change ? proposal.applied_change : proposal.proposed_change;
  const busy = mode === 'sending';

  return (
    <View style={styles.card} testID={testID} accessibilityRole="summary">
      <View style={styles.header}>
        <RomanAvatar crop="neutral" size={36} testID={`${testID}-avatar`} />
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>{`${proposal.client.first_name || 'Client'} · ${proposal.workout.plan_name}`}</Text>
          <Text style={styles.body} accessibilityLiveRegion="polite">
            {applied ? appliedLine(proposal.applied_change, proposal.client.first_name) : proposal.roman_text}
          </Text>
        </View>
      </View>

      {!applied && proposal.signals.length > 0 ? (
        <View style={styles.chips} accessibilityLabel="Evidence">
          {proposal.signals.map((s) => (
            <View key={s.key} style={styles.chip}>
              <Text style={styles.chipText}>{signalLabel(s)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={() => setShowSets((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showSets }}
        accessibilityLabel={`${changeSummary(change)}. ${showSets ? 'Hide' : 'Show'} the sets per exercise`}
        testID={`${testID}-summary`}
        style={styles.summaryRow}
      >
        <Text style={styles.summary}>{changeSummary(change)}</Text>
        <Text style={styles.link}>{showSets ? 'Hide' : 'Details'}</Text>
      </Pressable>
      {showSets ? (
        <View style={styles.setList} testID={`${testID}-sets`}>
          {change.exercises.map((e) => (
            <View key={e.order} style={styles.setRow}>
              <Text style={styles.setName} numberOfLines={1}>
                {nameOf(e.exercise_external_id, e.order)}
              </Text>
              <Text style={styles.setValue}>{e.sets_before === e.sets_after ? `${e.sets_after} sets` : `${e.sets_before} to ${e.sets_after} sets`}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {mode === 'editing' ? (
        <View style={styles.panel} testID={`${testID}-edit`}>
          <Text style={styles.panelTitle}>Reduce volume by</Text>
          <View style={styles.chips}>
            {PCT_CHOICES.map((p) => (
              <Pressable
                key={p}
                onPress={() => {
                  setEditPct(p);
                  setEditSets({});
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: editPct === p && Object.keys(editSets).length === 0 }}
                style={[styles.choice, editPct === p && Object.keys(editSets).length === 0 ? styles.choiceOn : null]}
                testID={`${testID}-pct-${p}`}
              >
                <Text style={[styles.choiceText, editPct === p && Object.keys(editSets).length === 0 ? styles.choiceTextOn : null]}>{`${p}%`}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.panelTitle}>Or set each exercise</Text>
          {proposal.proposed_change.exercises.map((e) => {
            const value = editSets[e.order] ?? e.sets_before;
            const step = (delta: number) => {
              const next = Math.min(20, Math.max(1, value + delta));
              setEditPct(null);
              setEditSets((m) => ({ ...m, [e.order]: next }));
            };
            const label = nameOf(e.exercise_external_id, e.order);
            return (
              <View key={e.order} style={styles.setRow}>
                <Text style={styles.setName} numberOfLines={1}>
                  {label}
                </Text>
                <View style={styles.stepper}>
                  <Pressable onPress={() => step(-1)} disabled={value <= 1} accessibilityRole="button" accessibilityLabel={`One fewer set of ${label}`} style={styles.stepBtn} testID={`${testID}-minus-${e.order}`}>
                    <Text style={[styles.stepText, value <= 1 ? styles.disabledText : null]}>−</Text>
                  </Pressable>
                  <Text style={styles.stepValue} accessibilityLabel={`${value} sets`}>
                    {value}
                  </Text>
                  <Pressable onPress={() => step(1)} disabled={value >= 20} accessibilityRole="button" accessibilityLabel={`One more set of ${label}`} style={styles.stepBtn} testID={`${testID}-plus-${e.order}`}>
                    <Text style={[styles.stepText, value >= 20 ? styles.disabledText : null]}>+</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <View style={styles.actions}>
            <Pressable onPress={saveEdit} accessibilityRole="button" style={[styles.btn, styles.btnPrimary]} testID={`${testID}-save`}>
              <Text style={styles.btnPrimaryText}>Apply</Text>
            </Pressable>
            <Pressable onPress={() => setMode('idle')} accessibilityRole="button" style={styles.btn} testID={`${testID}-cancel`}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {mode === 'reasons' ? (
        <View style={styles.panel} testID={`${testID}-reasons`}>
          <Text style={styles.panelTitle}>Why dismiss it?</Text>
          <View style={styles.chips}>
            {DISMISS_REASONS.map((r) => (
              <Pressable key={r.value} onPress={() => startCountdown({ kind: 'dismiss', reason: r.value })} accessibilityRole="button" style={styles.choice} testID={`${testID}-reason-${r.value}`}>
                <Text style={styles.choiceText}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setMode('idle')} accessibilityRole="button" style={styles.btn}>
            <Text style={styles.btnText}>Keep it</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'countdown' && pending ? (
        <View style={styles.countdown} testID={`${testID}-countdown`} accessibilityLiveRegion="polite">
          <Text style={styles.summary}>{pendingLine(pending.kind, secondsLeft)}</Text>
          <Pressable onPress={cancelCountdown} accessibilityRole="button" accessibilityLabel="Undo" style={styles.btn} testID={`${testID}-undo-local`}>
            <Text style={styles.btnText}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'idle' && !applied ? (
        <View style={styles.actions}>
          <Pressable onPress={() => startCountdown({ kind: 'approve' })} accessibilityRole="button" accessibilityLabel={`Approve: ${changeSummary(proposal.proposed_change)}`} style={[styles.btn, styles.btnPrimary]} testID={`${testID}-approve`}>
            <Text style={styles.btnPrimaryText}>Approve</Text>
          </Pressable>
          <Pressable onPress={() => setMode('editing')} accessibilityRole="button" style={styles.btn} testID={`${testID}-edit-open`}>
            <Text style={styles.btnText}>Edit</Text>
          </Pressable>
          <Pressable onPress={() => setMode('reasons')} accessibilityRole="button" style={styles.btn} testID={`${testID}-dismiss`}>
            <Text style={styles.btnText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {mode === 'idle' && applied && undoOpen ? (
        <View style={styles.actions}>
          <Pressable onPress={() => void serverUndo()} accessibilityRole="button" accessibilityLabel="Undo the change" style={styles.btn} testID={`${testID}-undo-server`}>
            <Text style={styles.btnText}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      {busy ? <ActivityIndicator color={colors.forest} style={styles.spinner} testID={`${testID}-busy`} /> : null}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cream,
    borderRadius: 4,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1, gap: spacing.xs },
  eyebrow: { ...typography.caption, color: colors.charcoal },
  body: { ...typography.body, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 0.5, borderColor: colors.camel, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipText: { ...typography.caption, color: colors.charcoal },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  summary: { ...typography.bodySmall, color: colors.ink, flex: 1 },
  link: { ...typography.bodySmall, color: colors.forest },
  setList: { gap: spacing.xs },
  setRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36, gap: spacing.md },
  setName: { ...typography.bodySmall, color: colors.ink, flex: 1 },
  setValue: { ...typography.bodySmall, color: colors.charcoal },
  panel: { gap: spacing.sm, borderTopWidth: 0.5, borderTopColor: colors.stone, paddingTop: spacing.md },
  panelTitle: { ...typography.caption, color: colors.charcoal },
  choice: { borderWidth: 0.5, borderColor: colors.charcoal, borderRadius: 999, paddingHorizontal: spacing.md, minHeight: 36, justifyContent: 'center' },
  choiceOn: { backgroundColor: colors.forest, borderColor: colors.forest },
  choiceText: { ...typography.bodySmall, color: colors.ink },
  choiceTextOn: { color: colors.bone },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { ...typography.body, color: colors.forest },
  disabledText: { color: colors.stone },
  stepValue: { ...typography.body, color: colors.ink, minWidth: 24, textAlign: 'center' },
  countdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  btn: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center', borderWidth: 0.5, borderColor: colors.charcoal, borderRadius: 0 },
  btnPrimary: { backgroundColor: colors.forest, borderColor: colors.forest },
  btnText: { ...typography.bodySmall, color: colors.ink },
  btnPrimaryText: { ...typography.bodySmall, color: colors.bone },
  spinner: { alignSelf: 'flex-start' },
  error: { ...typography.bodySmall, color: colors.charcoal },
});
