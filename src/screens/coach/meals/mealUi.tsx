/** MEALBUILD (MOCK-K5 Style C): the meal-plan screens' masthead, tabs, numbers and states (Style C roles, theme/README). */
import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, gold, layout, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui/layout/Screen';
import { PrimaryButton, TextLink } from '../../../ui/buttons/PrimaryButton';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { isConnectionFailure } from '../../../ui/states/QuietStates';
import { toIsoDate } from '../../../api/programsApi';
import type { DailyMealPlan, MealTemplate, SlotLabel } from '../../../api/mealTemplatesApi';
import type { MealPlanRun } from '../../../hooks/useMealTemplates';
import type { ProgramsNav } from '../programs/types';

export type ProgramsHalf = 'workouts' | 'plans' | 'meals';
type Macros = Pick<MealTemplate, 'calories_kcal' | 'protein_g' | 'carbs_g' | 'fats_g'>;
const TABS: [ProgramsHalf, string][] = [['workouts', 'Workouts'], ['plans', 'Meal plans'], ['meals', 'Meals']];

export const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const count = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
export const macroLine = (m: Macros) =>
  `${num(m.calories_kcal)} kcal · P ${num(m.protein_g)} · C ${num(m.carbs_g)} · F ${num(m.fats_g)}`;
export const dayTotals = (slots: { meal_template: Macros }[]): Macros => slots.reduce((t, { meal_template: m }) => ({
  calories_kcal: t.calories_kcal + m.calories_kcal, protein_g: t.protein_g + m.protein_g,
  carbs_g: t.carbs_g + m.carbs_g, fats_g: t.fats_g + m.fats_g,
}), { calories_kcal: 0, protein_g: 0, carbs_g: 0, fats_g: 0 });
/** The runs covering `day` for a client, newest first: the client sees every one, in this order (getTodayForClient, ClientDailyMealPlanScreen). */
export const covering = (runs: MealPlanRun[], client: string, day: string) => runs
  .filter((r) => r.client === client && r.from <= day && (!r.to || r.to >= day)).sort((a, b) => b.from.localeCompare(a.from));
/** Clients who see `planId` today or on a later day. */
export const clientsOn = (runs: MealPlanRun[], planId: string, today = toIsoDate(new Date())) =>
  new Set(runs.filter((r) => r.plan.id === planId && (!r.to || r.to >= today)).map((r) => r.client));
export const saveFailed = (err: unknown) => `That did not save. ${isConnectionFailure(err)
  ? 'Check your connection, then try again.' : 'Try again in a moment.'}`;
export const httpStatus = (err: unknown) => (err as { response?: { status?: number } } | null)?.response?.status;
/** The plan PATCH answers 400 when a slot's meal was archived (validateSlotTemplates). */
export const planSaveFailed = (err: unknown) =>
  httpStatus(err) === 400 ? 'A meal in this plan was archived. Swap it, then try again.' : saveFailed(err);
export const SLOT_NAMES: Record<SlotLabel, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', preworkout: 'Pre-workout', postworkout: 'Post-workout',
};
export const sortedSlots = (p: DailyMealPlan) => [...p.slots].sort((a, b) => a.order - b.order);

export function Masthead({ title, sub, onBack, children }: { title: React.ReactNode; sub?: string; onBack?: () => void; children?: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  const top = useScreenInsets().top + layout.statusBarGap;
  return (
    <View style={[s.mast, { backgroundColor: sc.surface.masthead, paddingTop: top }]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={8}
          style={({ pressed }) => [s.back, pressed && s.pressed]}>
          <Ionicons name="chevron-back" size={24} color={sc.textOnAccent} />
        </Pressable>
      ) : null}
      {typeof title === 'string' ? <Text accessibilityRole="header" style={[s.title, { color: sc.textOnAccent }]}>{title}</Text> : title}
      {sub ? <Text style={[typography.body, { color: sc.textOnMastheadMuted }]}>{sub}</Text> : null}
      {children}
    </View>
  );
}

/** Text tabs, underlined: leaf on the masthead, forest on bone (the Workouts half). */
export function ProgramsTabs({ value, onChange, onDark = false }: { value: ProgramsHalf; onChange: (h: ProgramsHalf) => void; onDark?: boolean }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View accessibilityRole="tablist" style={s.tabs}>
      {TABS.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable key={key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }}
            testID={`programs-tab-${key}`} style={({ pressed }) => [s.tab, pressed && s.pressed]}
            onPress={() => { if (!on) { void HapticService.selection(); onChange(key); } }}>
            <Text style={[on ? typography.bodyMd : typography.body, s.tabText,
              { color: onDark ? (on ? sc.textOnAccent : sc.textOnMastheadMuted) : on ? sc.textPrimary : sc.textMuted }]}>{label}</Text>
            <View style={[s.line, on && { backgroundColor: onDark ? sc.data.leaf : sc.accent }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** K5 C loading: static card placeholders (no shimmer); the reader hears the label once. */
export function Loading({ label }: { label: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View accessible accessibilityLabel={label} style={s.stack}>
      {[0, 1, 2].map((i) => <View key={i} style={[s.card, s.ghost, { backgroundColor: sc.bgSurface, borderColor: sc.border }]} />)}
    </View>
  );
}

/** K5 error: a cream card, a Cormorant line, Try again (the one filled button), Contact support. One error haptic. */
export function LoadFailed({ title, error, onRetry, retrying }: { title: string; error: unknown; onRetry: () => void; retrying?: boolean }) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<ProgramsNav>();
  useEffect(() => { void HapticService.error(); }, []);
  return (
    <View accessibilityRole="alert" style={[s.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
      <Text style={[s.cardTitle, { color: sc.textPrimary }]}>{title}</Text>
      <Text style={[typography.body, { color: sc.textMuted }]}>{`Your plans are safe. ${isConnectionFailure(error)
        ? 'Check your connection and try again.' : 'Try again in a moment.'}`}</Text>
      <PrimaryButton label="Try again" onPress={onRetry} loading={retrying} />
      <TextLink label="Contact support" tone="accent" underline={false} onPress={() => navigation.navigate('SupportInbox')} />
    </View>
  );
}

/** Gold-ground note (offline, conflicts); ink text on the fixed light ground in both schemes. */
export const Notice = ({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) => (
  <View accessibilityLiveRegion="polite" style={[s.notice, { backgroundColor: colors.warningBg, borderColor: gold[200] }]}>
    <Ionicons name={icon} size={20} color={colors.warningInk} />
    <Text style={[typography.bodySmall, s.fill, { color: colors.ink }]}>{children}</Text>
  </View>
);

export const OfflineNote = ({ at }: { at: number }) => (
  <Notice icon="cloud-offline-outline">{`You’re offline. This is your list as of ${new Date(at).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' })}. Saving needs a connection.`}</Notice>
);

export function FirstCard({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={[s.card, { backgroundColor: sc.surface.sage }]}>
      <Text accessibilityRole="header" style={[s.cardTitle, { color: sc.textPrimary }]}>{title}</Text>
      <Text style={[typography.body, { color: sc.textPrimary }]}>{body}</Text>
      {children}
    </View>
  );
}

/**
 * Masthead choice chips, one picked (cream fill, ink text); selection haptic. `pick` ends the row with a chip that
 * opens a date picker; when the choice is none of the items, that chip is the picked one and says it (`chosen`).
 */
export function Chips<T extends string | number>({ items, value, onChange, label, scroll, pick }: { items: [T, string][]; value: T; onChange: (v: T) => void; label: string;
  scroll?: boolean; pick?: { label: string; open: boolean; onPress: () => void; chosen?: string } }) {
  const { semanticColors: sc } = useTheme();
  const look = (on: boolean) => ({ borderColor: on ? sc.bgSurface : sc.data.plannedOnDark, backgroundColor: on ? sc.bgSurface : 'transparent' });
  const ink = (on: boolean) => [on ? typography.bodyMd : typography.body, { color: on ? sc.textPrimary : sc.textOnAccent }];
  const row = (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[s.chips, scroll && s.oneRow]}>
      {items.map(([key, text]) => {
        const on = key === value;
        return (
          <Pressable key={String(key)} accessibilityRole="radio" accessibilityLabel={text} accessibilityState={{ checked: on }}
            onPress={() => { if (!on) { void HapticService.selection(); onChange(key); } }}
            style={({ pressed }) => [s.chip, look(on), pressed && s.pressed]}>
            <Text style={ink(on)}>{text}</Text>
          </Pressable>
        );
      })}
      {pick ? (
        <Pressable accessibilityRole="button" accessibilityLabel={pick.label} accessibilityValue={pick.chosen ? { text: pick.chosen } : undefined}
          accessibilityState={{ expanded: pick.open, selected: !!pick.chosen }} onPress={() => { void HapticService.selection(); pick.onPress(); }}
          style={({ pressed }) => [s.chip, s.pick, look(!!pick.chosen), pressed && s.pressed]}>
          <Ionicons name="calendar-outline" size={18} color={pick.chosen ? sc.textPrimary : sc.textOnAccent} />
          <Text style={ink(!!pick.chosen)}>{pick.chosen ?? 'Pick a date'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
  return scroll ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.bleedPad}>{row}</ScrollView> : row;
}

export const mealStyles = StyleSheet.create({
  mast: { marginHorizontal: -layout.gutter, paddingHorizontal: layout.gutter, paddingBottom: 20, gap: 6, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  back: { width: layout.touchMin, height: layout.touchMin, marginLeft: -10, justifyContent: 'center' },
  title: { ...typography.display, fontSize: 40, lineHeight: 50 },
  tabs: { flexDirection: 'row', gap: 24, marginTop: 12 },
  tab: { minHeight: layout.touchMin, justifyContent: 'flex-end' }, tabText: { fontSize: 17 },
  line: { height: 3, marginTop: 8, borderRadius: radius.chip },
  pressed: { opacity: 0.6 }, stack: { gap: 12 }, fill: { flex: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', borderRadius: radius.card, padding: 20, gap: 12 },
  cardTitle: { ...typography.h2, fontSize: 26, lineHeight: 33 },
  ghost: { height: 112 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, oneRow: { flexWrap: 'nowrap' },
  bleed: { marginHorizontal: -layout.gutter }, bleedPad: { paddingHorizontal: layout.gutter },
  chip: { minHeight: layout.touchMin, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: radius.button },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notice: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth },
});
const s = mealStyles;
