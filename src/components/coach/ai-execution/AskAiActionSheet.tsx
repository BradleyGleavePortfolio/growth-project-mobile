/**
 * AskAiActionSheet — entry point for the Stream 2 AI execution capabilities.
 *
 * R1 audit fix (P0-2): the previous sheet posted `{clientId, prompt}` to
 * `/coach/ai/drafts/*` for every capability. The backend Zod schemas demand
 * the full structured payload (workoutPlanId UUID + scheduledFor ISO,
 * dailyMealPlanId UUID + startsOn YYYY-MM-DD, or kind + body for the
 * notification flow). The audit forbade defaulting UUIDs silently.
 *
 * Resolution for this PR:
 *
 *   - `draft.send_notification`: WIRED. Requires only `clientId`, `kind`,
 *     `body` (≤160), and `prompt`. The coach types `body` into the sheet;
 *     `kind` defaults to 'coach_nudge'. No picker needed — this works today.
 *
 *   - `draft.assign_workout` / `draft.assign_meal_plan`: REMOVED from this
 *     sheet pending the picker integration. These capabilities require the
 *     coach to choose an existing WorkoutPlan / DailyMealPlan UUID from
 *     their library; the right surface for that pick is the Workouts /
 *     Meal Plans tab, not a context-free sheet. Tracked as a P3 follow-up
 *     — see the README for the planned UX.
 *
 *   - `draft.client_message`: REMOVED. The backend merged this capability
 *     into the existing PR #293 `draft.coach_message` surface, which mobile
 *     reaches via `coachAi.ts`. The "Draft a message" entry is the existing
 *     coach-AI surface, not a new Stream 2 path.
 *
 * Defence-in-depth role guard (R1 audit fix P2-2): the sheet refuses to
 * render if the authenticated user role is not 'coach' or 'owner'.
 *
 * Doctrine compliance: no springs (RN Modal default slide), no particle
 * bursts, no celebration overlays. Single forest accent on the submit CTA.
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
import { useCurrentUser } from '../../../hooks/useCurrentUser';

const ALLOWED_ROLES = new Set(['coach', 'owner']);

const NOTIFICATION_DEFAULT_KIND = 'coach_nudge';
const NOTIFICATION_BODY_MAX = 160;
const PROMPT_MAX = 500;

export interface AskAiActionSheetProps {
  visible: boolean;
  clientId: string;
  clientName: string;
  /** Close handler. The sheet calls this on scrim tap, close icon, or
   *  after a successful submit (unless `onAfterSubmit` navigates away). */
  onClose: () => void;
  /** Called after a successful submit. The Summary tab uses this to route
   *  the coach to the pending-drafts inbox. */
  onAfterSubmit?: (draftId: string) => void;
}

type Phase =
  | { kind: 'pick' }
  | { kind: 'notification-form' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string };

export function AskAiActionSheet({
  visible,
  clientId,
  clientName,
  onClose,
  onAfterSubmit,
}: AskAiActionSheetProps): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [body, setBody] = useState('');
  const [prompt, setPrompt] = useState('');

  // Defence-in-depth role guard. If the authenticated user isn't a
  // coach/owner, the sheet renders nothing — the caller controls visibility
  // anyway, so `null` is the least surprising response.
  const allowed = user?.role !== undefined && ALLOWED_ROLES.has(user.role);

  const reset = useCallback(() => {
    setPhase({ kind: 'pick' });
    setBody('');
    setPrompt('');
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmedBody = body.trim();
    const trimmedPrompt = prompt.trim();
    if (trimmedBody.length === 0) {
      setPhase({ kind: 'error', message: 'Type the notification body to send.' });
      return;
    }
    if (trimmedBody.length > NOTIFICATION_BODY_MAX) {
      setPhase({
        kind: 'error',
        message: `Body too long. Keep it under ${NOTIFICATION_BODY_MAX} characters.`,
      });
      return;
    }
    if (trimmedPrompt.length === 0) {
      setPhase({
        kind: 'error',
        message: 'Add a short prompt so the model has context.',
      });
      return;
    }
    setPhase({ kind: 'submitting' });
    try {
      const result = await coachAiExecutionApi.invokeSendNotification({
        clientId,
        kind: NOTIFICATION_DEFAULT_KIND,
        body: trimmedBody,
        prompt: trimmedPrompt,
      });
      queryClient.invalidateQueries({
        queryKey: COACH_AI_PENDING_DRAFTS_QUERY_KEY,
      });
      reset();
      onClose();
      if (result.approval.draft_id) {
        onAfterSubmit?.(result.approval.draft_id);
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Could not submit. Try again in a moment.';
      setPhase({ kind: 'error', message: msg });
    }
  }, [body, prompt, clientId, queryClient, reset, onClose, onAfterSubmit]);

  if (!allowed) return null;

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
              <Text style={styles.subhead}>
                What should I help you draft for {clientName}?
              </Text>
              <Pressable
                style={styles.optionRow}
                onPress={() => setPhase({ kind: 'notification-form' })}
                accessibilityRole="button"
                accessibilityLabel="Draft a check-in nudge"
                testID="ask-ai-option-draft.send_notification"
              >
                <View style={styles.optionIconWrap}>
                  <Ionicons
                    name="notifications-outline"
                    size={20}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.optionTextWrap}>
                  <Text style={styles.optionLabel}>Draft a check-in nudge</Text>
                  <Text style={styles.optionSubtext}>
                    A short push that lands once you approve it.
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>

              {/* Workout / meal-plan suggestion entries are deferred to a
                  follow-up: the backend Zod schemas require workoutPlanId /
                  dailyMealPlanId UUIDs the coach must select from their
                  library. The right surface for that pick is the Workouts
                  / Meal Plans tab, where the picker already exists; we
                  will add an "Ask AI to schedule this" affordance there. */}
              <View style={styles.followUpNote}>
                <Text style={styles.followUpText}>
                  Workout + meal plan AI suggestions land in a follow-up — coach
                  picks the plan in its tab first, then asks AI to schedule.
                </Text>
              </View>
            </ScrollView>
          )}

          {(phase.kind === 'notification-form' ||
            phase.kind === 'submitting' ||
            phase.kind === 'error') && (
            <View style={styles.promptBody}>
              <View style={styles.promptHeaderRow}>
                <Pressable
                  onPress={() => setPhase({ kind: 'pick' })}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Back to options"
                  testID="ask-ai-back"
                >
                  <Text style={styles.backLink}>Back</Text>
                </Pressable>
                <Text style={styles.promptHeadingLabel}>Check-in nudge</Text>
                <View style={styles.spacer16} />
              </View>

              <Text style={styles.promptLabel}>Notification body</Text>
              <TextInput
                value={body}
                onChangeText={setBody}
                multiline
                editable={phase.kind !== 'submitting'}
                maxLength={NOTIFICATION_BODY_MAX}
                placeholder={`What ${clientName} will see in the push`}
                placeholderTextColor={colors.textMuted}
                style={styles.promptInput}
                textAlignVertical="top"
                testID="ask-ai-body-input"
                accessibilityLabel="Notification body"
              />
              <Text style={styles.promptCounter}>
                {body.length} / {NOTIFICATION_BODY_MAX}
              </Text>

              <Text style={[styles.promptLabel, styles.promptLabelGap]}>
                Prompt to the AI
              </Text>
              <TextInput
                value={prompt}
                onChangeText={setPrompt}
                multiline
                editable={phase.kind !== 'submitting'}
                maxLength={PROMPT_MAX}
                placeholder="What prompted the check-in?"
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
                <Text
                  style={styles.errorText}
                  accessibilityLiveRegion="polite"
                >
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
    followUpNote: {
      marginTop: 16,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
    },
    followUpText: {
      ...typography.bodySmall,
      color: colors.textMuted,
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
    promptLabelGap: { marginTop: 12 },
    promptInput: {
      ...typography.body,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 12,
      minHeight: 100,
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
