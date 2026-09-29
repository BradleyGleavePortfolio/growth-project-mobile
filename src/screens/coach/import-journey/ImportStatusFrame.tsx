import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, I18nManager, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/useTheme';
import { radius, spacing, typography } from '../../../theme/tokens';
import { importJourneyCopy as t } from './importJourneyCopy';
import { ImportJourneyAction, ImportJourneyPortrait, ui, useImportHeadingFocus } from './importJourneyUI';

/** Capability + callback are supplied by a future accepted host; neither is verified here. */
export type ImportViewAction = {
  enabled: boolean; onPress: () => void;
  /**
   * R300-A3-B1: an in-flight read disables the action and swaps its label
   * to `busyLabel` ("Checking…"), restoring exactly the affordance the
   * pre-refactor journey and `ImportRunVerdictCard` both had
   * (`disabled={run.isRefreshing}`, label toggling to `'Checking…'`).
   * Optional and unset by every standalone P2 action — only the inline
   * journey's refresh action sets it, so no other button's behavior
   * changes.
   */
  busy?: boolean;
  busyLabel?: string;
};
export function ImportStatusAction({ action, label, primary = false, disabled = false }: {
  action?: ImportViewAction; label: string; primary?: boolean; disabled?: boolean;
}) {
  if (!action || action.enabled !== true || typeof action.onPress !== 'function') return null;
  const busy = action.busy === true;
  return <ImportJourneyAction label={busy && action.busyLabel ? action.busyLabel : label} primary={primary} disabled={disabled || busy} busy={busy} onPress={action.onPress} />;
}

export function ImportStatusText({ children, secondary = false, announce = false }: {
  children: React.ReactNode; secondary?: boolean; announce?: boolean;
}) {
  const { semanticColors: c } = useTheme();
  return <Text accessibilityLiveRegion={announce ? 'polite' : 'none'} style={[secondary ? typography.bodySmall : typography.body, ui.text, { color: secondary ? c.textMuted : c.textPrimary }]}>{children}</Text>;
}

/**
 * A visually-hidden Android live-region target (R300-A2-B2): the ONE node
 * that carries `accessibilityLiveRegion="polite"` for a material change,
 * OUTSIDE the changing timestamp/roster subtree, so TalkBack speaks exactly
 * the human-readable `announcement` sentence once per real change — never
 * the raw "stale" token, never a duplicate of the visible stale/reason Text
 * nodes below it, and never re-triggered merely because a timestamp or the
 * roster list underneath re-renders (this node's own text only changes when
 * `announcement` changes). `importantForAccessibility="no-hide-descendants"`
 * keeps it out of normal swipe/explore-by-touch navigation — it exists only
 * to be spoken on change, matching how the P1 toast/banner live regions in
 * this app work.
 */
function ImportLiveAnnouncement({ text }: { text: string }) {
  return <Text accessibilityLiveRegion="polite" importantForAccessibility="no-hide-descendants" style={styles.hiddenAnnouncement}>{text}</Text>;
}

/**
 * B2 (R300-A) — R300-A3-B1/B2 rewrite: the ONE place that decides whether a
 * NEW `announcement` key differs from the previous one, for BOTH the
 * standalone full-screen frame and the inline card. `mode` picks the
 * announcement API, not a live region in either case:
 *   - `'queued'` (standalone frame, unchanged contract, never flagged by any
 *     review — its own targeted accessibility suite asserts this exact
 *     behavior and passes unmodified): iOS's queued
 *     `announceForAccessibilityWithOptions`; Android continues to rely on
 *     this frame's own existing live-region Text nodes, exactly as before.
 *   - `'inline'` (R300-A3-B2, the paired-host card): NO live region
 *     anywhere on this surface. `ExtensionPairingPanel`'s own "paired" card
 *     ancestor keeps `accessibilityLiveRegion="polite"` for ITS OWN
 *     content, and RN's Android live-region propagation re-announces the
 *     WHOLE changing subtree under any ancestor that has one — a child
 *     cannot opt out of an ancestor's region (`importantForAccessibility=
 *     "no-hide-descendants"` changes swipe/explore-by-touch grouping, not
 *     live-region delivery, per RN's `BaseViewManager` mapping). The only
 *     reliable single-source-of-truth is `AccessibilityInfo.
 *     announceForAccessibility` fired exactly once per real change, on
 *     BOTH iOS and Android. `announcement` must already exclude every
 *     observation timestamp (status + freshness + reason only) — the
 *     caller is responsible for that; this hook only decides whether the
 *     key changed.
 */
function useImportStatusAnnouncement(announcement: string, mode: 'queued' | 'inline' = 'queued') {
  const previous = useRef(announcement);
  useEffect(() => {
    const changed = previous.current !== announcement;
    previous.current = announcement;
    if (!changed) return;
    if (mode === 'inline') {
      // R300-A3-B2: no live region on this surface at all — announce on
      // BOTH platforms imperatively, never via `accessibilityLiveRegion`.
      AccessibilityInfo.announceForAccessibility(announcement);
    } else if (Platform.OS === 'ios') {
      // R300-A2-B2: `announcement` is ALWAYS the human-readable sentence
      // (never a raw internal token like "stale") — every caller composes it
      // from real copy strings, so VoiceOver speaks the same explanation a
      // sighted coach reads, not an implementation detail.
      AccessibilityInfo.announceForAccessibilityWithOptions(announcement, { queue: true });
    }
  }, [announcement, mode]);
}

/** Separate P2 shell; P1 primitives and navigation remain untouched. */
export function ImportStatusFrame({ title, announcement = title, navigationTitle, romanEnabled, onReturnToCoaching, focusOnMount = false, children }: {
  title: string; navigationTitle: string; romanEnabled: boolean; onReturnToCoaching: () => void;
  /** Localized meaningful status only; never quantities or observation times. */
  announcement?: string;
  focusOnMount?: boolean; children: React.ReactNode;
}) {
  const { semanticColors: c } = useTheme();
  const insets = useSafeAreaInsets();
  // Background changes never steal focus. Initial entry belongs to the focus
  // primitive, so do not duplicate it with an imperative announcement.
  const headingRef = useImportHeadingFocus('status-presentation', focusOnMount);
  useImportStatusAnnouncement(announcement);
  return <ScrollView style={{ flex: 1, backgroundColor: c.bgPrimary }} contentContainerStyle={styles.scroll} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never">
    <View style={[styles.content, {
      paddingTop: Math.max(insets.top, spacing.lg), paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.lg,
      paddingStart: Math.max(I18nManager.isRTL ? insets.right : insets.left, spacing.xl),
      paddingEnd: Math.max(I18nManager.isRTL ? insets.left : insets.right, spacing.xl),
    }]}>
      <View style={styles.header}>
        <View style={styles.back}><ImportJourneyAction label={t('common.back')} onPress={onReturnToCoaching} /></View>
        <Text style={[typography.bodyMd, styles.headerTitle, ui.text, { color: c.textPrimary }]}>{navigationTitle}</Text>
      </View>
      {romanEnabled && <ImportJourneyPortrait />}
      {/* Standalone screen: the heading's own live region is unchanged from
          before R300-A2 (never flagged there) — it only fires on a TITLE
          change, which is exactly what a full navigation-style screen wants.
          `ImportLiveAnnouncement` below additionally covers a same-title
          material change (freshness/reason), which the header alone cannot. */}
      <Text ref={headingRef} accessibilityRole="header" accessibilityLiveRegion="polite" style={[typography.h1, ui.text, { color: c.textPrimary }]}>{title}</Text>
      <ImportLiveAnnouncement text={announcement} />
      {children}
    </View>
  </ScrollView>;
}

/**
 * B3 (R300-A): an inline, NON-scrolling Roman status presentation for a host
 * that already scrolls (`ExtensionPairingPanel` inside `ImportDataScreen`'s
 * ScrollView) — same convention `ImportOfferCard` already uses for that same
 * host ("Controlled inline card. Its host supplies scrolling and owns all
 * decisions."). No ScrollView, no screen-level Back/Return controls: the
 * host screen already has its own way back. `ImportStatusFrame` (above) is
 * kept unchanged for standalone/full-screen use.
 */
export function ImportInlineStatusFrame({ title, announcement = title, romanEnabled, focusOnMount = false, children }: {
  title: string; romanEnabled: boolean;
  /**
   * The speech key: status + freshness + reason only, NEVER a timestamp
   * (R300-A3 B2). Announced imperatively via `AccessibilityInfo.
   * announceForAccessibility` on BOTH platforms — no live region anywhere
   * on this inline path (R300-A3-B2): not on this card, not on its heading.
   * `ExtensionPairingPanel`'s own "paired" card ancestor still carries its
   * own `accessibilityLiveRegion="polite"` for ITS OWN content; nothing
   * here relies on, fights, or needs a region to co-exist with it.
   */
  announcement?: string;
  focusOnMount?: boolean; children: React.ReactNode;
}) {
  const { semanticColors: c } = useTheme();
  const headingRef = useImportHeadingFocus('status-presentation', focusOnMount);
  useImportStatusAnnouncement(announcement, 'inline');
  return <View style={[styles.inlineContent, { backgroundColor: c.bgSurface, borderColor: c.border }]}>
    {romanEnabled && <ImportJourneyPortrait />}
    <Text ref={headingRef} accessibilityRole="header" style={[typography.h2, ui.text, { color: c.textPrimary }]}>{title}</Text>
    {children}
  </View>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 560, gap: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: { maxWidth: '45%', flexShrink: 1 },
  headerTitle: { flex: 1 },
  inlineContent: { width: '100%', maxWidth: 560, gap: spacing.lg, padding: spacing.lg, borderWidth: 1, borderRadius: radius.lg, alignSelf: 'center' },
  // Zero-size but still mounted (screen readers require a rendered node to
  // target); invisible to sighted coaches, present for the live region only.
  hiddenAnnouncement: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
