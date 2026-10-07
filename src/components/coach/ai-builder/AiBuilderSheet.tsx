/** Ask AI sheet (AIB-5): prompt, chips, staged reveal, change cards with keep toggles, Apply N / Discard. Cards spring in on a stagger; Reduce Motion: no springs, no stagger. */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import HapticPressable from '../../HapticPressable';
import CoachExerciseName from '../workout-builder/CoachExerciseName';
import { useReduceMotion } from '../../../screens/client/wearables/components/useReduceMotion';
import { AI_BUILDER_INJURY_AREAS, AI_BUILDER_INSTRUCTION_MAX, AI_BUILDER_QUICK_ACTIONS, type AiBuilderChange, type AiBuilderInjuryArea, type AiBuilderQuickAction } from '../../../api/aiBuilderApi';
import { spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import { AI_LABEL, AI_STAGES, applyLabel, contextLine, droppedLine, formatRow, INJURY_AREA_LABELS, KIND_LABELS, noCreditsCopy, PAUSED_COPY, QUICK_ACTIONS, SCREENING_COPY, UNNAMED_CHANGE } from './aiBuilderCopy';
import type { AiBuilderController } from './useAiBuilder';
import { AI_SPRING, AI_STAGGER_MS } from './AiFunLayer';

type Props = { open: boolean; onClose: () => void; ai: AiBuilderController; isBlank: boolean; sc: SemanticTokens };

/** One change: kind badge (text plus colour, never colour alone), before -> after, reason, warnings, keep switch; springs in on a 60 ms stagger. */
type CardProps = { change: AiBuilderChange; index: number; kept: boolean; reduceMotion: boolean; onToggle: (id: string) => void; sc: SemanticTokens };
function ChangeCard({ change, index, kept, reduceMotion, onToggle, sc }: CardProps) {
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const dim = useRef(new Animated.Value(kept ? 1 : 0.55)).current;
  const toggled = useRef(false); // the first render already shows the right dim
  useEffect(() => {
    if (reduceMotion) return anim.setValue(1);
    Animated.spring(anim, { ...AI_SPRING, toValue: 1, delay: index * AI_STAGGER_MS }).start(); // staged reveal: each card springs in on its beat
  }, [anim, index, reduceMotion]);
  useEffect(() => {
    if (!toggled.current) return void (toggled.current = true);
    if (reduceMotion) return dim.setValue(kept ? 1 : 0.55); // "Not applied." says it in text either way
    Animated.spring(dim, { ...AI_SPRING, toValue: kept ? 1 : 0.55 }).start();
  }, [dim, kept, reduceMotion]);

  const kind = KIND_LABELS[change.kind];
  const removedId = change.exercise ? null : change.before?.exercise_external_id; // resolved by name like the builder rows
  const name = change.exercise?.name ?? UNNAMED_CHANGE[change.kind] ?? 'Exercise';
  const titleStyle = [typography.bodyMd, styles.grow, { color: sc.textPrimary }, change.kind === 'removed' && styles.strike];
  const before = formatRow(change.before);
  const after = formatRow(change.after);
  const delta = before && after ? `${before} -> ${after}` : after || before;
  const badge = change.kind === 'removed' ? sc.textMuted : change.kind === 'added' ? sc.accent : sc.accentText;
  const opacity = Animated.multiply(anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), dim);
  const slide = reduceMotion ? null : { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] };

  return (
    <Animated.View testID={`ai-change-${change.change_id}`} style={[styles.card, { borderColor: sc.border, backgroundColor: sc.bgSurface, opacity }, slide]}>
      <View style={styles.row}>
        <Text style={[typography.caption, styles.badge, { color: badge, borderColor: badge }]}>{kind}</Text>
        {removedId ? <CoachExerciseName id={removedId} fallback={removedId} prefix="" style={titleStyle} /> : <Text numberOfLines={2} style={titleStyle}>{name}</Text>}
        <Switch testID={`ai-keep-${change.change_id}`} value={kept} onValueChange={() => onToggle(change.change_id)}
          accessibilityLabel={`Keep this change: ${kind} ${name}${delta ? `, ${delta}` : ''}. ${change.reason}`} />
      </View>
      {delta ? <Text style={[typography.body, { color: sc.textPrimary }]}>{delta}</Text> : null}
      <Text style={[typography.caption, { color: sc.textMuted }]}>{change.reason}</Text>
      {change.warnings.map((w) => (
        <Text key={w} accessibilityRole="alert" style={[typography.caption, styles.warning, { color: sc.textPrimary, borderColor: sc.accentText }]}>
          {`Warning: ${w}`}
        </Text>
      ))}
      {!kept ? <Text style={[typography.caption, { color: sc.textMuted }]}>Not applied.</Text> : null}
    </Animated.View>
  );
}

export default function AiBuilderSheet({ open, onClose, ai, isBlank, sc }: Props) {
  const reduceMotion = useReduceMotion();
  const [text, setText] = useState('');
  const [injuryPicker, setInjuryPicker] = useState(false);
  const st = ai.status?.state;
  // paused and not_configured (a server switch, never the coach's account) both read as paused; an unreadable status offers a retry.
  const blocked = st === 'paused' || st === 'not_configured' ? PAUSED_COPY : st === 'no_credits' ? noCreditsCopy(ai.status?.credits.resets_at ?? null) : ai.statusError;
  const busy = ai.phase === 'thinking' || ai.phase === 'applying';
  const p = ai.proposal;
  const prompt = isBlank ? 'Describe the workout to build' : 'Ask AI to change this workout';
  const canSend = !busy && !!text.trim();
  const n = ai.acceptedIds.length;
  const pop = useRef(new Animated.Value(1)).current; // the Apply count pops when a keep toggle changes it
  const last = useRef({ p, n });
  useEffect(() => {
    const prev = last.current;
    last.current = { p, n };
    if (prev.p !== p || prev.n === n || reduceMotion) return;
    pop.setValue(1.05);
    Animated.spring(pop, { ...AI_SPRING, toValue: 1 }).start();
  }, [n, p, pop, reduceMotion]);

  const send = (quickAction?: AiBuilderQuickAction, injuryArea?: AiBuilderInjuryArea) => {
    const instruction = text.trim() || (quickAction ? QUICK_ACTIONS[quickAction].instruction : '');
    if (!instruction) return;
    setInjuryPicker(false);
    void ai.propose({ instruction, quickAction, injuryArea });
  };
  const close = () => { if (p) void ai.discard(); onClose(); };
  const chip = (key: string, label: string, a11y: string, onPress: () => void) => (
    <HapticPressable key={key} intent="light" testID={key} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: busy }}
      disabled={busy} onPress={onPress} style={[styles.chip, { borderColor: sc.border }]}>
      <Text style={[typography.caption, { color: sc.textPrimary }]}>{label}</Text>
    </HapticPressable>
  );
  const line = (testID: string, body: string, alert = false) => (
    <Text testID={testID} accessibilityRole={alert ? 'alert' : undefined} accessibilityLiveRegion="polite"
      style={[typography.body, alert && styles.alert, { color: sc.textPrimary, borderColor: sc.accentText }]}>
      {body}
    </Text>
  );

  return (
    <Modal visible={open} transparent animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={close}>
      <KeyboardAvoidingView style={[styles.backdrop, { backgroundColor: sc.overlay }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View testID="ai-builder-sheet" style={[styles.sheet, { backgroundColor: sc.bgPrimary, borderColor: sc.border }]}>
          <View style={styles.row}>
            <Text accessibilityRole="header" style={[typography.h4, styles.grow, { color: sc.textPrimary }]}>Ask AI</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close Ask AI" onPress={close} hitSlop={12}>
              <Text style={[typography.bodyMd, { color: sc.accentText }]}>Close</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.lg }}>
            {blocked ? line('ai-builder-blocked', blocked) : null}
            {ai.statusError ? (
              <HapticPressable intent="light" testID="ai-builder-retry" accessibilityRole="button" accessibilityLabel="Check Ask AI again" accessibilityState={{ disabled: ai.checking }}
                disabled={ai.checking} onPress={ai.retryStatus} style={[styles.button, styles.outline, { borderColor: sc.border }]}>
                <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{ai.checking ? 'Checking' : 'Try again'}</Text>
              </HapticPressable>
            ) : null}
            {!p && !blocked ? (
              <>
                <TextInput testID="ai-builder-input" accessibilityLabel={prompt} placeholder={prompt} placeholderTextColor={sc.textMuted} value={text}
                  onChangeText={setText} maxLength={AI_BUILDER_INSTRUCTION_MAX} multiline autoFocus editable={!busy}
                  style={[styles.input, { color: sc.textPrimary, borderColor: sc.border }]} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {AI_BUILDER_QUICK_ACTIONS.map((a) =>
                    chip(`ai-chip-${a}`, QUICK_ACTIONS[a].label, QUICK_ACTIONS[a].label, () => (a === 'swap_for_injury' ? setInjuryPicker((v) => !v) : send(a))),
                  )}
                </ScrollView>
                {injuryPicker ? (
                  <View style={styles.wrap}>
                    {AI_BUILDER_INJURY_AREAS.map((area) =>
                      chip(`ai-injury-${area}`, INJURY_AREA_LABELS[area], `Swap for ${INJURY_AREA_LABELS[area]}`, () => send('swap_for_injury', area)),
                    )}
                  </View>
                ) : null}
                <Pressable testID="ai-builder-send" accessibilityRole="button" accessibilityLabel="Send to Ask AI" accessibilityState={{ disabled: !canSend }}
                  disabled={!canSend} onPress={() => send()} style={[styles.button, { backgroundColor: canSend ? sc.accent : sc.disabledBg }]}>
                  <Text style={[typography.bodyMd, { color: canSend ? sc.textOnAccent : sc.textOnDisabled }]}>Send</Text>
                </Pressable>
              </>
            ) : null}
            {ai.phase === 'thinking' ? (
              <View testID="ai-builder-thinking" accessibilityLiveRegion="polite" style={styles.stages}>
                {AI_STAGES.map((label, i) => (
                  <Text key={label} style={[typography.body, { color: i <= ai.stage ? sc.textPrimary : sc.textMuted }]}>
                    {i < ai.stage ? `Done: ${label}` : label}
                  </Text>
                ))}
                <ActivityIndicator color={sc.accentText} accessibilityLabel={AI_STAGES[ai.stage]} />
              </View>
            ) : null}
            {ai.error ? line('ai-builder-error', ai.error, true) : null}
            {p ? (
              <View testID="ai-builder-review">
                <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{p.summary}</Text>
                {p.context_used.length ? <Text style={[typography.caption, { color: sc.textMuted }]}>{contextLine(p.context_used)}</Text> : null}
                {p.screening_flag ? line('ai-builder-screening', SCREENING_COPY, true) : null}
                {p.changes.map((c, i) => (
                  <ChangeCard key={c.change_id} change={c} index={i} kept={!!ai.kept[c.change_id]} reduceMotion={reduceMotion} onToggle={ai.toggle} sc={sc} />
                ))}
                {p.dropped.length ? (
                  <Text style={[typography.caption, { color: sc.textMuted }]}>{droppedLine(p.dropped.length, p.dropped[0]?.reason ?? null)}</Text>
                ) : null}
                <Text style={[typography.caption, { color: sc.textMuted, marginTop: spacing.xs }]}>{AI_LABEL}</Text>
                <View style={[styles.row, { marginTop: spacing.md }]}>
                  <Pressable testID="ai-builder-discard" accessibilityRole="button" accessibilityLabel={p.changes.length ? 'Discard all suggestions' : 'Done'}
                    disabled={busy} onPress={() => void ai.discard()} style={[styles.button, styles.outline, { borderColor: sc.border }]}>
                    <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{p.changes.length ? 'Discard' : 'Done'}</Text>
                  </Pressable>
                  {p.changes.length ? (
                    <Animated.View style={[styles.grow, { transform: [{ scale: pop }] }]}>
                      <Pressable testID="ai-builder-apply" accessibilityRole="button" accessibilityLabel={applyLabel(n)} accessibilityState={{ disabled: busy || !n }}
                        disabled={busy || !n} onPress={() => void ai.apply().then((ok) => ok && onClose())}
                        style={[styles.button, { backgroundColor: n ? sc.accent : sc.disabledBg }]}>
                        <Text style={[typography.bodyMd, { color: n ? sc.textOnAccent : sc.textOnDisabled }]}>{ai.phase === 'applying' ? 'Applying' : applyLabel(n)}</Text>
                      </Pressable>
                    </Animated.View>
                  ) : null}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', minHeight: '50%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  grow: { flex: 1 }, outline: { borderWidth: 1 }, strike: { textDecorationLine: 'line-through' }, wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  input: { borderWidth: 1, borderRadius: 12, padding: spacing.md, minHeight: 72, marginBottom: spacing.sm, textAlignVertical: 'top' },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginRight: spacing.sm, marginBottom: spacing.sm },
  button: { borderRadius: 12, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center' },
  stages: { gap: spacing.xs, marginVertical: spacing.md },
  alert: { borderLeftWidth: 3, paddingLeft: spacing.sm, marginVertical: spacing.sm },
  card: { borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  warning: { borderLeftWidth: 3, paddingLeft: spacing.sm },
});
