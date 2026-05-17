/**
 * CoachAiSection — Coach AI v1 entry point on ClientDetailScreen.
 *
 * Renders three CTAs (workout / meal plan / insight). Each CTA opens a
 * lightweight bottom-sheet modal to collect inputs, then POSTs to the
 * matching `/coach/ai/*` endpoint and hands the returned draftId off
 * to the appropriate draft screen.
 *
 * The section calls `GET /coach/ai/status` on mount. When `ready=false`
 * the CTAs render in a disabled state with a caption explaining that
 * the owner must set `ANTHROPIC_API_KEY` in Fly secrets to bring AI
 * back online — see backend 503 contract in `coachAi.ts`.
 *
 * Doctrine-clean: no emoji, no hex literals, theme tokens only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import coachAiApi, { isAiDisabledError, isTimeoutError } from '../../api/coachAi';
import type { PendingDraftSummary } from '../../api/coachAi';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type { CoachAiDraftType, CoachAiStatus } from '../../types/coachAi';
import { errorMessage } from '../../types/common';

// How long the post-timeout poll runs (2 extra minutes) and the interval.
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_DURATION_MS = 120_000;

type Mode = 'workout' | 'meal' | 'insight' | null;

const FOCUS_OPTIONS = ['Strength', 'Hypertrophy', 'Endurance', 'Mobility'] as const;
const DAYS_PER_WEEK_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;
const INSIGHT_WINDOWS = [7, 14, 30] as const;

interface Props {
  clientId: string;
  clientName: string;
  /**
   * B14: Client safety context for the meal-plan generator. Always pass
   * these from ClientDetailScreen so the AI request carries the user's
   * stored allergies/restrictions. An undefined value means "not yet
   * loaded" and the meal-plan CTA is disabled to prevent a generator
   * call that misses safety constraints; an empty array means "loaded
   * and the user has none".
   */
  clientAllergies?: string[];
  clientDietaryRestrictions?: string[];
}

export default function CoachAiSection({
  clientId,
  clientName,
  clientAllergies,
  clientDietaryRestrictions,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation =
    useNavigation<NativeStackNavigationProp<ClientsStackParamList>>();

  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState<CoachAiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Post-timeout state: message shown while background poll is active,
  // and the draft that appeared (if any) so we can prompt the coach to review.
  const [timeoutMessage, setTimeoutMessage] = useState<string | null>(null);
  const [readyDraft, setReadyDraft] = useState<PendingDraftSummary | null>(null);

  // Pending AI drafts inbox — shown when coach explicitly checks or after timeout.
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxDrafts, setInboxDrafts] = useState<PendingDraftSummary[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);

  // Workout form state
  const [weeks, setWeeks] = useState<number>(4);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(4);
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const [workoutNotes, setWorkoutNotes] = useState<string>('');

  // Meal plan form state
  const [days, setDays] = useState<number>(7);
  const [mealNotes, setMealNotes] = useState<string>('');

  // Insight form state
  const [windowDays, setWindowDays] = useState<number>(7);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await coachAiApi.status();
      setStatus(res.data);
    } catch (err) {
      // Treat any non-2xx as "AI offline" so the section degrades
      // gracefully even if /status itself returns 5xx.
      console.warn('CoachAiSection: status fetch failed', err);
      setStatus({ ready: false, reason: 'status_unreachable' });
      setStatusError(errorMessage(err, 'AI status check failed.'));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ─── Post-timeout background poll ──────────────────────────────────────────────
  // When the 120-second axios timeout fires, the backend continues working.
  // Start polling GET /coach/ai/drafts?clientId=<id> every 10 s for 2 minutes
  // so if the draft completes we can surface it immediately.
  const startBackgroundPoll = useCallback((activeClientId: string) => {
    setTimeoutMessage('Still generating \u2014 this can take up to 2 minutes. Check your drafts inbox once ready.');
    setReadyDraft(null);

    const pollInterval = setInterval(async () => {
      try {
        const res = await coachAiApi.listDrafts({ clientId: activeClientId, limit: 1 });
        const drafts = res.data;
        if (drafts.length > 0) {
          clearInterval(pollInterval);
          setTimeoutMessage(null);
          setReadyDraft(drafts[0]);
        }
      } catch {
        // Poll silently; don't surface transient errors during background polling.
      }
    }, POLL_INTERVAL_MS);

    // Stop after 2 extra minutes regardless.
    const stopTimer = setTimeout(() => {
      clearInterval(pollInterval);
      setTimeoutMessage(null);
    }, POLL_MAX_DURATION_MS);

    // Return cleanup so callers can cancel early (e.g. component unmount).
    return () => {
      clearInterval(pollInterval);
      clearTimeout(stopTimer);
    };
  }, []);

  // ─── Pending drafts inbox ─────────────────────────────────────────────────────
  const openInbox = useCallback(async () => {
    setInboxOpen(true);
    setInboxLoading(true);
    setInboxError(null);
    try {
      const res = await coachAiApi.listDrafts({ clientId, limit: 20 });
      setInboxDrafts(res.data);
    } catch (err) {
      setInboxError(errorMessage(err, 'Could not load pending drafts.'));
    } finally {
      setInboxLoading(false);
    }
  }, [clientId]);

  // Navigate to the correct draft screen based on draft type.
  const navigateToDraft = useCallback(
    (draft: PendingDraftSummary) => {
      setInboxOpen(false);
      setReadyDraft(null);
      const draftId = draft.id;
      const screen = draftTypeToScreen(draft.type);
      if (screen) {
        navigation.navigate(screen as any, { draftId, clientId, clientName });
      }
    },
    [clientId, clientName, navigation],
  );

  const closeModal = () => {
    setMode(null);
    setSubmitError(null);
  };

  const handleSubmitWorkout = async () => {
    setSubmitError(null);
    setTimeoutMessage(null);
    setReadyDraft(null);
    setSubmitting(true);
    try {
      const res = await coachAiApi.generateWorkout({
        clientId,
        weeks,
        daysPerWeek,
        focus: focus || undefined,
        notes: workoutNotes.trim() || undefined,
      });
      const draftId = res.data.draftId;
      closeModal();
      navigation.navigate('AIWorkoutDraft', { draftId, clientId, clientName });
    } catch (err) {
      if (isTimeoutError(err)) {
        // Backend may still be generating. Close the form and start polling.
        closeModal();
        startBackgroundPoll(clientId);
      } else if (isAiDisabledError(err)) {
        setSubmitError('AI is offline — owner action required (set ANTHROPIC_API_KEY).');
        await fetchStatus();
      } else {
        setSubmitError(errorMessage(err, 'Could not generate program.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitMealPlan = async () => {
    setSubmitError(null);
    setTimeoutMessage(null);
    setReadyDraft(null);
    // B14: refuse to generate a meal plan when we have not been told what the
    // client's allergies are. `undefined` means the caller has not loaded the
    // profile yet; the array semantics (empty = none, present = these) match
    // profileCompletion.ts. This is the difference between "asked and said
    // none" vs. "we never asked" — the latter is unsafe input for the AI.
    if (clientAllergies === undefined || clientDietaryRestrictions === undefined) {
      setSubmitError(
        'Allergy and dietary info has not loaded yet. Reopen this client to retry.',
      );
      return;
    }
    setSubmitting(true);
    try {
      // Mirror safety fields into the user-facing notes so the LLM cannot
      // miss them even if the backend prompt template forgets a field.
      const composedNotes = [
        mealNotes.trim() || null,
        clientAllergies.length
          ? `Allergies: ${clientAllergies.join(', ')}.`
          : null,
        clientDietaryRestrictions.length
          ? `Dietary restrictions: ${clientDietaryRestrictions.join(', ')}.`
          : null,
      ]
        .filter(Boolean)
        .join(' ');
      const res = await coachAiApi.generateMealPlan({
        clientId,
        days,
        notes: composedNotes || undefined,
        allergies: clientAllergies,
        dietary_restrictions: clientDietaryRestrictions,
      });
      const draftId = res.data.draftId;
      closeModal();
      navigation.navigate('AIMealPlanDraft', { draftId, clientId, clientName });
    } catch (err) {
      if (isTimeoutError(err)) {
        closeModal();
        startBackgroundPoll(clientId);
      } else if (isAiDisabledError(err)) {
        setSubmitError('AI is offline — owner action required (set ANTHROPIC_API_KEY).');
        await fetchStatus();
      } else {
        setSubmitError(errorMessage(err, 'Could not generate meal plan.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitInsight = async () => {
    setSubmitError(null);
    setTimeoutMessage(null);
    setReadyDraft(null);
    setSubmitting(true);
    try {
      const res = await coachAiApi.generateInsight({ clientId, windowDays });
      const draftId = res.data.draftId;
      closeModal();
      navigation.navigate('ClientInsight', { draftId, clientId, clientName });
    } catch (err) {
      if (isTimeoutError(err)) {
        closeModal();
        startBackgroundPoll(clientId);
      } else if (isAiDisabledError(err)) {
        setSubmitError('AI is offline — owner action required (set ANTHROPIC_API_KEY).');
        await fetchStatus();
      } else {
        setSubmitError(errorMessage(err, 'Could not generate insight.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const ready = !!status?.ready;

  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>Coach AI</Text>
        {statusLoading ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : !ready ? (
          <View style={styles.offlinePill}>
            <Ionicons name="cloud-offline-outline" size={12} color={colors.textMuted} />
            <Text style={styles.offlinePillText}>Offline</Text>
          </View>
        ) : null}
      </View>

      {!ready && !statusLoading ? (
        <Text style={styles.offlineCaption} testID="coach-ai-offline-caption">
          AI offline — owner action required
        </Text>
      ) : null}
      {statusError ? (
        <Text style={styles.statusError}>{statusError}</Text>
      ) : null}

      <View style={styles.ctaRow}>
        <CoachAiCta
          icon="barbell-outline"
          label="Generate workout program"
          disabled={!ready}
          onPress={() => {
            setSubmitError(null);
            setMode('workout');
          }}
          testID="coach-ai-cta-workout"
        />
        <CoachAiCta
          icon="restaurant-outline"
          label="Generate meal plan"
          disabled={!ready}
          onPress={() => {
            setSubmitError(null);
            setMode('meal');
          }}
          testID="coach-ai-cta-meal"
        />
        <CoachAiCta
          icon="sparkles-outline"
          label="Generate weekly insight"
          disabled={!ready}
          onPress={() => {
            setSubmitError(null);
            setMode('insight');
          }}
          testID="coach-ai-cta-insight"
        />
      </View>

      {/* Post-timeout banners */}
      {timeoutMessage ? (
        <View style={styles.timeoutBanner} testID="coach-ai-timeout-banner">
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={styles.timeoutBannerText}>{timeoutMessage}</Text>
          <TouchableOpacity
            onPress={openInbox}
            accessibilityRole="button"
            accessibilityLabel="View pending drafts"
            style={styles.timeoutInboxBtn}
          >
            <Text style={styles.timeoutInboxBtnText}>View pending drafts</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {readyDraft ? (
        <TouchableOpacity
          style={styles.draftReadyBanner}
          onPress={() => navigateToDraft(readyDraft)}
          accessibilityRole="button"
          accessibilityLabel="Your draft is ready — tap to review"
          testID="coach-ai-draft-ready-banner"
        >
          <Ionicons name="checkmark-circle-outline" size={14} color={colors.success ?? colors.primary} />
          <Text style={styles.draftReadyText}>Your draft is ready — tap to review.</Text>
        </TouchableOpacity>
      ) : null}

      {/* Pending AI drafts inbox button */}
      {ready && !timeoutMessage && !readyDraft ? (
        <TouchableOpacity
          style={styles.inboxBtn}
          onPress={openInbox}
          accessibilityRole="button"
          accessibilityLabel="Check pending drafts"
          testID="coach-ai-inbox-btn"
        >
          <Ionicons name="albums-outline" size={14} color={colors.textMuted} />
          <Text style={styles.inboxBtnText}>Pending AI drafts</Text>
        </TouchableOpacity>
      ) : null}

      {/* Pending drafts inbox modal */}
      <Modal
        visible={inboxOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInboxOpen(false)}
      >
        <View style={styles.modalContainer}>
          <ModalHeader
            title="Pending AI drafts"
            onClose={() => setInboxOpen(false)}
          />
          <ScrollView contentContainerStyle={styles.modalContent}>
            {inboxLoading ? (
              <ActivityIndicator
                size="small"
                color={colors.textMuted}
                style={{ marginTop: 32 }}
              />
            ) : inboxError ? (
              <Text style={styles.formError}>{inboxError}</Text>
            ) : inboxDrafts.length === 0 ? (
              <Text style={styles.inboxEmpty}>
                No pending drafts for this client.
              </Text>
            ) : (
              inboxDrafts.map((draft) => (
                <TouchableOpacity
                  key={draft.id}
                  style={styles.inboxRow}
                  onPress={() => navigateToDraft(draft)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${draftTypeLabel(draft.type)} draft`}
                >
                  <View style={styles.inboxRowContent}>
                    <Text style={styles.inboxRowType}>{draftTypeLabel(draft.type)}</Text>
                    <Text style={styles.inboxRowMeta}>
                      {new Date(draft.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Workout modal */}
      <Modal
        visible={mode === 'workout'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <ModalHeader title="Generate workout program" onClose={closeModal} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.fieldLabel}>Weeks ({weeks})</Text>
            <NumberStepper
              value={weeks}
              min={1}
              max={12}
              onChange={setWeeks}
              testID="coach-ai-workout-weeks"
            />

            <Text style={styles.fieldLabel}>Days per week</Text>
            <View style={styles.chipRow}>
              {DAYS_PER_WEEK_OPTIONS.map((d) => (
                <Chip
                  key={d}
                  active={daysPerWeek === d}
                  label={String(d)}
                  onPress={() => setDaysPerWeek(d)}
                  testID={`coach-ai-workout-dpw-${d}`}
                />
              ))}
            </View>

            <Text style={styles.fieldLabel}>Focus (optional)</Text>
            <View style={styles.chipRow}>
              {FOCUS_OPTIONS.map((f) => (
                <Chip
                  key={f}
                  active={focus === f}
                  label={f}
                  onPress={() => setFocus((cur) => (cur === f ? undefined : f))}
                />
              ))}
            </View>

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.multiline]}
              placeholder="Injuries, equipment available, preferences…"
              placeholderTextColor={colors.textMuted}
              value={workoutNotes}
              onChangeText={setWorkoutNotes}
              multiline
              maxLength={500}
            />

            {submitError ? <Text style={styles.formError}>{submitError}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSubmitWorkout}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Generate workout program"
            >
              <Text style={styles.submitBtnText}>
                {submitting ? 'Generating…' : 'Generate'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Meal plan modal */}
      <Modal
        visible={mode === 'meal'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <ModalHeader title="Generate meal plan" onClose={closeModal} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.fieldLabel}>Days ({days})</Text>
            <NumberStepper
              value={days}
              min={1}
              max={14}
              onChange={setDays}
              testID="coach-ai-meal-days"
            />

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.multiline]}
              placeholder="Dietary restrictions, calorie target, preferences…"
              placeholderTextColor={colors.textMuted}
              value={mealNotes}
              onChangeText={setMealNotes}
              multiline
              maxLength={500}
            />

            {submitError ? <Text style={styles.formError}>{submitError}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSubmitMealPlan}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Generate meal plan"
            >
              <Text style={styles.submitBtnText}>
                {submitting ? 'Generating…' : 'Generate'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Insight modal */}
      <Modal
        visible={mode === 'insight'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <ModalHeader title="Generate weekly insight" onClose={closeModal} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.fieldLabel}>Window</Text>
            <View style={styles.chipRow}>
              {INSIGHT_WINDOWS.map((w) => (
                <Chip
                  key={w}
                  active={windowDays === w}
                  label={`${w} days`}
                  onPress={() => setWindowDays(w)}
                  testID={`coach-ai-insight-window-${w}`}
                />
              ))}
            </View>

            {submitError ? <Text style={styles.formError}>{submitError}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSubmitInsight}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Generate weekly insight"
            >
              <Text style={styles.submitBtnText}>
                {submitting ? 'Generating…' : 'Generate'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────


// ─── Pure helpers (no React) ──────────────────────────────────────────────────

function draftTypeLabel(type: CoachAiDraftType): string {
  switch (type) {
    case 'WORKOUT_PROGRAM': return 'Workout program';
    case 'MEAL_PLAN':       return 'Meal plan';
    case 'INSIGHT':         return 'Weekly insight';
    default:                return type;
  }
}

function draftTypeToScreen(
  type: CoachAiDraftType,
): 'AIWorkoutDraft' | 'AIMealPlanDraft' | 'ClientInsight' | null {
  switch (type) {
    case 'WORKOUT_PROGRAM': return 'AIWorkoutDraft';
    case 'MEAL_PLAN':       return 'AIMealPlanDraft';
    case 'INSIGHT':         return 'ClientInsight';
    default:                return null;
  }
}

function CoachAiCta({
  icon,
  label,
  disabled,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.cta, disabled && styles.ctaDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      testID={testID}
    >
      <Ionicons
        name={icon}
        size={20}
        color={disabled ? colors.textMuted : colors.primary}
      />
      <Text style={[styles.ctaText, disabled && styles.ctaTextDisabled]} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.modalHeader}>
      <Text style={styles.modalTitle}>{title}</Text>
      <TouchableOpacity
        onPress={onClose}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Ionicons name="close" size={24} color={colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );
}

function Chip({
  active,
  label,
  onPress,
  testID,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function NumberStepper({
  value,
  min,
  max,
  onChange,
  testID,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View style={styles.stepper} testID={testID}>
      <TouchableOpacity
        style={styles.stepperBtn}
        onPress={dec}
        accessibilityRole="button"
        accessibilityLabel="Decrease"
      >
        <Ionicons name="remove" size={18} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.stepperValue}>{value}</Text>
      <TouchableOpacity
        style={styles.stepperBtn}
        onPress={inc}
        accessibilityRole="button"
        accessibilityLabel="Increase"
      >
        <Ionicons name="add" size={18} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.stepperRange}>
        ({min}–{max})
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    section: {
      marginTop: 8,
      marginBottom: 8,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
      marginTop: 4,
    },
    sectionTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 20,
      lineHeight: 24,
      letterSpacing: 0.4,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    offlinePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: colors.surfaceElevated,
      borderRadius: 4,
    },
    offlinePillText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 10,
      fontWeight: '500',
      letterSpacing: 1.5,
      color: colors.textMuted,
      textTransform: 'uppercase',
    },
    offlineCaption: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
      marginBottom: 10,
    },
    statusError: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.error,
      marginBottom: 10,
    },
    ctaRow: {
      gap: 8,
      marginBottom: 8,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      backgroundColor: colors.primaryPale,
      borderRadius: 4,
    },
    ctaDisabled: {
      backgroundColor: colors.surfaceElevated,
      opacity: 0.6,
    },
    ctaText: {
      flex: 1,
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      fontWeight: '500',
      letterSpacing: 0.4,
      color: colors.primary,
    },
    ctaTextDisabled: {
      color: colors.textMuted,
    },
    // ── Modal ────────────────────────────────────────────────────────────
    modalContainer: { flex: 1, backgroundColor: colors.background },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 22,
      lineHeight: 26,
      letterSpacing: 0.5,
      fontWeight: '400',
      color: colors.textPrimary,
    },
    modalContent: { padding: 20, paddingBottom: 60 },
    fieldLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 11,
      fontWeight: '500',
      color: colors.textMuted,
      marginTop: 12,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 1.98,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 4,
    },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      color: colors.textSecondary,
      letterSpacing: 0.4,
    },
    chipTextActive: {
      color: colors.textOnPrimary,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginVertical: 4,
    },
    stepperBtn: {
      width: 36,
      height: 36,
      borderRadius: 4,
      backgroundColor: colors.primaryPale,
      justifyContent: 'center',
      alignItems: 'center',
    },
    stepperValue: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 22,
      fontWeight: '500',
      color: colors.textPrimary,
      minWidth: 32,
      textAlign: 'center',
    },
    stepperRange: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
    },
    textInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      padding: 12,
      fontSize: 14,
      color: colors.textPrimary,
      marginTop: 4,
    },
    multiline: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    formError: {
      color: colors.error,
      fontSize: 13,
      marginTop: 12,
    },
    submitBtn: {
      backgroundColor: colors.primary,
      borderRadius: 4,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 20,
    },
    submitBtnText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textOnPrimary,
    },
    // ── Post-timeout & inbox ────────────────────────────────────────────────────
    timeoutBanner: {
      flexDirection: 'column' as const,
      gap: 6,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: colors.surfaceElevated,
      borderRadius: 4,
      marginBottom: 8,
    },
    timeoutBannerText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
      flex: 1,
    },
    timeoutInboxBtn: {
      alignSelf: 'flex-start' as const,
      marginTop: 4,
    },
    timeoutInboxBtnText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      color: colors.primary,
      letterSpacing: 0.4,
    },
    draftReadyBanner: {
      flexDirection: 'row' as const,
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: colors.primaryPale,
      borderRadius: 4,
      marginBottom: 8,
    },
    draftReadyText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      fontWeight: '500',
      color: colors.primary,
      flex: 1,
    },
    inboxBtn: {
      flexDirection: 'row' as const,
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 2,
      marginBottom: 4,
    },
    inboxBtnText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
    },
    inboxEmpty: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center' as const,
      marginTop: 32,
    },
    inboxRow: {
      flexDirection: 'row' as const,
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 0,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    inboxRowContent: {
      flex: 1,
      gap: 2,
    },
    inboxRowType: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    inboxRowMeta: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
    },
  });
