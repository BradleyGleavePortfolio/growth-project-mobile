/** LEARN-A: the back control, the coach's text and the lesson marks, shared by the Learn pages. */
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { useLearn } from './learnData';

const BACK: Record<string, string> = { MoreIndex: 'You', Learn: 'Learn', WorkoutMain: 'Train' };

/** Chevron and the name of the page it returns to (or `label`, LEARN-M5's course and week names; `onPress` when that page is not the one below); 44 pt. */
export function LearnBack({ navigation, onDark = false, label: named, onPress }: { navigation: NavigationProp<ParamListBase>; onDark?: boolean; label?: string; onPress?: () => void }) {
  const { semanticColors: sc } = useTheme();
  const state = navigation.getState?.();
  const label = named || (BACK[state?.routes[state.index - 1]?.name ?? ''] ?? 'Back');
  const color = onDark ? sc.textOnAccent : sc.textPrimary;
  return (
    <Pressable onPress={onPress ?? (() => navigation.goBack())} accessibilityRole="button" hitSlop={8} testID="learn-back"
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Ionicons name="chevron-back" size={22} color={color} />
      <Text style={[styles.backLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The You list's Learn row shows only once there is something to read: the coach's guidelines or a lesson, or a
 * lesson a coachless client kept after their coach deleted their account (#LEARN-COACHLESS op 1).
 * It is the only door, so while it is hidden a You list kept in the background asks again when it is back in
 * view or the phone is back online (the first mount has just asked).
 */
export function LearnDoor({ children }: { children: React.ReactNode }) {
  const { lessons, guidelines, refetch } = useLearn();
  const shown = lessons.length > 0 || (guidelines !== null && guidelines !== 'plan');
  const focused = useIsFocused();
  const online = isEffectivelyOnline(useNetworkStatus());
  const latest = useRef({ shown, refetch });
  latest.current = { shown, refetch };
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current && focused && online && !latest.current.shown) void latest.current.refetch();
    asked.current = true;
  }, [focused, online]);
  return shown ? <>{children}</> : null;
}

const HEADING = /^(?:#{1,3}\s+(.+)|\*\*(.+)\*\*)$/;
const ITEM = /^(?:(?:[-*]\s+|•\s*)(.+)|(\d+\.)\s+(.+))$/;
const plain = (t: string) => t.replace(/\*\*/g, '');

/** The coach's own text as written: # headings, - or • bullets, 1. steps, paragraphs. */
export function LearnText({ text }: { text: string }) {
  const { semanticColors: sc } = useTheme();
  const ink = { color: sc.textPrimary };
  return (
    <View>
      {text.split('\n').map((raw, i) => {
        const line = raw.trim();
        if (!line) return <View key={i} style={styles.gap} />;
        const h = HEADING.exec(line);
        if (h) return <Text key={i} accessibilityRole="header" style={[styles.heading, ink]}>{plain(h[1] ?? h[2])}</Text>;
        const item = ITEM.exec(line);
        if (item) {
          return (
            <View key={i} style={styles.item}>
              <Text style={[styles.body, ink]}>{item[2] ?? '•'}</Text>
              <Text style={[styles.body, styles.fill, ink]}>{plain(item[1] ?? item[3])}</Text>
            </View>
          );
        }
        return <Text key={i} style={[styles.body, styles.para, ink]}>{plain(line)}</Text>;
      })}
    </View>
  );
}

/** Done: forest disc and check. Next: moss ring. Later: planned ring. */
export function LessonMark({ n, state }: { n?: number; state: 'done' | 'next' | 'later' }) {
  const { semanticColors: sc } = useTheme();
  if (state === 'done') {
    return (
      <View style={[styles.mark, { backgroundColor: sc.data.forest }]}>
        <Ionicons name="checkmark" size={16} color={sc.textOnAccent} />
      </View>
    );
  }
  const next = state === 'next';
  return (
    <View style={[styles.mark, styles.ring, { borderColor: next ? sc.data.moss : sc.data.planned }]}>
      <Text style={[styles.markN, { color: next ? sc.accentText : sc.textMuted }]}>{n}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: layout.touchMin, gap: 4, marginLeft: -6 },
  backLabel: { ...typography.body },
  pressed: { opacity: 0.6 },
  gap: { height: 8 },
  heading: { ...typography.h3, marginTop: 16, marginBottom: 6 },
  item: { flexDirection: 'row', gap: 10, paddingLeft: 4, marginBottom: 4 },
  body: { ...typography.body },
  fill: { flex: 1 },
  para: { marginBottom: 12 },
  mark: { width: 28, height: 28, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 1.5 },
  markN: { ...typography.caption, letterSpacing: 0, fontVariant: ['tabular-nums'] },
});
