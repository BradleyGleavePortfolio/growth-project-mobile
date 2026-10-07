/**
 * Ask AI sheet (AIB-5): prompt, quick-action chips, staged reveal, change cards with keep
 * toggles, Apply N / Discard. Every state has its own line. Reduce Motion: fade, no stagger.
 */
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import HapticPressable from '../../HapticPressable';
import { useReduceMotion } from '../../../screens/client/wearables/components/useReduceMotion';
import {
  AI_BUILDER_INJURY_AREAS, AI_BUILDER_INSTRUCTION_MAX, AI_BUILDER_QUICK_ACTIONS, type AiBuilderInjuryArea, type AiBuilderQuickAction,
} from '../../../api/aiBuilderApi';
import { spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import {
  AI_LABEL, AI_STAGES, applyLabel, droppedLine, INJURY_AREA_LABELS, NOT_CONFIGURED_COPY, noCreditsCopy, PAUSED_COPY, QUICK_ACTIONS, SCREENING_COPY,
} from './aiBuilderCopy';
import ChangeCard from './ChangeCard';
import type { AiBuilderController } from './useAiBuilder';

interface Props {
  open: boolean;
  onClose: () => void;
  ai: AiBuilderController;
  isBlank: boolean;
  sc: SemanticTokens;
}

export default function AiBuilderSheet({ open, onClose, ai, isBlank, sc }: Props) {
  const reduceMotion = useReduceMotion();
  const [text, setText] = useState('');
  const [injuryPicker, setInjuryPicker] = useState(false);
  const st = ai.status?.state;
  const blocked = st === 'paused' ? PAUSED_COPY : st === 'no_credits' ? noCreditsCopy(ai.status?.credits.resets_at ?? null) : st === 'not_configured' ? NOT_CONFIGURED_COPY : null;
  const busy = ai.phase === 'thinking' || ai.phase === 'applying';
  const p = ai.proposal;
  const prompt = isBlank ? 'Describe the workout to build' : 'Ask AI to change this workout';
  const canSend = !busy && !!text.trim();
  const n = ai.acceptedIds.length;

  const send = (quickAction?: AiBuilderQuickAction, injuryArea?: AiBuilderInjuryArea) => {
    const instruction = text.trim() || (quickAction ? QUICK_ACTIONS[quickAction].instruction : '');
    if (!instruction) return;
    setInjuryPicker(false);
    void ai.propose({ instruction, quickAction, injuryArea });
  };
  const close = () => {
    if (p) void ai.discard();
    onClose();
  };
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
                {p.context_used.length ? <Text style={[typography.caption, { color: sc.textMuted }]}>{`Using ${p.context_used.join(', ')}`}</Text> : null}
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
                    <Pressable testID="ai-builder-apply" accessibilityRole="button" accessibilityLabel={applyLabel(n)} accessibilityState={{ disabled: busy || !n }}
                      disabled={busy || !n} onPress={() => void ai.apply().then((ok) => ok && onClose())}
                      style={[styles.button, styles.grow, { backgroundColor: n ? sc.accent : sc.disabledBg }]}>
                      <Text style={[typography.bodyMd, { color: n ? sc.textOnAccent : sc.textOnDisabled }]}>{ai.phase === 'applying' ? 'Applying' : applyLabel(n)}</Text>
                    </Pressable>
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
  grow: { flex: 1 },
  input: { borderWidth: 1, borderRadius: 12, padding: spacing.md, minHeight: 72, marginBottom: spacing.sm, textAlignVertical: 'top' },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginRight: spacing.sm, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  button: { borderRadius: 12, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center' },
  outline: { borderWidth: 1 },
  stages: { gap: spacing.xs, marginVertical: spacing.md },
  alert: { borderLeftWidth: 3, paddingLeft: spacing.sm, marginVertical: spacing.sm },
});
