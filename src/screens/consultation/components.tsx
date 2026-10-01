/**
 * Consultation building blocks: frame, progress, rows, chips, wheels,
 * checkbox, buttons and Roman's line. Tokens only (theme/tokens), weights
 * 400/500, radius 4 or less (pills on chips only), and every control carries
 * an accessibility role, label and state.
 */
import React, { useContext, useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityActionEvent,
  Animated,
  Easing,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { colors, lightTokens, radius, spacing, typography } from '../../theme/tokens';
import RomanAvatar from '../../components/roman/RomanAvatar';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { ChapterProgress, OptionDef } from '../../lib/consultation/types';
import { progressSegments } from '../../lib/consultation/engine';
import { CHAPTER_NAMES } from '../../lib/consultation/definitions';

/** Step motion: 280ms decelerate (approved prototype decision C-D7). */
export const STEP_MS = 280;

export const palette = {
  bg: colors.bone,
  surface: lightTokens.bgSurface,
  ink: colors.ink,
  charcoal: colors.charcoal,
  muted: lightTokens.textMuted,
  border: lightTokens.border,
  accent: colors.forest,
  onAccent: colors.bone,
  disabledBg: lightTokens.disabledBg,
  onDisabled: lightTokens.textOnDisabled,
  hair: colors.camel,
  stone: colors.stone,
};

// ─── Motion ──────────────────────────────────────────────────────────────────

export function FadeIn({
  children,
  delayIndex = 0,
  style,
}: {
  children: React.ReactNode;
  delayIndex?: number;
  style?: object;
}) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    const anim = Animated.timing(opacity, {
      toValue: 1,
      duration: STEP_MS,
      delay: delayIndex * 80,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reduced, delayIndex, opacity]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

// ─── Text pieces ─────────────────────────────────────────────────────────────

export function Eyebrow({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <Text style={s.eyebrow} testID={testID}>
      {children}
    </Text>
  );
}

export function RomanLine({ text, size = 28 }: { text: string; size?: number }) {
  return (
    <View style={s.romanLine} accessible accessibilityLabel={`Roman says: ${text}`}>
      <RomanAvatar crop="neutral" size={size} />
      <Text style={s.romanText}>{text}</Text>
    </View>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

export function PrimaryButton({
  label,
  onPress,
  disabled,
  testID,
  hint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  hint?: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={({ pressed }) => [s.cta, disabled && s.ctaDisabled, pressed && !disabled && s.pressed]}
    >
      <Text style={[s.ctaText, disabled && s.ctaTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

export function TextLink({
  label,
  onPress,
  testID,
  accent,
  role = 'button',
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  accent?: boolean;
  /** "link" for a control that leaves the app (opens a web page). */
  role?: 'button' | 'link';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      testID={testID}
      hitSlop={8}
      style={s.link}
    >
      <Text style={[s.linkText, accent && s.linkAccent]}>{label}</Text>
    </Pressable>
  );
}

// ─── Frame ───────────────────────────────────────────────────────────────────

export function ProgressBar({ progress }: { progress: ChapterProgress }) {
  const segs = progressSegments(progress);
  const name = CHAPTER_NAMES[progress.chapter];
  return (
    <View
      style={s.progress}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Consultation progress"
      accessibilityValue={{
        min: 0,
        max: progress.totalChapters,
        now: progress.chapter,
        text: `Chapter ${progress.chapter} of ${progress.totalChapters}, ${name}`,
      }}
      testID="consult-progress"
    >
      {segs.map((w, i) => (
        <View key={i} style={s.seg}>
          <View style={[s.segFill, { width: `${Math.round(w * 100)}%` }]} />
        </View>
      ))}
    </View>
  );
}

export interface FrameProps {
  progress?: ChapterProgress | null;
  onBack?: (() => void) | null;
  onFinishLater?: (() => void) | null;
  pauseLabel?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testID?: string;
}

/**
 * Analytics exclusion boundary (Sol A-01). The app's PostHog provider has
 * touch autocapture on; it walks up from the touched element and drops the
 * whole event when any ancestor carries `ph-no-capture`. The consultation
 * renders every phase (questions, summary, reveals, problem and paused
 * states) inside this boundary, and the Frame, its scroll body and footer
 * repeat the marker so the boundary is always within the SDK's 20-element
 * ancestor walk. No consultation answer, screen id, measurement, note or
 * summary sentence can reach the SDK through autocapture.
 */
export const NO_CAPTURE_PROP = 'ph-no-capture' as const;

export function AnalyticsExcluded({ children }: { children: React.ReactNode }) {
  return (
    <View ph-no-capture style={{ flex: 1 }} testID="consult-analytics-excluded">
      {children}
    </View>
  );
}

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Safe-area insets without requiring a provider (tests and previews render
 * without one). The consultation is mounted directly by RootNavigator, not
 * inside a native stack, so the frame must consume the insets itself (Sol B-04).
 */
export function useConsultInsets() {
  return useContext(SafeAreaInsetsContext) ?? ZERO_INSETS;
}

export function Frame({ progress, onBack, onFinishLater, pauseLabel, children, footer, testID }: FrameProps) {
  const insets = useConsultInsets();
  return (
    <View
      ph-no-capture
      style={[s.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}
      testID={testID}
    >
      <View style={s.topbar} testID="consult-topbar">
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            testID="consult-back"
            style={s.iconBtn}
          >
            <Ionicons name="chevron-back" size={22} color={palette.ink} />
          </Pressable>
        ) : (
          <View style={s.iconBtn} />
        )}
        {onFinishLater ? (
          <Pressable
            onPress={onFinishLater}
            accessibilityRole="button"
            accessibilityLabel={pauseLabel ? 'Pause' : 'Finish later'}
            accessibilityHint="Saves your answers so you can continue later"
            hitSlop={10}
            testID="consult-finish-later"
          >
            <Text style={s.finishText}>{pauseLabel ? 'Pause' : 'Finish later'}</Text>
          </Pressable>
        ) : null}
      </View>
      {progress ? <ProgressBar progress={progress} /> : null}
      {/* Opus C-6: the notes inputs scroll above the keyboard on iOS. */}
      <ScrollView
        ph-no-capture
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        testID="consult-scroll"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View ph-no-capture style={[s.footer, { paddingBottom: spacing.xl + insets.bottom }]} testID="consult-footer">
          {footer}
        </View>
      ) : (
        <View style={{ height: 34 + insets.bottom }} testID="consult-footer" />
      )}
    </View>
  );
}

export function QuestionHeader({
  eyebrow,
  timeLeft,
  sub,
  roman,
  question,
  long,
  why,
}: {
  eyebrow?: string;
  timeLeft?: string;
  sub?: string;
  roman?: string;
  question: string;
  long?: boolean;
  why?: string;
}) {
  return (
    <View>
      <View style={s.eyerow}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : <View />}
        {timeLeft ? <Text style={s.timeLeft}>{timeLeft}</Text> : null}
      </View>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
      {roman ? <RomanLine text={roman} /> : null}
      <Text style={[long ? s.h2 : s.h1, s.question]} accessibilityRole="header">
        {question}
      </Text>
      {why ? <Text style={s.why}>{why}</Text> : null}
    </View>
  );
}

// ─── Options ─────────────────────────────────────────────────────────────────

export function OptionRow({
  option,
  selected,
  onPress,
  tall,
  testID,
}: {
  option: OptionDef;
  selected: boolean;
  onPress: () => void;
  tall?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={option.sub ? `${option.label}. ${option.sub}` : option.label}
      accessibilityState={{ selected, checked: selected }}
      testID={testID}
      style={({ pressed }) => [s.row, tall && s.rowTall, selected && s.rowSel, pressed && s.pressed]}
    >
      <View style={s.rowTextWrap}>
        <Text style={s.rowLabel}>{option.label}</Text>
        {option.sub ? <Text style={s.rowSub}>{option.sub}</Text> : null}
      </View>
      <View style={[s.radio, selected && s.radioSel]}>{selected ? <View style={s.radioDot} /> : null}</View>
    </Pressable>
  );
}

export function Chip({
  option,
  selected,
  onPress,
  single,
  big,
  capped,
  testID,
}: {
  option: OptionDef;
  selected: boolean;
  onPress: () => void;
  single?: boolean;
  big?: boolean;
  capped?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={single ? 'radio' : 'checkbox'}
      accessibilityLabel={option.label}
      accessibilityState={{ selected, checked: selected, disabled: !!capped && !selected }}
      testID={testID}
      style={({ pressed }) => [s.chip, big && s.chipBig, selected && s.chipSel, pressed && s.pressed]}
    >
      <Text style={[big ? s.chipBigText : s.chipText, selected && s.chipTextSel, capped && !selected && s.chipCapped]}>
        {option.label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={14} color={palette.onAccent} style={s.chipCheck} /> : null}
    </Pressable>
  );
}

export function Checkbox({
  checked,
  onToggle,
  label,
  testID,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      testID={testID}
      style={({ pressed }) => [s.checkRow, checked && s.rowSel, pressed && s.pressed]}
    >
      <View style={[s.box, checked && s.boxOn]}>
        {checked ? <Ionicons name="checkmark" size={16} color={palette.onAccent} /> : null}
      </View>
      <Text style={s.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export function LabeledInput({
  label,
  value,
  onChange,
  maxLength,
  multiline,
  testID,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  maxLength?: number;
  multiline?: boolean;
  testID?: string;
}) {
  return (
    <View style={s.inputWrap}>
      <Text style={s.flabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        multiline={multiline}
        accessibilityLabel={label}
        placeholder={maxLength ? `Up to ${maxLength} characters` : undefined}
        placeholderTextColor={palette.muted}
        style={[s.field, multiline && s.fieldMulti]}
        testID={testID}
      />
    </View>
  );
}

export function UnitTabs({
  unit,
  onChange,
}: {
  unit: 'imperial' | 'metric';
  onChange: (u: 'imperial' | 'metric') => void;
}) {
  return (
    <View style={s.tabs} accessibilityRole="tablist">
      {(['imperial', 'metric'] as const).map((u) => (
        <Pressable
          key={u}
          onPress={() => onChange(u)}
          accessibilityRole="tab"
          accessibilityLabel={u === 'imperial' ? 'Imperial units' : 'Metric units'}
          accessibilityState={{ selected: unit === u }}
          testID={`unit-${u}`}
          style={[s.tab, unit === u && s.tabOn]}
        >
          <Text style={[s.tabText, unit === u && s.tabTextOn]}>{u === 'imperial' ? 'Imperial' : 'Metric'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Wheel ───────────────────────────────────────────────────────────────────

const ROW_H = 44;

export function Wheel<T extends string | number>({
  label,
  values,
  value,
  onChange,
  format,
  testID,
}: {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
  testID?: string;
}) {
  const ref = useRef<ScrollView>(null);
  const idx = Math.max(0, values.indexOf(value));
  const fmt = useMemo(() => format ?? ((v: T) => String(v)), [format]);

  useEffect(() => {
    ref.current?.scrollTo?.({ y: idx * ROW_H, animated: false });
  }, [idx]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / ROW_H);
    const clamped = Math.min(values.length - 1, Math.max(0, i));
    if (values[clamped] !== value) onChange(values[clamped]);
  };

  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment' && idx < values.length - 1) onChange(values[idx + 1]);
    if (e.nativeEvent.actionName === 'decrement' && idx > 0) onChange(values[idx - 1]);
  };

  return (
    <View
      style={s.wheelFrame}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: fmt(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}
      testID={testID}
    >
      <View pointerEvents="none" style={s.wheelBand} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW_H}
        decelerationRate="fast"
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        contentOffset={{ x: 0, y: idx * ROW_H }}
        contentContainerStyle={{ paddingVertical: ROW_H * 2 }}
        importantForAccessibility="no-hide-descendants"
      >
        {values.map((v, i) => (
          <View key={String(v)} style={s.wheelRow}>
            <Text style={[s.wheelText, i === idx && s.wheelTextOn]}>{fmt(v)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    minHeight: 48,
  },
  iconBtn: { width: 44, height: 44, justifyContent: 'center' },
  finishText: { ...typography.bodySmall, color: palette.muted },
  progress: { flexDirection: 'row', gap: 4, paddingHorizontal: spacing.xl, marginTop: spacing.xs },
  seg: { flex: 1, height: 2, backgroundColor: palette.border, overflow: 'hidden' },
  segFill: { height: 2, backgroundColor: palette.accent },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, paddingTop: spacing.md, gap: spacing.md },
  footerSpacer: { height: 34 },
  eyerow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { ...typography.eyebrow, color: palette.muted },
  timeLeft: { ...typography.caption, letterSpacing: 0, color: palette.muted },
  sub: { ...typography.caption, letterSpacing: 0, color: palette.muted, marginTop: 6 },
  romanLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg },
  romanText: {
    flex: 1,
    fontFamily: 'CormorantGaramond_400Regular',
    fontStyle: 'italic',
    fontWeight: '400',
    fontSize: 19,
    lineHeight: 26,
    color: palette.charcoal,
  },
  h1: { ...typography.h1, color: palette.ink },
  h2: { ...typography.h2, color: palette.ink },
  display: { ...typography.display, color: palette.ink },
  h3: { ...typography.h3, color: palette.ink },
  body: { ...typography.body, color: palette.ink },
  small: { ...typography.bodySmall, color: palette.ink },
  mutedSmall: { ...typography.bodySmall, color: palette.muted },
  question: { marginTop: spacing.xl },
  why: { ...typography.bodySmall, color: palette.muted, marginTop: spacing.sm },
  answers: { marginTop: spacing.xl, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
  },
  rowTall: { minHeight: 72 },
  rowSel: { borderColor: palette.accent },
  rowTextWrap: { flex: 1, paddingRight: spacing.md },
  rowLabel: { ...typography.bodyMd, color: palette.ink },
  rowSub: { ...typography.bodySmall, color: palette.muted },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.stone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSel: { borderColor: palette.accent },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: palette.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
  },
  chipBig: { minHeight: 56, minWidth: 72, justifyContent: 'center' },
  chipSel: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipText: { ...typography.bodySmall, color: palette.ink },
  chipBigText: { ...typography.h3, color: palette.ink },
  chipTextSel: { color: palette.onAccent },
  chipCapped: { color: palette.muted },
  chipCheck: { marginLeft: 6 },
  capNote: { ...typography.caption, letterSpacing: 0, color: palette.muted, marginTop: spacing.sm },
  softNote: { ...typography.bodySmall, color: palette.charcoal, marginTop: spacing.md },
  errorNote: { ...typography.bodySmall, color: palette.charcoal, marginTop: spacing.md },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    marginTop: spacing.lg,
  },
  box: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: palette.charcoal,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  boxOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  checkLabel: { ...typography.bodyMd, color: palette.ink, flex: 1 },
  inputWrap: { marginTop: spacing.lg },
  flabel: { ...typography.caption, letterSpacing: 0, color: palette.charcoal, marginBottom: 6 },
  field: {
    ...typography.body,
    color: palette.ink,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  fieldMulti: { minHeight: 72, textAlignVertical: 'top' },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, marginBottom: spacing.lg },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: palette.accent },
  tabText: { ...typography.bodySmall, color: palette.ink },
  tabTextOn: { color: palette.onAccent },
  wheels: { flexDirection: 'row', gap: spacing.md },
  wheelCol: { flex: 1 },
  wheelFrame: { height: ROW_H * 5, overflow: 'hidden', marginTop: spacing.sm },
  wheelBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ROW_H * 2,
    height: ROW_H,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.border,
  },
  wheelRow: { height: ROW_H, alignItems: 'center', justifyContent: 'center' },
  wheelText: { ...typography.body, color: palette.muted },
  wheelTextOn: { ...typography.bodyMd, color: palette.ink },
  cta: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xl,
  },
  ctaDisabled: { backgroundColor: palette.disabledBg },
  ctaText: { ...typography.bodyMd, color: palette.onAccent },
  ctaTextDisabled: { color: palette.onDisabled },
  link: { alignSelf: 'center', paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
  linkText: { ...typography.bodySmall, color: palette.muted },
  linkAccent: { color: palette.accent },
  pressed: { opacity: 0.85 },
  hair: { height: 1, backgroundColor: palette.border, marginVertical: spacing.xl },
  listItem: {
    ...typography.bodySmall,
    color: palette.ink,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
});
