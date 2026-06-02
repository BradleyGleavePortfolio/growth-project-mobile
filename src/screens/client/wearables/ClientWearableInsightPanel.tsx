/**
 * ClientWearableInsightPanel — the client-side AI insight card (PR-HK-5b).
 *
 * Mounted into each bucket screen's `aiPanelSlot` by `WearablesShell` and
 * rendered at the end of the scroll content on the Health & Fitness and
 * Sleep & Recovery surfaces (UX plan §4.4–4.5). This is the CLIENT surface:
 * read-only and simpler than the HK-5a coach panel — there is NO review sheet,
 * NO message editor, and NO approve/dismiss controls (approval is coach-only,
 * HK-6). The client only ever READS `/v1/wearables/insights/client`.
 *
 * Design intelligence mapped:
 *   - Bucket tint at low saturation (UX §4.4): reuses the HK-3a/3b `toneTokens`
 *     (warm = H&F, cool = S&R). NO raw hex literals — design tokens only.
 *   - Confidence chip is a NEUTRAL pill, never green-for-good (UX §6.3 /
 *     MOBILE_APP_DESIGN_INTELLIGENCE §4.7): tone.accent border + low-alpha fill,
 *     charcoal text.
 *   - Progressive disclosure / skeleton-of-the-real-layout (§4.5): the loading
 *     state mirrors the header + three body lines + CTA the loaded card shows.
 *   - CALM warmth on the empty state (§2.2): the "we computed nothing" branch
 *     reads as a calm promise, not a failure — no error styling, no chip, no CTA.
 *   - Reduce-motion honoured (a11y): the skeleton shimmer is suppressed when the
 *     OS reduce-motion setting is on, mirroring `useReduceMotion()` usage across
 *     the wearables surface.
 *
 * Honesty / graceful degradation (#35/#36/#50): every branch renders real copy
 * — loading is a skeleton (never a bare spinner, R0), error is a sanitized
 * one-liner + a Retry that refetches, empty is calm guidance. The optional CTA
 * deep-link is re-validated against the `tgp://` scheme before opening as
 * defence-in-depth (#5/#8) even though the backend schema already enforces it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { ZodError } from 'zod';

import {
  radius,
  spacing,
  typography,
  withAlpha,
  type SemanticTokens,
} from '../../../theme/tokens';
import { useTheme } from '../../../theme/useTheme';
import { logger } from '../../../utils/logger';
import { useReduceMotion } from './components/useReduceMotion';
import { toneForBucket, toneTokens, type ToneTokens } from './wearablesTheme';
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_PCT,
  isEmptyInsight,
  type ClientInsight,
  type ConfidenceLevel,
  type WearableMetricBucket,
} from '../../../api/wearableInsightsApi';
import { useClientInsight } from '../../../hooks/useWearableInsight';

/** Deep-link scheme the backend guarantees and we re-verify before opening. */
const DEEP_LINK_SCHEME = /^tgp:\/\//;

/**
 * The card root is a labelled landmark for screen readers. React Native's typed
 * `AccessibilityRole` has no web-style `'region'` landmark; `'summary'` is its
 * blessed equivalent for a self-contained, labelled content region, and it is
 * the role that surfaces the card's `accessibilityLabel` as a navigable region
 * to VoiceOver / TalkBack. Centralised here so all three card states agree.
 */
const CARD_REGION_ROLE = 'summary' as const;

/** Human-readable bucket label for the card's accessibility region. */
const BUCKET_LABEL: Record<WearableMetricBucket, string> = {
  HEALTH_FITNESS: 'Health & Fitness',
  SLEEP_RECOVERY: 'Sleep & Recovery',
};

/** Bucket glyph for the header row (mirrors the wearables surface idiom). */
const BUCKET_ICON: Record<WearableMetricBucket, 'barbell-outline' | 'moon-outline'> = {
  HEALTH_FITNESS: 'barbell-outline',
  SLEEP_RECOVERY: 'moon-outline',
};

export interface ClientWearableInsightPanelProps {
  readonly bucket: WearableMetricBucket; // 'HEALTH_FITNESS' | 'SLEEP_RECOVERY'
  /**
   * Test-only handle so the test harness can pre-seed deep-link interactions.
   * Production code should NOT pass this — the panel resolves Linking.openURL
   * itself. Use this ONLY in `__tests__/`.
   */
  readonly onCtaPress?: (deepLink: string) => void;
}

/**
 * Map a thrown fetch error to sanitized, user-safe copy (#12 — never leak
 * stack traces / internal paths / query text to the surface). Duplicated
 * locally from the coach panel rather than extracted to `wearablesTheme.ts`,
 * because extraction would touch the out-of-scope coach file (per the brief).
 */
function sanitizeWearableError(error: unknown): string {
  if (error instanceof ZodError) {
    return "This insight came back in an unexpected shape. We're looking into it.";
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    if (status === 401 || status === 403) {
      return 'Please sign in again to see your insights.';
    }
    if (status === 404) return 'No insight is available yet.';
    if (status >= 500) return 'The server is temporarily unavailable.';
    if (status === 0) return 'Check your connection and try again.';
  }
  return "We couldn't load this insight.";
}

export function ClientWearableInsightPanel({
  bucket,
  onCtaPress,
}: ClientWearableInsightPanelProps) {
  const { semanticColors, colorScheme } = useTheme();
  // Resolve the tone for the CURRENT colour scheme so on-surface affordances
  // (Retry text/border, Read more) use a scheme-reactive ink that clears AA
  // against the dark card surface (#1C1A18). The CTA fill keeps `accentInk`.
  const tone = toneTokens(toneForBucket(bucket), colorScheme);
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const reduceMotion = useReduceMotion();
  const query = useClientInsight({ bucket });

  // Guard against a double-tap firing two navigations (#28): the CTA is
  // disabled only while a deep-link open is in flight, then re-enabled in
  // `.finally` so a successful open does not permanently latch it disabled.
  const [ctaOpening, setCtaOpening] = useState(false);

  const onRetry = useCallback(() => {
    void query.refetch();
  }, [query]);

  const onCta = useCallback(
    (deepLink: string) => {
      if (ctaOpening) return;
      // Defence-in-depth (#5/#8): the backend schema already enforces `tgp://`,
      // but we re-verify before opening so a drifted/forged value can never
      // reach `Linking.openURL`. A failed check is a no-op with a logged
      // breadcrumb — never a thrown error, never a silent swallow (#36).
      if (!DEEP_LINK_SCHEME.test(deepLink)) {
        logger.warn(
          'ClientWearableInsightPanel',
          'refused to open a non-tgp deep link',
          { bucket },
        );
        return;
      }
      setCtaOpening(true);
      if (onCtaPress) {
        onCtaPress(deepLink);
        return;
      }
      // openURL rejects if the OS cannot resolve the scheme — surface a
      // breadcrumb. The in-flight latch is released in `.finally` (NOT only on
      // failure) so a successful open does not permanently disable the CTA: the
      // `ctaOpening` guard above still blocks the synchronous double-tap window.
      Linking.openURL(deepLink)
        .catch((err: unknown) => {
          logger.warn(
            'ClientWearableInsightPanel',
            'deep link failed to open',
            { bucket, err },
          );
        })
        .finally(() => {
          setCtaOpening(false);
        });
    },
    [ctaOpening, onCtaPress, bucket],
  );

  // ── Loading: skeleton-of-the-real-layout, never a bare spinner (R0). ──
  if (query.isLoading) {
    return (
      <View
        style={[styles.card, { borderColor: withAlpha(tone.accent, 0.3) }]}
        accessibilityRole="progressbar"
        accessibilityLabel={`Loading AI insight, ${BUCKET_LABEL[bucket]}`}
        testID="client-insight-loading"
      >
        <View style={styles.headerRow}>
          <SkeletonBar width="48%" height={14} reduceMotion={reduceMotion} styles={styles} />
          <SkeletonBar width={92} height={20} reduceMotion={reduceMotion} styles={styles} />
        </View>
        <SkeletonBar width="92%" height={12} reduceMotion={reduceMotion} styles={styles} style={styles.skeletonGap} />
        <SkeletonBar width="80%" height={12} reduceMotion={reduceMotion} styles={styles} style={styles.skeletonGap} />
        <SkeletonBar width="86%" height={12} reduceMotion={reduceMotion} styles={styles} style={styles.skeletonGap} />
        <SkeletonBar width="100%" height={44} reduceMotion={reduceMotion} styles={styles} style={styles.skeletonCta} />
      </View>
    );
  }

  // ── Error: sanitized one-liner + Retry (R0: copy + CTA, never a dead end). ──
  if (query.isError) {
    return (
      <View
        style={[styles.card, { borderColor: withAlpha(tone.accent, 0.3) }]}
        accessibilityRole={CARD_REGION_ROLE}
        accessibilityLabel={`AI insight, ${BUCKET_LABEL[bucket]}`}
        testID="client-insight-error"
      >
        <View style={styles.row}>
          <Ionicons name="cloud-offline-outline" size={18} color={semanticColors.textMuted} />
          <Text style={styles.primary} accessibilityRole="alert">
            {sanitizeWearableError(query.error)}
          </Text>
        </View>
        <Pressable
          style={[styles.retryBtn, { borderColor: tone.onSurfaceInk }]}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          testID="client-insight-retry"
        >
          <Text style={[styles.retryText, { color: tone.onSurfaceInk }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const insight = query.data;

  // ── Empty / settled-with-no-data: calm guidance, NO chip, NO CTA (§2.2). ──
  // P3-a: a whitespace-only observation/norm/intervention would pass the
  // backend `z.string().min(1)` but render a near-blank Section, so we treat a
  // fully blank-after-trim insight as empty here too (defence-in-depth).
  if (
    insight == null ||
    isEmptyInsight(insight) ||
    !hasAnyRenderableField(insight)
  ) {
    return <EmptyPanel bucket={bucket} tone={tone} styles={styles} />;
  }

  return (
    <LoadedPanel
      bucket={bucket}
      tone={tone}
      insight={insight}
      ctaOpening={ctaOpening}
      onCta={onCta}
      styles={styles}
      semanticColors={semanticColors}
    />
  );
}

/** True when at least one of the three content fields is non-blank after trim. */
function hasAnyRenderableField(insight: ClientInsight): boolean {
  return (
    insight.observation.trim().length > 0 ||
    insight.norm_comparison.trim().length > 0 ||
    insight.intervention.trim().length > 0
  );
}

/**
 * The calm "not enough data" surface (UX §3.4 / §2.2). The literal observation
 * copy comes from the backend EmptyInsight contract; a secondary line frames it
 * as a forward-looking promise. NO confidence chip, NO CTA.
 */
function EmptyPanel({
  bucket,
  tone,
  styles,
}: {
  bucket: WearableMetricBucket;
  tone: ToneTokens;
  styles: PanelStyles;
}) {
  return (
    <View
      style={[styles.card, { borderColor: withAlpha(tone.accent, 0.3) }]}
      accessibilityRole={CARD_REGION_ROLE}
      accessibilityLabel={`AI insight, ${BUCKET_LABEL[bucket]}`}
      testID="client-insight-empty"
    >
      <View style={styles.row}>
        <Ionicons name="sparkles-outline" size={16} color={tone.accent} />
        <Text style={styles.primary} accessibilityRole="text">
          Not enough data yet — keep syncing.
        </Text>
      </View>
      <Text style={styles.secondary} accessibilityRole="text">
        We&apos;ll add insights here as your devices report more.
      </Text>
    </View>
  );
}

/** Collapsed line cap for the non-emphasized body sections (§4.5). */
const CLAMP_LINES = 3;

/**
 * The fully-populated insight card: header chip + labelled sections +
 * provenance + CTA.
 *
 * Progressive disclosure (§4.5, consonant with the HK-5a coach `Read more`):
 * `observation` and `norm_comparison` clamp to {@link CLAMP_LINES} lines while
 * collapsed; the emphasized `intervention` is the action and is ALWAYS rendered
 * in full. A single `Read more` / `Show less` toggle expands BOTH clamped
 * sections together and only appears once `onTextLayout` reports that one of
 * them actually overflowed the cap — so short content never shows an orphaned
 * toggle.
 */
function LoadedPanel({
  bucket,
  tone,
  insight,
  ctaOpening,
  onCta,
  styles,
  semanticColors,
}: {
  bucket: WearableMetricBucket;
  tone: ToneTokens;
  insight: ClientInsight;
  ctaOpening: boolean;
  onCta: (deepLink: string) => void;
  styles: PanelStyles;
  semanticColors: SemanticTokens;
}) {
  const level = insight.confidence_level;
  const cta = insight.optional_cta;

  const [expanded, setExpanded] = useState(false);
  // Tracks whether each clamped section overflowed CLAMP_LINES at its natural
  // height, re-measured via onTextLayout on every layout pass. Either
  // overflowing surfaces the toggle.
  const [observationOverflows, setObservationOverflows] = useState(false);
  const [normOverflows, setNormOverflows] = useState(false);
  const showToggle = observationOverflows || normOverflows;

  // Stale-state guard (#28): after a React Query refetch swaps long content for
  // short content the panel must not keep a stuck "Show less" / orphaned
  // "Read more". Collapse back to the clamped view when the measured text
  // changes and clear the overflow flags so the next onTextLayout pass
  // re-measures from scratch (belt-and-suspenders alongside the always-assign
  // handler below). Keyed on the two clamped fields only — the intervention is
  // never clamped.
  useEffect(() => {
    setExpanded(false);
    setObservationOverflows(false);
    setNormOverflows(false);
  }, [insight.observation, insight.norm_comparison]);

  const onClampLayout = useCallback(
    (
      setter: (v: boolean) => void,
    ): ((e: NativeSyntheticEvent<TextLayoutEventData>) => void) =>
      (e) => {
        // `lines` reflects the un-clamped layout RN computed for this text.
        // ALWAYS assign the current measurement (not a one-way latch to true)
        // so that when refetched content now fits, the flag falls back to false
        // and the toggle disappears instead of remaining stuck on (#28).
        setter(e.nativeEvent.lines.length > CLAMP_LINES);
      },
    [],
  );

  const showObservation = insight.observation.trim().length > 0;
  const showNorm = insight.norm_comparison.trim().length > 0;
  const showIntervention = insight.intervention.trim().length > 0;

  return (
    <View
      style={[styles.card, { borderColor: withAlpha(tone.accent, 0.3) }]}
      accessibilityRole={CARD_REGION_ROLE}
      accessibilityLabel={`AI insight, ${BUCKET_LABEL[bucket]}`}
      testID="client-insight-panel"
    >
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons name={BUCKET_ICON[bucket]} size={16} color={tone.accent} />
          <Text style={styles.eyebrow} accessibilityRole="text">
            AI insight
          </Text>
        </View>
        <ConfidenceChip level={level} accent={tone.accent} styles={styles} />
      </View>

      {showObservation && (
        <Section
          label="Observation"
          value={insight.observation}
          styles={styles}
          numberOfLines={expanded ? undefined : CLAMP_LINES}
          onTextLayout={onClampLayout(setObservationOverflows)}
          testID="client-insight-observation"
        />
      )}
      {showNorm && (
        <Section
          label="Norm comparison"
          value={insight.norm_comparison}
          styles={styles}
          numberOfLines={expanded ? undefined : CLAMP_LINES}
          onTextLayout={onClampLayout(setNormOverflows)}
          testID="client-insight-norm"
        />
      )}

      {showToggle && (
        <Pressable
          style={({ pressed }) => [
            styles.readMoreBtn,
            pressed && styles.readMorePressed,
          ]}
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less' : 'Read more'}
          testID="client-insight-readmore"
        >
          <Text style={[styles.readMoreText, { color: tone.onSurfaceInk }]}>
            {expanded ? 'Show less' : 'Read more'}
          </Text>
        </Pressable>
      )}

      {showIntervention && (
        <Section
          label="Intervention"
          value={insight.intervention}
          styles={styles}
          emphasize
          testID="client-insight-intervention"
        />
      )}

      <ProvenanceRow sourceMetrics={insight.source_metrics} styles={styles} />

      {cta != null && (
        <Pressable
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: tone.accentInk },
            ctaOpening && styles.ctaDisabled,
            pressed && !ctaOpening && styles.ctaPressed,
          ]}
          onPress={() => onCta(cta.deep_link)}
          disabled={ctaOpening}
          accessibilityRole="button"
          accessibilityState={{ disabled: ctaOpening }}
          accessibilityLabel={cta.label}
          testID="client-insight-cta"
        >
          <Text style={styles.ctaText}>{cta.label}</Text>
          <Ionicons
            name="arrow-forward-outline"
            size={16}
            color={semanticColors.textOnAccent}
          />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Provenance row (audit-brief required, contract `source_metrics: min(1)`).
 * Supporting (not primary) content: lighter muted typography. Joins the first
 * three metrics with `, ` and appends ` +N more` when there are extras. Omits
 * itself entirely when there are no metrics so we never render an empty row.
 */
function ProvenanceRow({
  sourceMetrics,
  styles,
}: {
  sourceMetrics: readonly string[];
  styles: PanelStyles;
}) {
  const metrics = sourceMetrics.filter((m) => m.trim().length > 0);
  if (metrics.length === 0) return null;

  const shown = metrics.slice(0, 3).join(', ');
  const rest = metrics.length - 3;
  const value = rest > 0 ? `${shown} +${rest} more` : shown;

  return (
    <View style={styles.section} testID="client-insight-source-metrics">
      <Text style={styles.sectionLabel} accessibilityRole="text">
        Source metrics
      </Text>
      <Text
        style={styles.provenanceValue}
        accessibilityLabel={`Source metrics: ${value}`}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * A labelled label→value pair. The intervention is the actionable line, so it
 * renders at a heavier weight + larger size than the neutral observation/norm
 * sections (typography emphasis per the brief).
 */
function Section({
  label,
  value,
  styles,
  emphasize = false,
  numberOfLines,
  onTextLayout,
  testID,
}: {
  label: string;
  value: string;
  styles: PanelStyles;
  emphasize?: boolean;
  numberOfLines?: number;
  onTextLayout?: (e: NativeSyntheticEvent<TextLayoutEventData>) => void;
  testID?: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel} accessibilityRole="text">
        {label}
      </Text>
      <Text
        style={emphasize ? styles.sectionValueStrong : styles.sectionValue}
        accessibilityRole="text"
        numberOfLines={numberOfLines}
        ellipsizeMode="tail"
        onTextLayout={onTextLayout}
        testID={testID}
      >
        {value}
      </Text>
    </View>
  );
}

/** Neutral confidence pill — label + percentage. Never green-for-good (§6.3). */
function ConfidenceChip({
  level,
  accent,
  styles,
}: {
  level: ConfidenceLevel;
  accent: string;
  styles: PanelStyles;
}) {
  return (
    <View
      style={[
        styles.chip,
        { borderColor: withAlpha(accent, 0.4), backgroundColor: withAlpha(accent, 0.1) },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Confidence: ${CONFIDENCE_LABEL[level]}, ${CONFIDENCE_PCT[level]} percent`}
      testID="client-insight-confidence"
    >
      <Text style={styles.chipText}>
        {CONFIDENCE_LABEL[level]} · {CONFIDENCE_PCT[level]}%
      </Text>
    </View>
  );
}

/**
 * A single skeleton bar. Honours reduce-motion: when motion is suppressed the
 * bar is a static dim block (no looping shimmer), otherwise it pulses between
 * two opacities. Local to this panel so the loading skeleton can mirror the
 * real layout precisely (§4.5).
 */
function SkeletonBar({
  width,
  height,
  reduceMotion,
  styles,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  reduceMotion: boolean;
  styles: PanelStyles;
  style?: object;
}) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.skeletonBar,
        { width, height, borderRadius: Math.min(height / 2, radius.lg), opacity },
        style,
      ]}
    />
  );
}

/**
 * Theme-aware stylesheet factory (P2-5 dark-mode parity). The panel consumes
 * `useTheme().semanticColors` so its surface/text/skeleton tokens follow the
 * resolved colour scheme; the bucket `tone.accentInk` CTA fill stays as-is
 * (AA-verified in both schemes with `theme.textOnAccent`), while on-surface
 * text/border affordances use the scheme-reactive `tone.onSurfaceInk` applied
 * inline at the call sites so they clear AA against the dark card surface.
 */
function makeStyles(t: SemanticTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.bgSurface,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.lg,
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
    eyebrow: {
      ...typography.eyebrow,
      color: t.textMuted,
    },
    primary: {
      ...typography.body,
      color: t.textPrimary,
      flex: 1,
    },
    secondary: {
      ...typography.bodySmall,
      color: t.textMuted,
      marginTop: spacing.xs,
    },
    section: {
      marginTop: spacing.md,
    },
    sectionLabel: {
      ...typography.eyebrow,
      color: t.textMuted,
    },
    sectionValue: {
      ...typography.body,
      color: t.textPrimary,
      marginTop: spacing.xs,
    },
    // Intervention is the actionable line — heavier weight + larger size.
    sectionValueStrong: {
      ...typography.bodyMd,
      color: t.textPrimary,
      marginTop: spacing.xs,
    },
    // Provenance is supporting (not primary) content — lighter muted text.
    provenanceValue: {
      ...typography.bodySmall,
      color: t.textMuted,
      marginTop: spacing.xs,
    },
    readMoreBtn: {
      alignSelf: 'flex-start',
      marginTop: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      minHeight: 44,
      justifyContent: 'center',
    },
    readMorePressed: {
      opacity: 0.6,
    },
    readMoreText: {
      ...typography.bodyMd,
    },
    chip: {
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs / 2 + 1,
    },
    chipText: {
      ...typography.micro,
      color: t.textMuted,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderRadius: radius.sm,
      paddingVertical: spacing.md,
      marginTop: spacing.lg,
      minHeight: 44,
    },
    ctaDisabled: {
      opacity: 0.6,
    },
    ctaPressed: {
      opacity: 0.8,
    },
    ctaText: {
      ...typography.bodyMd,
      color: t.textOnAccent,
    },
    retryBtn: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      marginTop: spacing.md,
      minHeight: 44,
      justifyContent: 'center',
    },
    retryText: {
      ...typography.bodyMd,
    },
    skeletonBar: {
      backgroundColor: withAlpha(t.border, 0.6),
    },
    skeletonGap: {
      marginTop: spacing.md,
    },
    skeletonCta: {
      marginTop: spacing.lg,
    },
  });
}

type PanelStyles = ReturnType<typeof makeStyles>;

export default ClientWearableInsightPanel;
