/**
 * AiTriageCard — v2-4 community AI inbox-triage banner.
 *
 * A single, calm card pinned above the coach inbox list that summarises the
 * coach's unanswered items into the five fixed triage categories
 * (growth-project-backend/src/community/ai-triage/triage-output.schema.ts:26-32).
 * It is a READING AID, not an actor: it never sends, replies, or posts — it
 * only shows how many unanswered items fall into each category so the coach can
 * prioritise. Tapping a category is out of scope for this card (the human inbox
 * below remains the single place actions happen).
 *
 * Doctrine:
 *   - Visually DISTINCT from human rows: a left accent rule (outline, not a
 *     fill) and an explicit "AI triage" eyebrow so it never reads as a client
 *     message. Clearly labelled AI-generated (eyebrow + a11y label).
 *   - Semantic tokens only (no raw hex); font-weight <= 600; 48dp min row
 *     height on the interactive header; reduced-motion safe (no animation).
 *   - Typed empty + error states (never a fabricated "all clear", never a
 *     panicky error). `urgent` framing is professional prioritisation copy.
 *   - a11y: the header summarises the whole card for a screen reader; each
 *     category line has its own label with the count.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, typography } from '../../theme/tokens';
import HapticPressable from '../HapticPressable';
import type { TriageCategory, TriageResponse } from '../../api/communityAiTriageApi';
import { TRIAGE_CATEGORIES } from '../../api/communityAiTriageApi';

// Professional, calm display copy per category. `urgent` is framed as a
// prioritisation signal ("Needs you soon") — never alarmist or medical.
const CATEGORY_LABEL: Record<TriageCategory, string> = {
  urgent: 'Needs you soon',
  win_to_celebrate: 'Wins to celebrate',
  form_check: 'Form checks',
  general: 'General replies',
  no_action_needed: 'No action needed',
};

type Status = 'loading' | 'error' | 'empty' | 'ready';

interface Counts {
  category: TriageCategory;
  label: string;
  count: number;
}

function countByCategory(triage: TriageResponse): Counts[] {
  return TRIAGE_CATEGORIES.map((category) => {
    const bucket = triage.buckets.find((b) => b.category === category);
    return {
      category,
      label: CATEGORY_LABEL[category],
      count: bucket ? bucket.items.length : 0,
    };
  });
}

export interface AiTriageCardProps {
  status: Status;
  triage?: TriageResponse;
  onRetry?: () => void;
  retrying?: boolean;
  testID?: string;
}

/**
 * Presentational triage card. The screen owns the data hook and passes a typed
 * status in, so this component stays pure and trivially testable across its
 * loading / error / empty / populated states.
 */
export default function AiTriageCard({
  status,
  triage,
  onRetry,
  retrying = false,
  testID = 'ai-triage-card',
}: AiTriageCardProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const eyebrow = (
    <Text
      style={[styles.eyebrow, { color: semanticColors.textMuted }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      AI triage
    </Text>
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <View
        testID={`${testID}-loading`}
        accessibilityRole="progressbar"
        accessibilityLabel="AI triage is preparing your inbox summary."
        style={[
          styles.card,
          { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
          { borderLeftColor: semanticColors.accent },
        ]}
      >
        {eyebrow}
        <Text style={[styles.bodyText, { color: semanticColors.textMuted }]}>
          Preparing your inbox summary…
        </Text>
      </View>
    );
  }

  // ── Error (calm, recoverable — never panicky, never a fake all-clear) ───────
  if (status === 'error') {
    return (
      <View
        testID={`${testID}-error`}
        accessibilityRole="summary"
        accessibilityLabel="AI triage is unavailable right now. Your inbox below is unaffected."
        style={[
          styles.card,
          { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
          { borderLeftColor: semanticColors.accent },
        ]}
      >
        {eyebrow}
        <Text style={[styles.bodyText, { color: semanticColors.textPrimary }]}>
          Triage is unavailable right now. Your inbox below is unaffected.
        </Text>
        {onRetry ? (
          <HapticPressable
            intent="light"
            onPress={onRetry}
            disabled={retrying}
            accessibilityRole="button"
            accessibilityLabel="Retry AI triage"
            accessibilityState={{ disabled: retrying }}
            testID={`${testID}-retry`}
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accent }]}>
              {retrying ? 'Retrying…' : 'Retry'}
            </Text>
          </HapticPressable>
        ) : null}
      </View>
    );
  }

  // ── Ready ───────────────────────────────────────────────────────────────
  const counts = triage ? countByCategory(triage) : [];
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  // `empty` is now a first-class typed status passed by the caller. The all-zero
  // / missing-data check is kept here purely as a DEFENSIVE guard so a `ready`
  // status with nothing to show can never render a fabricated summary — it is
  // not the primary state path.
  const isEmpty = status === 'empty' || !triage || triage.is_empty || total === 0;

  // Typed empty state: an honest "nothing to triage", never a fabricated read.
  if (isEmpty) {
    return (
      <View
        testID={`${testID}-empty`}
        accessibilityRole="summary"
        accessibilityLabel="AI triage: no unanswered items to summarise right now."
        style={[
          styles.card,
          { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
          { borderLeftColor: semanticColors.accent },
        ]}
      >
        {eyebrow}
        <Text style={[styles.bodyText, { color: semanticColors.textMuted }]}>
          Nothing to triage right now.
        </Text>
      </View>
    );
  }

  const summaryLabel = `AI triage summary: ${total} unanswered ${
    total === 1 ? 'item' : 'items'
  }. ${counts
    .filter((c) => c.count > 0)
    .map((c) => `${c.count} ${c.label}`)
    .join(', ')}. Tap to ${expanded ? 'collapse' : 'expand'} the breakdown.`;

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
        { borderLeftColor: semanticColors.accent },
      ]}
    >
      <HapticPressable
        intent="light"
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={summaryLabel}
        accessibilityState={{ expanded }}
        testID={`${testID}-header`}
        style={styles.header}
      >
        <View style={styles.headerText}>
          {eyebrow}
          <Text style={[styles.title, { color: semanticColors.textPrimary }]}>
            {total} unanswered {total === 1 ? 'item' : 'items'}
          </Text>
        </View>
        <Text style={[styles.chevron, { color: semanticColors.textMuted }]}>
          {expanded ? 'Hide' : 'Show'}
        </Text>
      </HapticPressable>

      {expanded ? (
        <View style={styles.breakdown} testID={`${testID}-breakdown`}>
          {counts.map((c) => (
            <View
              key={c.category}
              style={styles.categoryRow}
              accessibilityRole="text"
              accessibilityLabel={`${c.count} ${c.label}`}
              testID={`${testID}-category-${c.category}`}
            >
              <Text
                style={[styles.categoryLabel, { color: semanticColors.textPrimary }]}
                numberOfLines={1}
              >
                {c.label}
              </Text>
              <Text
                style={[styles.categoryCount, { color: semanticColors.textMuted }]}
                testID={`${testID}-count-${c.category}`}
              >
                {c.count}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// The left accent rule is the AI marker — an OUTLINE, not a fill. Tokenized as
// a named hairline-scale constant so the rule width stays on the design grid
// rather than a magic number.
const ACCENT_RULE_WIDTH = spacing.xs - 1;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    // The left rule is the AI marker — an accent OUTLINE, not a fill, so the
    // card stays calm and never competes with a human row's solid surface.
    borderLeftWidth: ACCENT_RULE_WIDTH,
    padding: spacing.md,
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.eyebrow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  title: {
    ...typography.bodyMd,
  },
  chevron: {
    ...typography.bodySmall,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  bodyText: {
    ...typography.bodySmall,
  },
  retry: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  retryLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  breakdown: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  categoryLabel: {
    ...typography.bodySmall,
    flex: 1,
    marginRight: spacing.sm,
  },
  categoryCount: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
});
