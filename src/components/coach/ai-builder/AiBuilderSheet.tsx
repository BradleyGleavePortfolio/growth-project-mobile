/**
 * Ask AI sheet (AIB-5): prompt field, quick-action chips, staged reveal,
 * change cards with keep toggles, Apply N / Discard. Every state has its own
 * specific line. Reduce Motion: no slide, no stagger, cross-fade only.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import HapticPressable from '../../HapticPressable';
import { useReduceMotion } from '../../../screens/client/wearables/components/useReduceMotion';
import {
  AI_BUILDER_INJURY_AREAS,
  AI_BUILDER_INSTRUCTION_MAX,
  AI_BUILDER_QUICK_ACTIONS,
  type AiBuilderInjuryArea,
  type AiBuilderQuickAction,
} from '../../../api/aiBuilderApi';
import type { SemanticTokens } from '../../../theme/tokens';
import { spacing, typography } from '../../../theme/tokens';
import {
  AI_LABEL,
  AI_STAGES,
  applyLabel,
  droppedLine,
  INJURY_AREA_LABELS,
  NOT_CONFIGURED_COPY,
  noCreditsCopy,
  PAUSED_COPY,
  QUICK_ACTION_INSTRUCTIONS,
  QUICK_ACTION_LABELS,
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

export function blockedCopy(state: string | undefined, resetsAt: string | null): string | null {
  if (state === 'paused') return PAUSED_COPY;
  if (state === 'no_credits') return noCreditsCopy(resetsAt);
  if (state === 'not_configured') return NOT_CONFIGURED_COPY;
  return null;
}

export default function AiBuilderSheet({ open, onClose, ai, isBlank, sc }: Props) {
  const reduceMotion = useReduceMotion();
  const [text, setText] = useState('');
  const [injuryPicker, setInjuryPicker] = useState(false);
  const blocked = blockedCopy(ai.status?.state, ai.status?.credits.resets_at ?? null);
  const busy = ai.phase === 'thinking' || ai.phase === 'applying';
  const p = ai.proposal;

  const send = (quickAction?: AiBuilderQuickAction, injuryArea?: AiBuilderInjuryArea) => {
    const instruction = text.trim() || (quickAction ? QUICK_ACTION_INSTRUCTIONS[quickAction] : '');
    if (!instruction) return;
    setInjuryPicker(false);
    void ai.propose({ instruction, quickAction, injuryArea });
  };

  const onChip = (action: AiBuilderQuickAction) => {
    if (action === 'swap_for_injury') {
      setInjuryPicker((v) => !v);
      return;
    }
    send(action);
  };

  const close = () => {
    if (p) void ai.discard();
    onClose();
  };

  return (
    <Modal visible={open} transparent animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={close}>
      <KeyboardAvoidingView
        style={[styles.backdrop, { backgroundColor: sc.overlay }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View testID="ai-builder-sheet" style={[styles.sheet, { backgroundColor: sc.bgPrimary, borderColor: sc.border }]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[typography.h4, { color: sc.textPrimary, flex: 1 }]}>
              Ask AI
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close Ask AI" onPress={close} hitSlop={12}>
              <Text style={[typography.bodyMd, { color: sc.accentText }]}>Close</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.lg }}>
            {blocked ? (
              <Text testID="ai-builder-blocked" accessibilityLiveRegion="polite" style={[typography.body, { color: sc.textPrimary }]}>
                {blocked}
              </Text>
            ) : null}
            {!p && !blocked ? (
              <>
                <TextInput
                  testID="ai-builder-input"
                  accessibilityLabel={isBlank ? 'Describe the workout to build' : 'Ask AI to change this workout'}
                  placeholder={isBlank ? 'Describe the workout to build' : 'Ask AI to change this workout'}
                  placeholderTextColor={sc.textMuted}
                  value={text}
                  onChangeText={setText}
                  maxLength={AI_BUILDER_INSTRUCTION_MAX}
                  multiline
                  autoFocus
                  editable={!busy}
                  style={[styles.input, { color: sc.textPrimary, borderColor: sc.border }]}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {AI_BUILDER_QUICK_ACTIONS.map((a) => (
                    <HapticPressable
                      key={a}
                      intent="light"
                      testID={`ai-chip-${a}`}
                      accessibilityRole="button"
                      accessibilityLabel={QUICK_ACTION_LABELS[a]}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={() => onChip(a)}
                      style={[styles.chip, { borderColor: sc.border }]}
                    >
                      <Text style={[typography.caption, { color: sc.textPrimary }]}>{QUICK_ACTION_LABELS[a]}</Text>
                    </HapticPressable>
                  ))}
                </ScrollView>
                {injuryPicker ? (
                  <View style={styles.wrap}>
                    {AI_BUILDER_INJURY_AREAS.map((area) => (
                      <HapticPressable
                        key={area}
                        intent="light"
                        testID={`ai-injury-${area}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Swap for ${INJURY_AREA_LABELS[area]}`}
                        onPress={() => send('swap_for_injury', area)}
                        style={[styles.chip, { borderColor: sc.accentText }]}
                      >
                        <Text style={[typography.caption, { color: sc.textPrimary }]}>{INJURY_AREA_LABELS[area]}</Text>
                      </HapticPressable>
                    ))}
                  </View>
                ) : null}
                <Pressable
                  testID="ai-builder-send"
                  accessibilityRole="button"
                  accessibilityLabel="Send to Ask AI"
                  accessibilityState={{ disabled: busy || !text.trim() }}
                  disabled={busy || !text.trim()}
                  onPress={() => send()}
                  style={[styles.primary, { backgroundColor: busy || !text.trim() ? sc.disabledBg : sc.accent }]}
                >
                  <Text style={[typography.bodyMd, { color: busy || !text.trim() ? sc.textOnDisabled : sc.textOnAccent }]}>Send</Text>
                </Pressable>
              </>
            ) : null}
            {ai.phase === 'thinking' ? (
              <View testID="ai-builder-thinking" accessibilityLiveRegion="polite" style={styles.stages}>
                {AI_STAGES.map((label, i) => (
                  <Text
                    key={label}
                    style={[typography.body, { color: i <= ai.stage ? sc.textPrimary : sc.textMuted, opacity: i <= ai.stage ? 1 : 0.5 }]}
                  >
                    {i < ai.stage ? `Done: ${label}` : i === ai.stage ? `${label}` : label}
                  </Text>
                ))}
                <ActivityIndicator color={sc.accentText} accessibilityLabel={AI_STAGES[ai.stage]} />
              </View>
            ) : null}
            {ai.error ? (
              <Text testID="ai-builder-error" accessibilityRole="alert" style={[typography.body, styles.error, { color: sc.textPrimary, borderColor: sc.accentText }]}>
                {ai.error}
              </Text>
            ) : null}
            {p ? (
              <View testID="ai-builder-review">
                <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{p.summary}</Text>
                {p.context_used.length > 0 ? (
                  <Text style={[typography.caption, { color: sc.textMuted }]}>{`Using ${p.context_used.join(', ')}`}</Text>
                ) : null}
                {p.screening_flag ? (
                  <Text accessibilityRole="alert" style={[typography.caption, styles.error, { color: sc.textPrimary, borderColor: sc.accentText }]}>
                    This client flagged a health screening question. Confirm medical clearance before increasing intensity.
                  </Text>
                ) : null}
                {p.changes.map((c, i) => (
                  <ChangeCard
                    key={c.change_id}
                    change={c}
                    index={i}
                    kept={!!ai.kept[c.change_id]}
                    reduceMotion={reduceMotion}
                    onToggle={ai.toggle}
                    sc={sc}
                  />
                ))}
                {p.dropped.length > 0 ? (
                  <Text testID="ai-builder-dropped" style={[typography.caption, { color: sc.textMuted }]}>
                    {droppedLine(p.dropped.length, p.dropped[0]?.reason ?? null)}
                  </Text>
                ) : null}
                <Text style={[typography.caption, { color: sc.textMuted, marginTop: spacing.xs }]}>{AI_LABEL}</Text>
                <View style={styles.footer}>
                  <Pressable
                    testID="ai-builder-discard"
                    accessibilityRole="button"
                    accessibilityLabel={p.changes.length ? 'Discard all suggestions' : 'Done'}
                    disabled={busy}
                    onPress={() => void ai.discard()}
                    style={[styles.secondary, { borderColor: sc.border }]}
                  >
                    <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{p.changes.length ? 'Discard' : 'Done'}</Text>
                  </Pressable>
                  {p.changes.length ? (
                    <Pressable
                      testID="ai-builder-apply"
                      accessibilityRole="button"
                      accessibilityLabel={applyLabel(ai.acceptedIds.length)}
                      accessibilityState={{ disabled: busy || ai.acceptedIds.length === 0 }}
                      disabled={busy || ai.acceptedIds.length === 0}
                      onPress={() => {
                        void ai.apply().then((ok) => {
                          if (ok) onClose();
                        });
                      }}
                      style={[styles.primary, styles.grow, { backgroundColor: ai.acceptedIds.length ? sc.accent : sc.disabledBg }]}
                    >
                      <Text style={[typography.bodyMd, { color: ai.acceptedIds.length ? sc.textOnAccent : sc.textOnDisabled }]}>
                        {ai.phase === 'applying' ? 'Applying' : applyLabel(ai.acceptedIds.length)}
                      </Text>
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
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  input: { borderWidth: 1, borderRadius: 12, padding: spacing.md, minHeight: 72, marginBottom: spacing.sm, textAlignVertical: 'top' },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginRight: spacing.sm, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  primary: { borderRadius: 12, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center' },
  secondary: { borderRadius: 12, borderWidth: 1, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center' },
  grow: { flex: 1 },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  stages: { gap: spacing.xs, marginVertical: spacing.md },
  error: { borderLeftWidth: 3, paddingLeft: spacing.sm, marginVertical: spacing.sm },
});
