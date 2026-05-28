/**
 * AskAiActionSheet — single sheet that handles all four Stream 2
 * invocation entry points.
 *
 * The coach taps "Ask AI" on the client-detail Summary tab. The sheet
 * opens with a four-item picker (message / workout / meal plan /
 * nudge), the coach selects one, types a short prompt, and submits.
 * On submit the sheet calls the corresponding `coachAiExecutionApi.*`
 * method, invalidates the pending-drafts query so the inbox refreshes,
 * and either closes (with an optional "Open inbox" hint) or routes
 * directly to the inbox.
 *
 * Doctrine compliance: no springs (RN Modal default slide), no
 * particle bursts, no celebration overlays. Single forest accent on
 * the submit CTA. Display copy uses typography tokens (≤500 weight
 * per doctrine §1).
 *
 * Wire contract: see `src/api/coachAiExecutionApi.ts`. Backend
 * Stream 2 PR is not merged at build time; the API client falls back
 * to an in-memory mock so the flow is testable end-to-end.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme, type ThemeColors } from '../../../theme/ThemeProvider';
import { typography, radius, spacing } from '../../../theme/tokens';
import { coachAiExecutionApi } from '../../../api/coachAiExecutionApi';
import { COACH_AI_PENDING_DRAFTS_QUERY_KEY } from '../../../hooks/usePendingAiDrafts';
import {
  capabilityLabel,
  type CoachAiDraftCapability,
} from '../../../api/types/coachAiExecution';

/** The four capabilities surfaced by this sheet, in the spec's display order. */
const CAPABILITIES: ReadonlyArray<{
  cap: CoachAiDraftCapability;
  icon: keyof typeof Ionicons.glyphMap;
  /** Coach-facing button label. Doctrine-clean (no exclamation, no hype). */
  label: string;
  /** Placeholder hint for the prompt textarea — capability-appropriate. */
  hint: string;
}> = [
  {
    cap: 'draft.client_message',
    icon: 'chatbubble-outline',
    label: 'Draft a message',
    hint: 'What should the message focus on?',
  },
  {
    cap: 'draft.assign_workout',
    icon: 'barbell-outline',
    label: 'Suggest a workout',
    hint: 'Goals or constraints for this block?',
  },
  {
    cap: 'draft.assign_meal_plan',
    icon: 'nutrition-outline',
    label: 'Suggest a meal plan',
    hint: 'Diet preferences or macros to target?',
  },
  {
    cap: 'draft.send_notification',
    icon: 'notifications-outline',
    label: 'Draft a check-in nudge',
    hint: 'What prompted the check-in?',
  },
];

export interface AskAiActionSheetProps {
  visible: boolean;
  clientId: string;
  clientName: string;
  /** Close handler. The sheet calls this when the coach taps the
   *  scrim, the close icon, or after a successful submit (unless
   *  `onAfterSubmit` navigates away). */
  onClose: () => void;
  /** Called after a successful submit. The Summary tab uses this to
   *  route the coach to the pending-drafts inbox so they can see
   *  their new draft land. Optional — if omitted, the sheet just
   *  closes and the consumer is expected to surface a separate
   *  "View pending drafts" affordance. */
  onAfterSubmit?: (capability: CoachAiDraftCapability, draftId: string) => void;
}

type Phase =
  | { kind: 'pick' }
  | { kind: 'prompt'; capability: CoachAiDraftCapability }
  | { kind: 'submitting'; capability: CoachAiDraftCapability }
  | { kind: 'error'; capability: CoachAiDraftCapability; message: string };

const PROMPT_MAX = 500;

export function AskAiActionSheet({
  visible,
  clientId,
  clientName,
  onClose,
  onAfterSubmit,
}: AskAiActionSheetProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [prompt, setPrompt] = useState('');

  // Reset phase + prompt every time the sheet re-opens so a previous
  // submit state never leaks into the next session.
  const handleClose = useCallback(() => {
    setPhase({ kind: 'pick' });
    setPrompt('');
    onClose();
  }, [onClose]);

  const handlePick = useCallback((cap: CoachAiDraftCapability) => {
    setPhase({ kind: 'prompt', capability: cap });
    setPrompt('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (phase.kind !== 'prompt') return;
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      setPhase({
        kind: 'error',
        capability: phase.capability,
        message: 'Enter a short prompt so the model has context.',
      });
      return;
    }
    setPhase({ kind: 'submitting', capability: phase.capability });
    try {
      const req = { clientId, prompt: trimmed };
      let result;
      switch (phase.capability) {
        case 'draft.client_message':
          result = await coachAiExecutionApi.invokeClientMessage(req, clientName);
          break;
        case 'draft.assign_workout':
          result = await coachAiExecutionApi.invokeAssignWorkout(req, clientName);
          break;
        case 'draft.assign_meal_plan':
          result = await coachAiExecutionApi.invokeAssignMealPlan(req, clientName);
          break;
        case 'draft.send_notification':
          result = await coachAiExecutionApi.invokeSendNotification(req, clientName);
          break;
      }
      // Refresh the pending-drafts inbox so the new draft appears on
      // the next render of the inbox screen. Fire-and-forget — the
      // invalidation cost is one in-memory cache invalidation.
      queryClient.invalidateQueries({ queryKey: COACH_AI_PENDING_DRAFTS_QUERY_KEY });
      // Reset UI state then notify the parent. The parent decides
      // whether to navigate; the sheet's job ends here.
      setPhase({ kind: 'pick' });
      setPrompt('');
      onClose();
      onAfterSubmit?.(phase.capability, result.draftId);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Could not submit. Try again in a moment.';
      setPhase({ kind: 'error', capability: phase.capability, message: msg });
    }
  }, [phase, prompt, clientId, clientName, queryClient, onClose, onAfterSubmit]);

  return (
    <Modal
      visible={visible}
      onRequestClose={handleClose}
      animationType="slide"
      transparent
      testID="ask-ai-action-sheet"
    >
      <View style={styles.scrim}>
        <Pressable style={styles.scrimPress} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Ask AI</Text>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close Ask AI sheet"
              testID="ask-ai-close"
            >
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          {phase.kind === 'pick' && (
            <ScrollView
              style={styles.pickList}
              showsVerticalScrollIndicator={false}
              testID="ask-ai-pick-list"
            >
              <Text style={styles.subhead}>What should I help you draft?</Text>
              {CAPABILITIES.map((c) => (
                <Pressable
                  key={c.cap}
                  style={styles.optionRow}
                  onPress={() => handlePick(c.cap)}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  testID={`ask-ai-option-${c.cap}`}
                >
                  <View style={styles.optionIconWrap}>
                    <Ionicons name={c.icon} size={20} color={colors.primary} />
                  </View>
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionLabel}>{c.label}</Text>
                    <Text style={styles.optionSubtext}>{capabilityLabel(c.cap)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
          )}

          {(phase.kind === 'prompt' ||
            phase.kind === 'submitting' ||
            phase.kind === 'error') && (
            <View style={styles.promptBody}>
              <PromptHeader
                capability={phase.capability}
                styles={styles}
                onBack={() => setPhase({ kind: 'pick' })}
              />
              <Text style={styles.promptLabel}>
                {hintFor(phase.capability)}
              </Text>
              <TextInput
                value={prompt}
                onChangeText={setPrompt}
                multiline
                editable={phase.kind !== 'submitting'}
                maxLength={PROMPT_MAX}
                placeholder={hintFor(phase.capability)}
                placeholderTextColor={colors.textMuted}
                style={styles.promptInput}
                textAlignVertical="top"
                testID="ask-ai-prompt-input"
                accessibilityLabel="AI prompt"
              />
              <Text style={styles.promptCounter}>
                {prompt.length} / {PROMPT_MAX}
              </Text>

              {phase.kind === 'error' && (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {phase.message}
                </Text>
              )}

              <Pressable
                style={[
                  styles.submitBtn,
                  phase.kind === 'submitting' && styles.submitBtnDisabled,
                ]}
                onPress={handleSubmit}
                disabled={phase.kind === 'submitting'}
                accessibilityRole="button"
                accessibilityLabel="Send to AI"
                testID="ask-ai-submit"
              >
                <Text style={styles.submitBtnText}>
                  {phase.kind === 'submitting' ? 'Sending…' : 'Send to AI'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function hintFor(cap: CoachAiDraftCapability): string {
  const found = CAPABILITIES.find((c) => c.cap === cap);
  return found?.hint ?? 'What should this focus on?';
}

interface PromptHeaderProps {
  capability: CoachAiDraftCapability;
  styles: ReturnType<typeof makeStyles>;
  onBack: () => void;
}

function PromptHeader({ capability, styles, onBack }: PromptHeaderProps) {
  return (
    <View style={styles.promptHeaderRow}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back to options"
        testID="ask-ai-back"
      >
        <Text style={styles.backLink}>Back</Text>
      </Pressable>
      <Text style={styles.promptHeadingLabel}>{capabilityLabel(capability)}</Text>
      <View style={styles.spacer16} />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(26,26,24,0.45)',
      justifyContent: 'flex-end',
    },
    scrimPress: { flex: 1 },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 28,
      maxHeight: '85%',
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    heading: { ...typography.h3, color: colors.textPrimary },
    subhead: {
      ...typography.body,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    pickList: { paddingTop: 4 },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    optionIconWrap: {
      width: 36,
      height: 36,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionTextWrap: { flex: 1 },
    optionLabel: { ...typography.bodyMd, color: colors.textPrimary },
    optionSubtext: {
      ...typography.bodySmall,
      color: colors.textMuted,
      marginTop: 2,
    },

    promptBody: { paddingTop: 4 },
    promptHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    backLink: { ...typography.bodyMd, color: colors.primary },
    promptHeadingLabel: { ...typography.bodyMd, color: colors.textPrimary },
    spacer16: { width: 40 },
    promptLabel: {
      ...typography.bodySmall,
      color: colors.textMuted,
      marginBottom: 6,
    },
    promptInput: {
      ...typography.body,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 12,
      minHeight: 120,
    },
    promptCounter: {
      ...typography.bodySmall,
      color: colors.textMuted,
      textAlign: 'right',
      marginTop: 4,
    },
    errorText: {
      ...typography.bodySmall,
      color: colors.error,
      marginTop: 8,
    },
    submitBtn: {
      marginTop: 16,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: radius.lg,
      alignItems: 'center',
    },
    submitBtnDisabled: { opacity: 0.6 },
    submitBtnText: {
      ...typography.bodyMd,
      color: colors.textOnPrimary,
    },
  });
}

export default AskAiActionSheet;
