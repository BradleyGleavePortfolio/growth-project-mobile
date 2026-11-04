/**
 * Style C page (C2 section 5; frames C_kitchen, C_recipe, C_grocery, C_loading, C_error): a forest
 * masthead (surface.forestBand, the frames' #2C4A36) under the status bar with a 1 pt gold rule under its words, and a paper sheet whose 24 pt
 * top corners overlap it. Also the round check, the warm notice and the static loading lines those
 * frames draw. Gold is only ever the rule here, never text on light.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStatusBarBand } from '../../components/StatusBarBand';
import { useTheme } from '../../theme/ThemeProvider';
import { gold, layout, radius, typography, withAlpha } from '../../theme/tokens';
import { HapticService } from '../haptics/haptics.service';
import { useScreenInsets } from './Screen';

export function StyleCMasthead({ title, onBack, backLabel = 'Back', trailing, loading }: {
  title?: string; onBack?: () => void; backLabel?: string;
  /** One control at the right of the back row (for example Save). */
  trailing?: React.ReactNode;
  /** Loading: two quiet bars stand in for the title (C_loading). */
  loading?: boolean;
}) {
  const sc = useTheme().semanticColors;
  const insets = useScreenInsets();
  useStatusBarBand(sc.surface.forestBand);
  const bar = { backgroundColor: withAlpha(sc.textOnAccent, 0.16) };
  return (
    <View style={[s.head, { backgroundColor: sc.surface.forestBand, paddingTop: insets.top + layout.statusBarGap }]}>
      {onBack || trailing ? (
        <View style={s.bar}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel} style={s.icon}>
              <Ionicons name="chevron-back" size={26} color={sc.textOnAccent} />
            </Pressable>
          ) : <View />}
          {trailing}
        </View>
      ) : null}
      {loading ? <View style={s.loading}><View style={[s.barTitle, bar]} /><View style={[s.barLine, bar]} /></View> : null}
      {title && !loading ? (
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} style={[typography.h1, { color: sc.textOnAccent }]}>{title}</Text>
      ) : null}
      <View style={[s.rule, { backgroundColor: gold[300] }]} />
    </View>
  );
}

/** The page: root in the page colour (keeps the screen's testID), masthead, then the paper sheet. */
export function StyleCPage({ head, children, testID, paperStyle }: {
  head: React.ReactNode; children?: React.ReactNode; testID?: string; paperStyle?: StyleProp<ViewStyle>;
}) {
  const sc = useTheme().semanticColors;
  const insets = useScreenInsets();
  return (
    <View testID={testID} style={[s.root, { backgroundColor: sc.bgPrimary }]}>
      <View style={[s.root, { backgroundColor: sc.surface.forestBand, paddingLeft: insets.left, paddingRight: insets.right }]}>
        {head}
        <View style={[s.paper, { backgroundColor: sc.bgSurface }, paperStyle]}>{children}</View>
      </View>
    </View>
  );
}

/** The paper sheet on its own, under a masthead that scrolls with the page. */
export function StyleCPaper({ children }: { children?: React.ReactNode }) {
  const sc = useTheme().semanticColors;
  return <View style={[s.paper, s.paperFlow, { backgroundColor: sc.bgSurface }]}>{children}</View>;
}

/** Round check (C_grocery): a ring, filled forest with a light tick when checked. Visual only. */
export function StyleCCheck({ checked }: { checked: boolean }) {
  const sc = useTheme().semanticColors;
  return (
    <View style={[s.check, checked ? { backgroundColor: sc.accent, borderColor: sc.accent } : { borderColor: sc.textMuted }]}>
      {checked ? <Ionicons name="checkmark" size={16} color={sc.textOnAccent} /> : null}
    </View>
  );
}

/** Warm notice (C_error): one alert region; the error haptic plays once when it appears. */
export function StyleCNotice({ children }: { children: React.ReactNode }) {
  const sc = useTheme().semanticColors;
  useEffect(() => { void HapticService.error(); }, []);
  return (
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={[s.notice, { backgroundColor: withAlpha(sc.data.trackLight, 0.5), borderLeftColor: gold[500] }]}>
      <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{children}</Text>
    </View>
  );
}

/** Static loading lines (C_loading): no shimmer, so nothing moves while the page loads. */
export function StyleCLoadingLines({ rows = 4, label }: { rows?: number; label?: string }) {
  const fill = { backgroundColor: useTheme().semanticColors.data.trackLight };
  return (
    <View accessible={label != null} accessibilityLabel={label} style={s.lines}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={s.lineRow}><View style={[s.lineShort, fill]} /><View style={[s.lineLong, fill]} /></View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: layout.gutter, paddingBottom: radius.sheet + 16 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: -10, marginBottom: 4 },
  icon: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  rule: { height: 1, marginTop: 16 },
  loading: { gap: 12, paddingTop: 8 },
  barTitle: { height: 28, width: '62%', borderRadius: radius.button },
  barLine: { height: 14, width: '78%', borderRadius: radius.button },
  paper: { flex: 1, marginTop: -radius.sheet, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' },
  paperFlow: { flex: 0, flexGrow: 1 },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  notice: { borderLeftWidth: 3, borderRadius: radius.button, paddingHorizontal: 16, paddingVertical: 14 },
  lines: { gap: 24, paddingVertical: 8 },
  lineRow: { gap: 10 },
  lineShort: { height: 12, width: '40%', borderRadius: 6 },
  lineLong: { height: 22, width: '86%', borderRadius: 11 },
});
