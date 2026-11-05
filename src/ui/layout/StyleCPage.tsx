/**
 * Style C page (C2 section 5; frames C_kitchen, C_recipe, C_grocery, C_loading, C_error): a forest
 * masthead (surface.forestBand, the frames' #2C4A36) with a 1 pt gold rule under its words, and a
 * paper sheet whose 24 pt top corners overlap it. The screen keeps its Screen wrapper, which owns the
 * inset top (insets.top + 12); useStyleCScreen() turns that wrapper forest. Also the round check,
 * the warm notice and the static loading lines those frames draw. Gold is only ever the rule here, never text on light.
 * BEAUTY-929: the paper is the app's page colour (bgPrimary, bone #F7FAF7, owner #197-E6 "we keep the toothpaste color
 * for v1"), not the frames' cream; the row picture tile (C_kitchen) and the empty state with its line drawing live here too.
 */
import React, { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStatusBarBand } from '../../components/StatusBarBand';
import { useTheme } from '../../theme/ThemeProvider';
import { gold, layout, radius, typography, withAlpha } from '../../theme/tokens';
import { HapticService } from '../haptics/haptics.service';

export function StyleCMasthead({ title, onBack, backLabel = 'Back', trailing, loading }: {
  title?: string; onBack?: () => void; backLabel?: string;
  /** One control at the right of the back row (for example Save). */
  trailing?: React.ReactNode;
  /** Loading: two quiet bars stand in for the title (C_loading). */
  loading?: boolean;
}) {
  const sc = useTheme().semanticColors;
  useStatusBarBand(sc.surface.forestBand);
  const bar = { backgroundColor: withAlpha(sc.textOnAccent, 0.16) };
  return (
    <View style={s.head}>
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

/** Props for the screen's Screen wrapper: the forest page (its inset top included), no gutter, no bottom pad. */
export function useStyleCScreen(): { style: ViewStyle; contentStyle: ViewStyle } {
  return { style: { backgroundColor: useTheme().semanticColors.surface.forestBand }, contentStyle: s.bare };
}

/** The paper sheet under the masthead: fills a fixed page, or grows under a masthead that scrolls. */
export function StyleCPaper({ children, scrolls, style }: { children?: React.ReactNode; scrolls?: boolean; style?: StyleProp<ViewStyle> }) {
  const sc = useTheme().semanticColors;
  return <View style={[s.paper, scrolls && s.paperFlow, { backgroundColor: sc.bgPrimary }, style]}>{children}</View>;
}

/** The 64 pt picture tile at the left of a row (C_kitchen): the recipe photo, else a warm tile with a line drawing
 *  (a non-text accent, so gold is allowed; gold 700 keeps the line at 4:1 on the tile, past the 3:1 for graphics).
 *  Decorative: the row's own label names the recipe. */
export function StyleCThumb({ uri, icon = 'restaurant-outline', size = 64 }: { uri?: string; icon?: string; size?: number }) {
  const sc = useTheme().semanticColors;
  return (
    <View testID="stylec-thumb" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[s.thumb, { width: size, height: size, backgroundColor: withAlpha(sc.data.trackLight, 0.6) }]}>
      {uri ? <Image source={{ uri }} style={s.thumbImage} resizeMode="cover" accessibilityIgnoresInvertColors />
        : <Ionicons name={icon as React.ComponentProps<typeof Ionicons>['name']} size={Math.round(size * 0.44)} color={gold[700]} />}
    </View>
  );
}

/** Empty state on the paper: the line-drawing tile over a serif title and a muted line (every kitchen screen). */
export function StyleCEmpty({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  const sc = useTheme().semanticColors;
  return (
    <View style={s.empty}>
      <StyleCThumb icon={icon} size={72} />
      <Text style={[typography.h2, s.emptyText, { color: sc.textPrimary }]}>{title}</Text>
      <Text style={[typography.bodySmall, s.emptyText, { color: sc.textMuted }]}>{subtitle}</Text>
    </View>
  );
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

/** Warm notice (C_error): one alert region; the error haptic plays once when it appears. With a title, the title
 *  is the first line in the medium sans and the children the line under it, as the frame draws it. */
export function StyleCNotice({ children, title }: { children?: React.ReactNode; title?: string }) {
  const sc = useTheme().semanticColors;
  useEffect(() => { void HapticService.error(); }, []);
  return (
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={[s.notice, { backgroundColor: withAlpha(sc.data.trackLight, 0.5), borderLeftColor: gold[500] }]}>
      {title ? <Text style={[typography.h4, { color: sc.textPrimary }]}>{title}</Text> : null}
      {children ? <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{children}</Text> : null}
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
  bare: { flexGrow: 1, paddingHorizontal: 0, paddingBottom: 0 },
  head: { paddingHorizontal: layout.gutter, paddingBottom: radius.sheet + 16 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: -10, marginBottom: 4 },
  icon: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  rule: { height: 1, marginTop: 16 },
  loading: { gap: 12, paddingTop: 8 },
  barTitle: { height: 28, width: '62%', borderRadius: radius.button },
  barLine: { height: 14, width: '78%', borderRadius: radius.button },
  paper: { flex: 1, marginTop: -radius.sheet, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' },
  paperFlow: { flex: 0, flexGrow: 1 },
  check: { width: 28, height: 28, borderRadius: radius.chip, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  thumb: { borderRadius: radius.button, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: '100%', height: '100%' },
  empty: { alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 40 },
  emptyText: { textAlign: 'center' },
  notice: { gap: 4, borderLeftWidth: 3, borderRadius: radius.button, paddingHorizontal: 16, paddingVertical: 14 },
  lines: { gap: 24, paddingVertical: 8 },
  lineRow: { gap: 10 },
  lineShort: { height: 12, width: '40%', borderRadius: radius.control },
  lineLong: { height: 22, width: '86%', borderRadius: radius.button },
});
