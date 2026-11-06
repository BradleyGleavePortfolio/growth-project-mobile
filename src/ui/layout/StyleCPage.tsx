/**
 * Style C page (C2 section 5; frames C_kitchen, C_recipe, C_grocery, C_loading, C_error): a forest
 * masthead (surface.forestBand, the frames' #2C4A36) with a 1 pt gold rule under its words, and a
 * paper sheet whose 24 pt top corners overlap it. The screen keeps its Screen wrapper, which owns the
 * inset top (insets.top + 12); useStyleCScreen() turns that wrapper forest. Also the round check,
 * the warm notice and the static loading lines those frames draw. Gold is only ever the rule here, never text on light.
 * BEAUTY-929: the paper is the app's page colour (bgPrimary, bone #F7FAF7, owner #197-E6 "we keep the toothpaste color
 * for v1"), not the frames' cream; the row picture tile (C_kitchen) and the empty state with its line drawing live here too.
 * REFINE-929 (ctx#457 GOAL): the masthead carries the screen's summary under a 40 pt title, plus the list dashes and the
 * confirmation sheet those frames draw.
 */
import React, { useContext, useEffect } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { PrimaryButton, TextLink } from '../buttons/PrimaryButton';
import { Ionicons } from '@expo/vector-icons';
import { useStatusBarBand } from '../../components/StatusBarBand';
import { useTheme } from '../../theme/ThemeProvider';
import { gold, layout, radius, typography, withAlpha } from '../../theme/tokens';
import { HapticService } from '../haptics/haptics.service';

export function StyleCMasthead({ title, onBack, backLabel = 'Back', trailing, loading, children, compact }: {
  title?: string; onBack?: () => void; backLabel?: string; children?: React.ReactNode;
  /** A variable-length title (a recipe name) keeps the 32 pt h1; the screen titles are 40 pt (ctx#457). */
  compact?: boolean;
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
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.2} style={[typography.h1, !compact && s.title, { color: sc.textOnAccent }]}>{title}</Text>
      ) : null}
      {children}
      <View style={[s.rule, { backgroundColor: gold[300] }]} />
    </View>
  );
}

/** Props for the screen's Screen wrapper: the forest page (its inset top included), no gutter, no bottom pad. */
export function useStyleCScreen(): { style: ViewStyle; contentStyle: ViewStyle } {
  return { style: { backgroundColor: useTheme().semanticColors.surface.forestBand }, contentStyle: s.bare };
}

/** The bottom inset for a pinned footer or a sheet (0 where no provider is mounted). */
export const useBottomInset = (): number => useContext(SafeAreaInsetsContext)?.bottom ?? 0;

/** Words on the forest masthead (ctx#457): the summary line in light sans, a muted line, or a small-caps eyebrow. */
export function StyleCMastText({ children, kind = 'sub', style }: { children: React.ReactNode; kind?: 'sub' | 'muted' | 'eyebrow'; style?: StyleProp<TextStyle> }) {
  const sc = useTheme().semanticColors;
  const look = kind === 'sub' ? [typography.body, s.mastSub, { color: withAlpha(sc.textOnAccent, 0.86) }]
    : kind === 'muted' ? [typography.bodySmall, s.mastMuted, { color: sc.textOnMastheadMuted }]
    : [typography.eyebrow, s.mastEye, { color: sc.textOnMastheadMuted }];
  return <Text maxFontSizeMultiplier={1.3} style={[look, style]}>{children}</Text>;
}

/** List progress on the masthead (ctx#457 shopping): one dash per item, gold for each checked one, then the summary.
 *  Past 12 items the 12 dashes fill in proportion. The words carry the meaning; the dashes are decorative. */
export function StyleCDashes({ total, done, label }: { total: number; done: number; label: string }) {
  const sc = useTheme().semanticColors;
  const n = Math.min(total, 12);
  const on = total > 0 ? Math.round((done / total) * n) : 0;
  return (
    <View style={s.prog}>
      {n > 0 ? (
        <View style={s.dashes} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {Array.from({ length: n }, (_, i) => <View key={i} style={[s.dash, { backgroundColor: i < on ? gold[300] : withAlpha(sc.textOnAccent, 0.22) }]} />)}
        </View>
      ) : null}
      <StyleCMastText style={s.flat}>{label}</StyleCMastText>
    </View>
  );
}

/** Confirmation sheet (ctx#457 prep-added): the line-drawing tile, a serif title, a muted line, one primary action and
 *  a quiet link. The link, the scrim and the system back all close it. */
export function StyleCSheet({ visible, icon, title, body, action, onAction, link, onClose }: {
  visible: boolean; icon: string; title: string; body: string; action: string; onAction: () => void; link: string; onClose: () => void;
}) {
  const sc = useTheme().semanticColors;
  const bottom = useBottomInset();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[s.scrim, { backgroundColor: withAlpha(sc.surface.masthead, 0.45) }]} onPress={onClose} accessibilityLabel={link} accessibilityRole="button" />
      <View accessibilityViewIsModal style={[s.sheet, { backgroundColor: sc.bgPrimary, paddingBottom: bottom + 16 }]}>
        <View style={[s.grab, { backgroundColor: sc.border }]} />
        <StyleCThumb icon={icon} size={72} />
        <Text accessibilityRole="header" style={[typography.h2, s.emptyText, s.bigTitle, s.sheetTitle, { color: sc.textPrimary }]}>{title}</Text>
        <Text style={[typography.body, s.emptyText, s.sheetBody, { color: sc.textMuted }]}>{body}</Text>
        <PrimaryButton label={action} onPress={onAction} style={s.full} />
        <TextLink label={link} tone="accent" onPress={onClose} style={s.sheetLink} />
      </View>
    </Modal>
  );
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
      <StyleCThumb icon={icon} size={96} />
      <Text style={[typography.h2, s.emptyText, s.bigTitle, s.emptyTitle, { color: sc.textPrimary }]}>{title}</Text>
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

/** Static loading lines (C_loading): no shimmer, so nothing moves while the page loads. `lead` draws the row's own
 *  shape first (ctx#457): the 64 pt picture tile, or the round check with the amount bar at the right. */
export function StyleCLoadingLines({ rows = 4, label, lead }: { rows?: number; label?: string; lead?: 'tile' | 'ring' }) {
  const sc = useTheme().semanticColors;
  const fill = { backgroundColor: sc.data.trackLight };
  return (
    <View accessible={label != null} accessibilityLabel={label} style={s.lines}>
      {Array.from({ length: rows }, (_, i) => lead === 'ring' ? (
        <View key={i} style={s.ringRow}><View style={[s.check, { borderColor: sc.border }]} /><View style={[s.ringBar, fill]} /><View style={[s.ringAmt, fill]} /></View>
      ) : (
        <View key={i} style={lead ? [s.tileRow, { borderColor: sc.border }] : undefined}>
          {lead ? <View style={[s.tilePh, fill]} /> : null}
          <View style={[s.lineRow, s.grow]}><View style={[s.lineShort, fill]} /><View style={[s.lineLong, fill]} /></View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  bare: { flexGrow: 1, paddingHorizontal: 0, paddingBottom: 0 },
  head: { paddingHorizontal: layout.gutter, paddingBottom: radius.sheet + 16 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: -10, marginBottom: 4 },
  icon: { minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 40, lineHeight: 45, letterSpacing: 0.4 },
  rule: { height: 1, marginTop: 18 },
  mastSub: { marginTop: 4 },
  mastMuted: { marginTop: 6 },
  mastEye: { marginTop: 20 },
  flat: { marginTop: 0 },
  prog: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 10 },
  dashes: { flexDirection: 'row', gap: 5 },
  dash: { width: 22, height: 4, borderRadius: radius.chip },
  scrim: { flex: 1 },
  sheet: { alignItems: 'center', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: layout.gutter, paddingTop: 10 },
  grab: { width: 40, height: 5, borderRadius: radius.chip, marginBottom: 22 },
  bigTitle: { fontSize: 27, lineHeight: 32 },
  sheetTitle: { marginTop: 18 },
  sheetBody: { marginTop: 8, marginBottom: 22 },
  sheetLink: { alignSelf: 'center', marginTop: 4 },
  full: { alignSelf: 'stretch' },
  loading: { gap: 12, paddingTop: 8 },
  barTitle: { height: 28, width: '62%', borderRadius: radius.button },
  barLine: { height: 14, width: '78%', borderRadius: radius.button },
  paper: { flex: 1, marginTop: -radius.sheet, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' },
  paperFlow: { flex: 0, flexGrow: 1 },
  check: { width: 28, height: 28, borderRadius: radius.chip, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  thumb: { borderRadius: radius.button, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: '100%', height: '100%' },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 44 },
  emptyTitle: { marginTop: 12 },
  emptyText: { textAlign: 'center' },
  notice: { gap: 4, borderLeftWidth: 3, borderRadius: radius.button, paddingHorizontal: 16, paddingVertical: 14 },
  lines: { gap: 24, paddingVertical: 8 },
  lineRow: { gap: 10 },
  grow: { flex: 1 },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  tilePh: { width: 64, height: 64, borderRadius: radius.button },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ringBar: { flex: 1, maxWidth: '60%', height: 20, borderRadius: radius.button },
  ringAmt: { marginLeft: 'auto', width: 56, height: 14, borderRadius: radius.button },
  lineShort: { height: 12, width: '40%', borderRadius: radius.control },
  lineLong: { height: 22, width: '86%', borderRadius: radius.button },
});
