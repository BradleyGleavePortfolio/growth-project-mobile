/**
 * Frame and building blocks of the coach consultation (prototype 78-85):
 * back chevron and "Finish later", the five-segment chapter bar, the overline
 * and serif question, then the body and a pinned footer (one forest button,
 * at most one quiet link). Built on the shared Screen, ScreenTopBar, Headline
 * and TextLink; insets from react-native-safe-area-context; radii from tokens
 * only (chips and radios pill, fields 12, card 16).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, ScreenTopBar } from '../../../ui/layout/Screen';
import { TextLink } from '../../../ui/buttons/PrimaryButton';
import { Headline } from '../../../ui/text/Headline';
import { QuietOverline } from '../../../ui/sections/QuietSection';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, spacing, typography } from '../../../theme/tokens';
import { segmentFill } from '../../../lib/coachConsultation/flow';
import type { CoachProgress } from '../../../lib/coachConsultation/types';

export function ChapterBar({ progress }: { progress: CoachProgress }) {
  const { semanticColors: sc } = useTheme();
  const text = `Step ${progress.chapter} of ${progress.total}`;
  return (
    <View
      style={styles.bar}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Practice setup progress"
      accessibilityValue={{ min: 0, max: progress.total, now: progress.chapter, text }}
      testID="coach-consult-progress"
    >
      {segmentFill(progress).map((w, i) => (
        <View key={i} style={[styles.seg, { backgroundColor: sc.border }]}>
          <View style={[styles.segFill, { width: `${Math.round(w * 100)}%`, backgroundColor: sc.accent }]} />
        </View>
      ))}
    </View>
  );
}

export interface CoachStepFrameProps {
  progress: CoachProgress | null;
  eyebrow: string;
  headline: string;
  /** Quiet line under the overline (e.g. "Choose up to five."). */
  sub?: string;
  onBack: (() => void) | null;
  onFinishLater?: () => void;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  testID?: string;
}

export function CoachStepFrame(props: CoachStepFrameProps) {
  const { progress, eyebrow, headline, sub, onBack, onFinishLater, footer, children, testID } = props;
  const { semanticColors: sc } = useTheme();
  const finish = onFinishLater ? (
    <TextLink
      label="Finish later"
      size="small"
      onPress={onFinishLater}
      accessibilityHint="Saves your answers so you can continue later"
      testID="coach-consult-finish-later"
    />
  ) : undefined;
  const header = (
    <View>
      <ScreenTopBar onBack={onBack ?? undefined} trailing={finish} testID="coach-consult-topbar" />
      {progress ? <ChapterBar progress={progress} /> : null}
    </View>
  );
  return (
    <Screen header={header} footer={footer} testID={testID}>
      <QuietOverline style={styles.eyebrow}>{eyebrow}</QuietOverline>
      {sub ? <Text style={[styles.sub, { color: sc.textMuted }]}>{sub}</Text> : null}
      <Headline level="h1" style={styles.headline}>
        {headline}
      </Headline>
      <View style={styles.body}>{children}</View>
    </Screen>
  );
}

interface ChoiceProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/** Pill chip: checkbox (multi) or radio (single). `capped` mutes unselected chips at the limit. */
export function ChoiceChip({ label, selected, onPress, testID, single, capped }: ChoiceProps & { single?: boolean; capped?: boolean }) {
  const { semanticColors: sc } = useTheme();
  const muted = !!capped && !selected;
  const color = selected ? sc.accentText : muted ? sc.textMuted : sc.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={single ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected, disabled: muted }}
      testID={testID}
      style={({ pressed }) => [styles.chip, { borderColor: selected ? sc.accent : sc.border }, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, { color }]}>{label}</Text>
      {selected ? <Ionicons name="checkmark" size={14} color={sc.accentText} style={styles.chipCheck} /> : null}
    </Pressable>
  );
}

/** Hairline radio row with a supporting line (K4, K5). */
export function ChoiceRow({ label, sub, selected, onPress, testID }: ChoiceProps & { sub?: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      accessibilityState={{ selected, checked: selected }}
      testID={testID}
      style={({ pressed }) => [styles.row, { borderColor: sc.border }, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: sc.textPrimary }]}>{label}</Text>
        {sub ? <Text style={[styles.rowSub, { color: sc.textMuted }]}>{sub}</Text> : null}
      </View>
      <View style={[styles.radio, { borderColor: selected ? sc.accent : sc.textMuted }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: sc.accent }]} /> : null}
      </View>
    </Pressable>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (t: string) => void;
  maxLength: number;
  multiline?: boolean;
  autoCapitalize?: 'words' | 'sentences';
  testID?: string;
}

/** Labelled text field (overline label, 12 pt radius, hairline border). */
export function Field({ label, value, onChange, maxLength, multiline, autoCapitalize = 'sentences', testID }: FieldProps) {
  const { semanticColors: sc } = useTheme();
  const look = { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgSurface };
  return (
    <View style={styles.fieldWrap}>
      <QuietOverline>{label}</QuietOverline>
      <TextInput
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={label}
        style={[styles.field, look, multiline && styles.fieldMulti]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: layout.gutter, marginTop: spacing.xs },
  seg: { flex: 1, height: 2, overflow: 'hidden' },
  segFill: { height: 2 },
  eyebrow: { marginTop: spacing.xl },
  sub: { ...typography.bodySmall, marginTop: 6 },
  headline: { marginTop: spacing.md },
  body: { marginTop: spacing.xl },
  pressed: { opacity: 0.6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.touchMin,
    paddingHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
  },
  chipText: { ...typography.bodySmall },
  chipCheck: { marginLeft: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.rowMinHeight,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, paddingRight: spacing.md },
  rowLabel: { ...typography.bodyMd },
  rowSub: { ...typography.bodySmall },
  radio: { width: 20, height: 20, borderRadius: radius.chip, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: radius.chip },
  fieldWrap: { marginTop: spacing.lg, gap: 6 },
  field: {
    ...typography.body,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: layout.touchMin,
  },
  fieldMulti: { minHeight: 88, textAlignVertical: 'top' },
});
