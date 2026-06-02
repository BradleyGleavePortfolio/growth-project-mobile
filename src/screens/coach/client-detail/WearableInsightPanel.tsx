/**
 * WearableInsightPanel — the small, progressively-disclosed coach AI insight
 * card (PR-HK-5a). Placed below the anomaly band on the coach client-detail
 * Fitness and Recovery tabs (UX plan §4.4). NOT a full chat — a restrained
 * card that collapses to a one-line observation + a neutral confidence chip
 * and expands to the full observation → hypothesis → suggested action → draft
 * preview → "Review message" CTA (UX plan §4.5, §6.1).
 *
 * Design intelligence mapped:
 *   - Progressive disclosure (bible §4.5): collapsed by default, the whole card
 *     is the tap target; expanded reveals the four fields + CTA.
 *   - Bucket tint at low saturation (UX §4.4): reuses HK-3a/3b `toneTokens`
 *     (warm = H&F, cool = S&R). NO hex literals — design tokens only.
 *   - Confidence chip is neutral, never green-for-good (UX §6.3 / bible §4.7).
 *   - CALM error/empty handling (bible §2.2): every loading/empty/error state
 *     carries copy + (where applicable) a CTA; never a bare spinner (R0).
 *   - Reduce-motion honoured (a11y): the expand fade respects
 *     `useReduceMotion()`, mirroring HK-3b `HrvTrendCard`.
 *
 * Honesty / graceful degradation (#36/#50): the approve endpoint is HK-6's;
 * pre-HK-6 the api coerces 404 → typed `not_implemented`, and this panel shows
 * a calm, recoverable "rolling out — try again later" message with the primary
 * CTA disabled, never a silent failure.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { ZodError } from 'zod';

import {
  colors,
  radius,
  spacing,
  typography,
  withAlpha,
} from '../../../theme/tokens';
import { SkeletonLine } from '../../../components/SkeletonLoader';
import { useReduceMotion } from '../../client/wearables/components/useReduceMotion';
import { toneForBucket, toneTokens } from '../../client/wearables/wearablesTheme';
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_PCT,
  isEmptyInsight,
  type CoachInsight,
  type ConfidenceLevel,
  type WearableMetricBucket,
} from '../../../api/wearableInsightsApi';
import { useApproveDraft, useCoachInsight } from '../../../hooks/useWearableInsight';

const DRAFT_MAX = 1000;
const DRAFT_PREVIEW_LINES = 2;
/** How long the post-send forward hook holds before the panel refetches (§5.3). */
const FORWARD_HOOK_MS = 3_000;

export interface WearableInsightPanelProps {
  /** Which surface this panel renders for. HK-5a ships the coach side. */
  side: 'coach';
  bucket: WearableMetricBucket;
  clientId: string;
  /**
   * Client's first name for the post-send closure copy ("Sent to Maria",
   * UX §4.5 step 5). Optional — the host tab does not currently thread the
   * name through, so we fall back to a warm, honest generic ("Sent to your
   * client") rather than rendering an empty name.
   */
  clientFirstName?: string;
}

/**
 * Map a thrown fetch error to sanitized, user-safe copy (#12 — never leak
 * stack traces / internal paths / query text to the surface). Status-aware so
 * the coach gets an actionable line, not a raw message.
 */
function sanitizeError(error: unknown): string {
  if (error instanceof ZodError) {
    return "This insight came back in an unexpected shape. We're looking into it.";
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    if (status === 403) return "You don't have access to this client's insights.";
    if (status === 404) return 'No insight is available for this client yet.';
    if (status >= 500) return 'The server is temporarily unavailable.';
    if (status === 0) return 'Check your connection and try again.';
  }
  return "We couldn't load this insight.";
}

export function WearableInsightPanel({
  bucket,
  clientId,
  clientFirstName,
}: WearableInsightPanelProps) {
  const tone = toneTokens(toneForBucket(bucket));
  const reduceMotion = useReduceMotion();

  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftPreviewExpanded, setDraftPreviewExpanded] = useState(false);
  // Holds the forward-hook copy after a successful send (§5.3); null otherwise.
  const [sentHook, setSentHook] = useState<string | null>(null);

  const query = useCoachInsight({ clientId, bucket });

  // ── Expand fade (reduce-motion aware), mirroring HK-3b HrvTrendCard. ──
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!expanded) {
      fade.setValue(0);
      return;
    }
    if (reduceMotion) {
      fade.setValue(1);
      return;
    }
    const anim = Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [expanded, reduceMotion, fade]);

  // After a successful send, hold the forward hook, then refetch (§5.3).
  useEffect(() => {
    if (sentHook == null) return;
    const t = setTimeout(() => {
      setSentHook(null);
      void query.refetch();
    }, FORWARD_HOOK_MS);
    return () => clearTimeout(t);
    // `query` is stable enough here; we intentionally key only off the hook so
    // the timer is not reset by unrelated query-object identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentHook]);

  const onToggle = useCallback(() => setExpanded((v) => !v), []);
  const onOpenSheet = useCallback(() => setSheetOpen(true), []);
  const onCloseSheet = useCallback(() => setSheetOpen(false), []);
  const onSent = useCallback(
    (firstName?: string) => {
      setSheetOpen(false);
      setSentHook(`Sent to ${firstName && firstName.length > 0 ? firstName : 'your client'}`);
    },
    [],
  );

  const onRetry = useCallback(() => {
    void query.refetch();
  }, [query]);

  // ── Post-send forward hook (§5.3) takes over the card briefly. ──
  if (sentHook != null) {
    return (
      <View
        style={[styles.card, { borderColor: tone.track, backgroundColor: tone.tint }]}
        testID="coach-insight-sent"
      >
        <View style={styles.row}>
          <Ionicons name="checkmark-circle-outline" size={18} color={tone.accent} />
          <Text style={styles.sentText} accessibilityRole="text">
            {sentHook}
          </Text>
        </View>
        <Text style={styles.secondary}>
          We&apos;ll fold their reply into the next insight.
        </Text>
      </View>
    );
  }

  // ── Loading: skeleton, never a bare spinner (R0). ──
  if (query.isLoading) {
    return (
      <View
        style={[styles.card, { borderColor: tone.track }]}
        accessibilityLabel="Loading coach AI insight"
        testID="coach-insight-loading"
      >
        <View style={styles.headerRow}>
          <SkeletonLine width="62%" height={14} />
          <SkeletonLine width={86} height={20} />
        </View>
        <SkeletonLine width="90%" height={12} style={styles.skeletonGap} />
        <SkeletonLine width="74%" height={12} style={styles.skeletonGap} />
      </View>
    );
  }

  // ── Error: sanitized copy + secondary line + Retry (R0: copy + CTA). ──
  if (query.isError) {
    const secondary = sanitizeError(query.error);
    return (
      <View
        style={[styles.card, { borderColor: tone.track }]}
        testID="coach-insight-error"
      >
        <View style={styles.row}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.stone} />
          <Text style={styles.primary} accessibilityRole="alert">
            We couldn&apos;t load this insight.
          </Text>
        </View>
        <Text style={styles.secondary} numberOfLines={1}>
          {secondary}
        </Text>
        <Pressable
          style={[styles.retryBtn, { borderColor: tone.accent }]}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading the insight"
          testID="coach-insight-retry"
        >
          <Text style={[styles.retryText, { color: tone.accent }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const insight = query.data;
  if (insight == null) {
    // Defensive: a settled, non-error query with no data. Treat as empty copy
    // rather than rendering nothing (never a blank card).
    return <EmptyPanel tone={tone} />;
  }

  // ── Empty branch (is_empty): literal copy + secondary line, NO chip. ──
  if (isEmptyInsight(insight)) {
    return <EmptyPanel tone={tone} />;
  }

  const level = insight.confidence_level;

  return (
    <>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Coach AI insight, ${CONFIDENCE_LABEL[level]}, ${insight.observation}, tap to expand`}
        style={[styles.card, { borderColor: tone.track, backgroundColor: tone.tint }]}
        testID="coach-insight-panel"
      >
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <Ionicons name="sparkles-outline" size={14} color={tone.accent} />
            <Text style={styles.observation} numberOfLines={expanded ? undefined : 1}>
              {insight.observation}
            </Text>
          </View>
          <ConfidenceChip level={level} accent={tone.accent} />
        </View>

        {expanded && (
          <Animated.View style={{ opacity: fade }} testID="coach-insight-expanded">
            <Field label="Hypothesis" value={insight.hypothesis} />
            <Field label="Suggested action" value={insight.suggested_action} />

            <Text style={styles.fieldLabel}>Draft message</Text>
            <Text
              style={styles.draftPreview}
              numberOfLines={draftPreviewExpanded ? undefined : DRAFT_PREVIEW_LINES}
            >
              {insight.suggested_message_draft}
            </Text>
            <Pressable
              onPress={() => setDraftPreviewExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={draftPreviewExpanded ? 'Show less of the draft' : 'Read more of the draft'}
              testID="coach-insight-readmore"
            >
              <Text style={[styles.readMore, { color: tone.accent }]}>
                {draftPreviewExpanded ? 'Show less' : 'Read more'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.reviewCta, { backgroundColor: tone.accent }]}
              onPress={onOpenSheet}
              accessibilityRole="button"
              accessibilityLabel="Review message before sending"
              testID="coach-insight-review-cta"
            >
              <Ionicons name="create-outline" size={16} color={colors.bone} />
              <Text style={styles.reviewCtaText}>Review message</Text>
            </Pressable>
          </Animated.View>
        )}
      </Pressable>

      {sheetOpen && (
        <MessageDraftReviewSheet
          visible={sheetOpen}
          insight={insight}
          clientId={clientId}
          bucket={bucket}
          clientFirstName={clientFirstName}
          accent={tone.accent}
          onClose={onCloseSheet}
          onSent={onSent}
        />
      )}
    </>
  );
}

/** The "not enough data" empty surface (UX §3.4). NO confidence chip. */
function EmptyPanel({ tone }: { tone: ReturnType<typeof toneTokens> }) {
  return (
    <View
      style={[styles.card, { borderColor: tone.track }]}
      testID="coach-insight-empty"
    >
      <View style={styles.row}>
        <Ionicons name="hourglass-outline" size={18} color={colors.stone} />
        <Text style={styles.primary}>Not enough data yet — keep syncing.</Text>
      </View>
      <Text style={styles.secondary}>
        Once we have ~3 days of data, your AI will flag patterns.
      </Text>
    </View>
  );
}

/** Neutral confidence pill — label + percentage. Never green-for-good (§6.3). */
function ConfidenceChip({
  level,
  accent,
}: {
  level: ConfidenceLevel;
  accent: string;
}) {
  return (
    <View
      style={[styles.chip, { borderColor: withAlpha(accent, 0.4) }]}
      accessibilityLabel={`Confidence: ${CONFIDENCE_LABEL[level]}, ${CONFIDENCE_PCT[level]} percent`}
      testID="coach-insight-confidence"
    >
      <Text style={styles.chipText}>
        {CONFIDENCE_LABEL[level]} ({CONFIDENCE_PCT[level]}%)
      </Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

/**
 * MessageDraftReviewSheet — the review / edit / approve modal (UX §4.5).
 * Editable multiline draft, three actions (Approve & send / Edit then send /
 * Dismiss). Never auto-sends. Pre-HK-6 the approve hits a 404 that the api
 * coerces to `not_implemented`; we show calm copy + keep the sheet open and
 * disable the primary CTA (graceful degradation, #36/#50).
 */
function MessageDraftReviewSheet({
  visible,
  insight,
  clientId,
  bucket,
  clientFirstName,
  accent,
  onClose,
  onSent,
}: {
  visible: boolean;
  insight: CoachInsight;
  clientId: string;
  bucket: WearableMetricBucket;
  clientFirstName?: string;
  accent: string;
  onClose: () => void;
  onSent: (firstName?: string) => void;
}) {
  const original = insight.suggested_message_draft;
  const [body, setBody] = useState(original);
  // Set when the backend returns the pre-HK-6 not_implemented response.
  const [pending, setPending] = useState<string | null>(null);
  // Set when the mutation throws a real error.
  const [errorCopy, setErrorCopy] = useState<string | null>(null);

  const approve = useApproveDraft();
  const edited = body.trim() !== original.trim();

  const run = useCallback(
    (action: 'approve' | 'edit' | 'dismiss', draftBody: string) => {
      setPending(null);
      setErrorCopy(null);
      approve.mutate(
        { clientId, bucket, draftBody, action },
        {
          onSuccess: (res) => {
            if (res.status === 'ok') {
              onSent(clientFirstName);
            } else {
              // not_implemented — keep the sheet open, calm copy, CTA off.
              setPending(res.message);
            }
          },
          onError: (err) => {
            setErrorCopy(sanitizeError(err));
          },
        },
      );
    },
    [approve, clientId, bucket, clientFirstName, onSent],
  );

  const busy = approve.isPending;
  const primaryDisabled = busy || pending != null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.scrim}
        accessibilityRole="button"
        accessibilityLabel="Dismiss the review sheet"
        onPress={onClose}
      >
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} accessibilityElementsHidden />
          <Text style={styles.sheetTitle} accessibilityRole="header">
            Review message
          </Text>
          <Text style={styles.secondary}>
            Edit if you like — nothing sends until you approve.
          </Text>

          <TextInput
            style={styles.input}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={DRAFT_MAX}
            accessibilityLabel="Editable message draft"
            testID="coach-insight-draft-input"
            placeholder="Message to your client"
            placeholderTextColor={colors.stone}
          />
          <Text style={styles.charCount}>
            {body.length}/{DRAFT_MAX}
          </Text>

          {pending != null && (
            <Text style={styles.pendingCopy} accessibilityRole="alert" testID="coach-insight-pending">
              {pending}
            </Text>
          )}
          {errorCopy != null && (
            <View style={styles.sheetErrorRow}>
              <Text style={styles.errorCopy} accessibilityRole="alert" testID="coach-insight-sheet-error">
                {errorCopy}
              </Text>
              <Pressable
                onPress={() => run(edited ? 'edit' : 'approve', body)}
                accessibilityRole="button"
                accessibilityLabel="Retry sending"
                testID="coach-insight-sheet-retry"
              >
                <Text style={[styles.readMore, { color: accent }]}>Retry</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            style={[
              styles.primaryBtn,
              { backgroundColor: primaryDisabled ? colors.stone : accent },
            ]}
            onPress={() => run('approve', original)}
            disabled={primaryDisabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: primaryDisabled, busy }}
            accessibilityLabel="Approve and send the message"
            testID="coach-insight-approve"
          >
            {busy ? (
              <ActivityIndicator color={colors.bone} />
            ) : (
              <Text style={styles.primaryBtnText}>Approve &amp; send</Text>
            )}
          </Pressable>

          <Pressable
            style={[
              styles.secondaryBtn,
              { borderColor: edited && !primaryDisabled ? accent : colors.stone },
            ]}
            onPress={() => run('edit', body)}
            disabled={!edited || primaryDisabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: !edited || primaryDisabled }}
            accessibilityLabel="Send your edited message"
            testID="coach-insight-edit-send"
          >
            <Text
              style={[
                styles.secondaryBtnText,
                { color: edited && !primaryDisabled ? accent : colors.stone },
              ]}
            >
              Edit then send
            </Text>
          </Pressable>

          <Pressable
            style={styles.ghostBtn}
            onPress={() => run('dismiss', '')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Dismiss this insight"
            testID="coach-insight-dismiss"
          >
            <Text style={styles.ghostBtnText}>Dismiss</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  observation: {
    ...typography.bodyMd,
    color: colors.ink,
    flex: 1,
  },
  primary: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
  secondary: {
    ...typography.bodySmall,
    color: colors.charcoal,
    marginTop: spacing.xs,
  },
  sentText: {
    ...typography.bodyMd,
    color: colors.ink,
    flex: 1,
  },
  skeletonGap: {
    marginTop: spacing.sm,
  },
  field: {
    marginTop: spacing.md,
  },
  fieldLabel: {
    ...typography.eyebrow,
    color: colors.charcoal,
    marginTop: spacing.md,
  },
  fieldValue: {
    ...typography.body,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  draftPreview: {
    ...typography.body,
    color: colors.charcoal,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  readMore: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
  },
  reviewCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  reviewCtaText: {
    ...typography.bodyMd,
    color: colors.bone,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2 + 1,
    backgroundColor: colors.bone,
  },
  chipText: {
    ...typography.micro,
    color: colors.charcoal,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  retryText: {
    ...typography.bodyMd,
  },
  // ── Sheet ──
  scrim: {
    flex: 1,
    backgroundColor: withAlpha(colors.ink, 0.45),
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bone,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.stone,
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  input: {
    ...typography.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.camel,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 96,
    textAlignVertical: 'top',
    marginTop: spacing.md,
  },
  charCount: {
    ...typography.micro,
    color: colors.stone,
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
  },
  pendingCopy: {
    ...typography.bodySmall,
    color: colors.charcoal,
    marginTop: spacing.sm,
  },
  sheetErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  errorCopy: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
  },
  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
    minHeight: 48,
  },
  primaryBtnText: {
    ...typography.bodyMd,
    color: colors.bone,
  },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  secondaryBtnText: {
    ...typography.bodyMd,
  },
  ghostBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  ghostBtnText: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
});

export default WearableInsightPanel;
