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
      <Text ref={headingRef} accessibilityRole="header" accessibilityLiveRegion="polite" style={[typography.h1, ui.text, { color: c.textPrimary }]}>{title}</Text>
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
  return <View style={[styles.inlineContent, { backgroundColor: c.bgSurface, borderColor: c.border }]} accessibilityLiveRegion="polite">
    {romanEnabled && <ImportJourneyPortrait />}
    <Text ref={headingRef} accessibilityRole="header" accessibilityLiveRegion="polite" style={[typography.h2, ui.text, { color: c.textPrimary }]}>{title}</Text>
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
});
