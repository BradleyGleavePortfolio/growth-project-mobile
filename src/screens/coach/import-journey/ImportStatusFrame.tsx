import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, I18nManager, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/useTheme';
import { radius, spacing, typography } from '../../../theme/tokens';
import { importJourneyCopy as t } from './importJourneyCopy';
import { ImportJourneyAction, ImportJourneyPortrait, ui, useImportHeadingFocus } from './importJourneyUI';

/** Capability + callback are supplied by a future accepted host; neither is verified here. */
export type ImportViewAction = { enabled: boolean; onPress: () => void };
export function ImportStatusAction({ action, label, primary = false, disabled = false }: {
  action?: ImportViewAction; label: string; primary?: boolean; disabled?: boolean;
}) {
  if (!action || action.enabled !== true || typeof action.onPress !== 'function') return null;
  return <ImportJourneyAction label={label} primary={primary} disabled={disabled} onPress={action.onPress} />;
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
 * B2 (R300-A): iOS has one queued announcement API; Android relies on live
 * regions on the changed text itself. This hook is the ONE place that decides
 * whether a NEW `announcement` string differs from the previous one — shared
 * by the full-screen frame and the inline variant so both platforms announce
 * a material change (freshness/reason) exactly once, never on every render
 * and never merely because a timestamp/count changed underneath an otherwise
 * identical sentence (callers must exclude those from `announcement`).
 */
function useImportStatusAnnouncement(announcement: string) {
  const previous = useRef(announcement);
  useEffect(() => {
    const changed = previous.current !== announcement;
    previous.current = announcement;
    if (Platform.OS === 'ios' && changed) {
      // R300-A2-B2: `announcement` is ALWAYS the human-readable sentence
      // (never a raw internal token like "stale") — every caller composes it
      // from real copy strings, so VoiceOver speaks the same explanation a
      // sighted coach reads, not an implementation detail.
      AccessibilityInfo.announceForAccessibilityWithOptions(announcement, { queue: true });
    }
  }, [announcement]);
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
  /** Localized meaningful status only; never quantities or observation times. */
  announcement?: string;
  focusOnMount?: boolean; children: React.ReactNode;
}) {
  const { semanticColors: c } = useTheme();
  const headingRef = useImportHeadingFocus('status-presentation', focusOnMount);
  useImportStatusAnnouncement(announcement);
  // R300-A2-B2: no live region on the outer card (the host `ExtensionPairingPanel`
  // already has its own polite region at the paired-card level, so a second one
  // here would nest and double-speak) and none on the heading either —
  // `ImportLiveAnnouncement` below is the SINGLE change-sensitive target, and it
  // sits outside whatever changing timestamp/roster content `children` renders.
  return <View style={[styles.inlineContent, { backgroundColor: c.bgSurface, borderColor: c.border }]}>
    {romanEnabled && <ImportJourneyPortrait />}
    <Text ref={headingRef} accessibilityRole="header" style={[typography.h2, ui.text, { color: c.textPrimary }]}>{title}</Text>
    <ImportLiveAnnouncement text={announcement} />
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
