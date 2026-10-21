/** LEARN-M5 (flag learnCourses): the course pages' deep masthead, the coach's note card and the row marks. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { CormorantGaramond_400Regular_Italic, useFonts } from '@expo-google-fonts/cormorant-garamond';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography, type SemanticTokens } from '../../../theme/tokens';
import { Overline, useScreenInsets } from '../../../ui';
import { ForestStatusBar } from '../../../components/StatusBarBand';
import { LearnBack, LessonMark } from './LearnParts';

/** The deep forest top of the course home and a week, under a forest status band. */
export function CourseMasthead({ navigation, back, onBack, children }: { navigation: NavigationProp<ParamListBase>; back?: string; onBack?: () => void; children: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  const insets = useScreenInsets();
  return (
    <View style={[styles.masthead, { backgroundColor: sc.surface.masthead, paddingTop: insets.top + layout.statusBarGap }]}>
      <ForestStatusBar />
      <LearnBack navigation={navigation} onDark label={back} onPress={onBack} />
      {children}
    </View>
  );
}

/** "From {coach}" over the coach's own words in the italic serif, on sage. */
export function CoachNote({ from, text, testID }: { from: string; text: string; testID?: string }) {
  const { semanticColors: sc } = useTheme();
  const [italic] = useFonts({ CormorantGaramond_400Regular_Italic });
  return (
    <View style={[styles.note, { backgroundColor: sc.surface.sage, borderColor: sc.surface.sageLine }]} testID={testID}>
      <Overline style={{ color: sc.textPrimary }}>{from}</Overline>
      <Text style={[styles.noteText, { color: sc.textPrimary }, italic && styles.italic]}>{text}</Text>
    </View>
  );
}

const ICON = { page: 'document-text-outline', video: 'play-outline', both: 'albums-outline', locked: 'lock-closed-outline' } as const;

/** Done: Learn's forest check. Up next: moss ring. Later or not open yet: a quiet disc with the kind or a lock. */
export function CourseMark({ state, icon, n }: { state: 'done' | 'next' | 'later'; icon?: keyof typeof ICON; n?: number }) {
  const { semanticColors: sc } = useTheme();
  if (state === 'done' || !icon) return <LessonMark state={state} n={n} />;
  const next = state === 'next';
  return (
    <View style={[styles.mark, next ? { borderWidth: 1.5, borderColor: sc.data.moss } : { backgroundColor: sc.data.trackLight }]}>
      <Ionicons name={ICON[icon]} size={14} color={next ? sc.accentText : sc.textMuted} />
    </View>
  );
}

/** The styles the course home and a week share: the masthead text and the hairline list. */
export const makeCourseStyles = (sc: SemanticTokens) => StyleSheet.create({
  page: { paddingHorizontal: 0 },
  onDarkMuted: { color: sc.textOnMastheadMuted, marginTop: 8 },
  onDarkBody: { ...typography.bodySmall, color: sc.textOnMastheadMuted, fontVariant: ['tabular-nums'] },
  title: { ...typography.h1, color: sc.textOnAccent, marginTop: 4, marginBottom: 2 },
  foot: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, rowGap: 2, marginTop: 12 },
  body: { paddingHorizontal: layout.gutter, paddingTop: 24, paddingBottom: 24 },
  list: { backgroundColor: sc.bgSurface, borderRadius: radius.card, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight, paddingVertical: 14, paddingHorizontal: 16, gap: 14 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
  rowTitle: { ...typography.bodyMd, color: sc.textPrimary },
  muted: { ...typography.bodySmall, color: sc.textMuted, fontVariant: ['tabular-nums'] },
  fill: { flex: 1 },
  pressed: { opacity: 0.7 },
});

const styles = StyleSheet.create({
  masthead: { borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, paddingHorizontal: layout.gutter, paddingBottom: 24 },
  note: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 8 },
  noteText: { ...typography.h3, fontFamily: typography.h2.fontFamily, fontWeight: '400', lineHeight: 26 },
  italic: { fontFamily: 'CormorantGaramond_400Regular_Italic' },
  mark: { width: 28, height: 28, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
});
