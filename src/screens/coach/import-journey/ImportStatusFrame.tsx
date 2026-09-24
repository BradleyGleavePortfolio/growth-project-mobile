import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, I18nManager, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/useTheme';
import { spacing, typography } from '../../../theme/tokens';
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
  const previousAnnouncement = useRef(announcement);
  useEffect(() => {
    const changed = previousAnnouncement.current !== announcement;
    previousAnnouncement.current = announcement;
    // Live regions handle Android; RN's queued announcement API handles iOS.
    if (Platform.OS === 'ios' && changed) {
      AccessibilityInfo.announceForAccessibilityWithOptions(announcement, { queue: true });
    }
  }, [announcement]);
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

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 560, gap: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: { maxWidth: '45%', flexShrink: 1 },
  headerTitle: { flex: 1 },
});
