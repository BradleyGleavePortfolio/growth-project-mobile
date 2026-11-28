/**
 * Meal editor (MEALBUILD 1/2, MOCK-K5 Style C): one of the coach's meals on
 * coach/meal-templates, opened from Programs > Meals (New meal, or a meal).
 * Name, the note clients see, and calories and macros inside backend main's
 * limits. Save creates or updates; Archive is the route's soft delete.
 *
 * Macros are entered as integer kcal + grams. Items (ingredient
 * lines) are deliberately omitted from v1 — the backend accepts an
 * optional array and the create form stays compact without it. The
 * column is preserved in the API client so a v2 ingredient editor
 * lands additively.
 *
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3): the editor is the meal page: Options for clients, the
 * Recipe card and Details; one request on Save meal carries the whole option list and the recipe (R2).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CreateMealTemplateInput, MealTemplate } from '../../api/mealTemplatesApi';
import {
  useArchiveMealTemplate,
  useCreateMealTemplate,
  useMealTemplates,
  useUpdateMealTemplate,
} from '../../hooks/useMealTemplates';
import { layout, radius, semantic, spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { Screen, useScreenInsets } from '../../ui/layout/Screen';
import { PrimaryButton, TextLink } from '../../ui/buttons/PrimaryButton';
import { HapticService } from '../../ui/haptics/haptics.service';
import type { ProgramsScreenProps, ProgramsStackParamList } from './programs/types';
import { LoadFailed, Masthead, macroLine, mealStyles as ms } from './meals/mealUi';
import { optionRows, saveRefused } from './meals/mealLinks';
import { useAnsweredOnce, useCoachRecipes } from './meals/coachRecipes';
import { OptionsBlock, RecipeCard, blockTitle, card as panel } from './meals/MealEditorBlocks';

/** Backend main's CreateMealTemplateDto maxima. */
const LIMITS = { calories_kcal: 2000, protein_g: 300, carbs_g: 400, fats_g: 200 } as const;
type Nav = ProgramsScreenProps<'MealEditor'>['navigation'];
type Picked = NonNullable<ProgramsStackParamList['MealEditor']>['picked'];

/**
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3): an existing meal opens only from a list read that is fresh
 * or answered on this visit (R5). The gate is latched, so a later re-read, stale flag or failure never unmounts the
 * form under the pickers.
 */
export default function CoachMealTemplatesScreen({ route, navigation }: ProgramsScreenProps<'MealEditor'>) {
  const { semanticColors: sc } = useTheme();
  const list = useMealTemplates();
  const answered = useAnsweredOnce(list);
  const mealId = route.params?.mealId;
  const meal = answered ? list.data?.find((m) => m.id === mealId) : undefined;
  if (!mealId || meal) {
    return <MealForm meal={meal} live={list.data} answered={answered} picked={route.params?.picked} navigation={navigation} sc={sc} />;
  }
  const loading = !answered && !list.isError;
  return (
    <Screen edges={['bottom']} contentStyle={{ gap: spacing.lg }}
      footer={loading ? <Footer archive held saving={false} disabled onSave={() => undefined} onArchive={() => undefined} /> : undefined}>
      <Masthead title="Meal" onBack={() => navigation.goBack()} />
      {answered && list.data ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>This meal is not in your list. It may have been archived on another device.</Text>
      ) : list.isError ? <LoadFailed title="This meal didn’t load." error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : (
        <View accessible accessibilityLabel="Loading the meal" style={st.stack}>
          {[panel, panel, [ms.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]].map((look, i) => (
            <View key={i} style={[look, st.still]}>
              {[0.45, 0.8, 0.6].map((w) => <View key={w} style={[st.bar, { width: `${w * 100}%`, backgroundColor: sc.border }]} />)}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

/**
 * R13: Archive this meal beside Save meal in one row (a New meal has Save meal only); a refused save says why above it.
 * Archive is off only while a request runs or the meal loads (`held`), not whenever Save meal is (FIX-PSCM-1 N1).
 */
function Footer({ archive, held, saving, disabled, onSave, onArchive, line }: { archive: boolean; held?: boolean; saving: boolean;
  disabled: boolean; onSave: () => void; onArchive: () => void; line?: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View testID="meal-footer" style={st.footer}>
      {line ? (
        <View accessible accessibilityRole="alert" style={st.alert}>
          <Ionicons name="alert-circle-outline" size={18} color={semantic.danger.border} style={st.alertGlyph} />
          <Text style={[typography.bodySmall, ms.fill, { color: sc.textPrimary }]}>{line}</Text>
        </View>
      ) : null}
      <View testID="meal-footer-row" style={st.footerRow}>
        {archive ? <View style={st.archive}><TextLink label="Archive this meal" align="start" onPress={onArchive} disabled={held || saving} /></View> : null}
        <PrimaryButton label="Save meal" wrap testID="meal-save" disabled={disabled} loading={saving} haptic={false} onPress={onSave}
          style={archive ? st.save : ms.fill} />
      </View>
    </View>
  );
}

function MealForm({ meal, live, answered, picked, navigation, sc }: { meal?: MealTemplate; live?: MealTemplate[]; answered: boolean;
  picked: Picked; navigation: Nav; sc: SemanticTokens }) {
  const onDone = () => navigation.goBack();
  const createMut = useCreateMealTemplate();
  const updateMut = useUpdateMealTemplate();
  const archiveMut = useArchiveMealTemplate();
  const recipes = useCoachRecipes();
  const [name, setName] = useState(meal?.name ?? '');
  const [description, setDescription] = useState(meal?.description ?? '');
  const [calories, setCalories] = useState(meal ? String(meal.calories_kcal) : '');
  const [protein, setProtein] = useState(meal ? String(meal.protein_g) : '');
  const [carbs, setCarbs] = useState(meal ? String(meal.carbs_g) : '');
  const [fats, setFats] = useState(meal ? String(meal.fats_g) : '');
  const [options, setOptions] = useState<string[]>(meal?.swap_template_ids ?? []);
  const [recipeId, setRecipeId] = useState<string | null>(meal?.recipe_id ?? null);
  const [editing, setEditing] = useState(false);
  // R3: a picker hands its pick back through the params once (keyed by `at`); every typed field stays.
  const applied = useRef<number>(undefined);
  useEffect(() => {
    if (!picked || picked.at === applied.current) return;
    applied.current = picked.at;
    if (picked.options) setOptions(picked.options);
    if (picked.recipeId !== undefined) setRecipeId(picked.recipeId);
  }, [picked]);
  const scroll = useRef<ScrollView>(null);
  const nameField = useRef<TextInput>(null);
  const detailsY = useRef(0);
  // #ALM-E40 (F03, F08, F10): once no more of the masthead shows than the strip would cover, the strip takes its place,
  // pinned under the top inset, so the page below sits under it as the frames draw.
  const insetTop = useScreenInsets().top;
  const [mastEnd, setMastEnd] = useState(0);
  const [stripH, setStripH] = useState(0);
  const [pinned, setPinned] = useState(false);

  const styles = useMemo(() => makeFormStyles(sc), [sc]);
  const pending = createMut.isPending || updateMut.isPending || archiveMut.isPending;
  const failed = createMut.error ?? updateMut.error ?? archiveMut.error;
  const input: CreateMealTemplateInput = {
    name: name.trim(),
    description: description.trim(),
    calories_kcal: parseInt(calories, 10) || 0,
    protein_g: parseInt(protein, 10) || 0,
    carbs_g: parseInt(carbs, 10) || 0,
    fats_g: parseInt(fats, 10) || 0,
    swap_template_ids: options,
    recipe_id: recipeId,
  };
  const over = (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).some((k) => input[k] > LIMITS[k]);

  const canSave =
    name.trim().length > 0 &&
    parseInt(calories, 10) >= 0 &&
    parseInt(protein, 10) >= 0 &&
    parseInt(carbs, 10) >= 0 &&
    parseInt(fats, 10) >= 0 &&
    !over &&
    !pending;

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      void HapticService.success();
      onDone();
    } catch {
      void HapticService.error();
    }
  };
  const archive = () => meal && Alert.alert(`Archive ${meal.name}?`,
    'It leaves your meal list. Day plans that use it keep it until you swap it.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Archive', onPress: () => void run(() => archiveMut.mutateAsync(meal.id)) },
    ]);
  const note = description.trim();

  return (
    <Screen
      edges={['bottom']}
      scroll={false}
      contentStyle={st.bare}
      footer={<Footer archive={!!meal} saving={pending} disabled={!canSave} line={failed && !pending ? saveRefused(failed) : undefined}
        onArchive={archive} onSave={() => {
          void HapticService.mediumImpact();
          void run(() => (meal ? updateMut.mutateAsync({ id: meal.id, input }) : createMut.mutateAsync(input)));
        }} />}
    >
      <ScrollView ref={scroll} testID="meal-scroll" style={st.fill} contentContainerStyle={[st.content, styles.page]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} scrollEventThrottle={16}
        onScroll={(e) => setPinned(mastEnd > 0 && e.nativeEvent.contentOffset.y >= mastEnd - stripH)}>
      <View testID="meal-masthead" style={st.mast} onLayout={(e) => setMastEnd(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <Masthead title={<Text accessibilityRole="header" style={[ms.title, styles.title, { color: sc.textOnAccent }]}>{meal?.name ?? 'New meal'}</Text>}
        sub={canSave || pending ? macroLine(input) : undefined} onBack={onDone}
        trailing={(
          <Pressable accessibilityRole="button" accessibilityLabel="Edit details" hitSlop={8} style={styles.edit}
            onPress={() => { scroll.current?.scrollTo({ y: detailsY.current, animated: true }); nameField.current?.focus(); }}>
            <Text style={[typography.body, styles.under, { color: sc.textOnAccent }]}>Edit details</Text>
          </Pressable>
        )}>
        {note ? <Text style={[styles.note, { color: sc.textOnMastheadMuted }]}>{`“${note}”`}</Text> : null}
      </Masthead>
      </View>
      <OptionsBlock rows={optionRows(options, live, answered)} editing={editing} onEditing={setEditing} onChange={setOptions}
        onAdd={() => navigation.navigate('MealOptionsPicker', { mealId: meal?.id, mealName: name.trim(), chosen: options })} />
      <RecipeCard recipeId={recipeId} mine={recipes.mine} error={recipes.failed ? recipes.read.error : null}
        retry={() => void recipes.read.refetch()} retrying={recipes.read.isFetching} onRemove={() => setRecipeId(null)}
        onPick={() => navigation.navigate('MealRecipePicker', { mealId: meal?.id, mealName: name.trim(), recipeId })} />
      <View style={panel} onLayout={(e) => { detailsY.current = e.nativeEvent.layout.y; }}>
        <Text accessibilityRole="header" style={[blockTitle, { color: sc.textPrimary }]}>Details</Text>
        <FormField label="Name" sc={sc}>
          <TextInput
            ref={nameField}
            accessibilityLabel="Name"
            value={name}
            onChangeText={setName}
            placeholder="Chicken and rice bowl"
            placeholderTextColor={sc.textMuted}
            style={styles.input}
            maxLength={120}
          />
        </FormField>

        <FormField label="Your note · clients see it" sc={sc}>
          <TextInput
            accessibilityLabel="Your note, clients see it"
            value={description}
            onChangeText={setDescription}
            placeholder="A short note your clients will see"
            placeholderTextColor={sc.textMuted}
            style={styles.input}
            maxLength={500}
            multiline
          />
        </FormField>

        <Text style={[typography.h4, styles.sectionHeading, { color: sc.textPrimary }]}>
          Macros
        </Text>

        <View style={styles.macroRow}>
          <NumField label="Calories (kcal)" value={calories} onChange={setCalories} sc={sc} />
          <NumField label="Protein (g)" value={protein} onChange={setProtein} sc={sc} />
        </View>
        <View style={styles.macroRow}>
          <NumField label="Carbs (g)" value={carbs} onChange={setCarbs} sc={sc} />
          <NumField label="Fat (g)" value={fats} onChange={setFats} sc={sc} />
        </View>
        {over ? (
          <Text accessibilityRole="alert" style={[typography.body, styles.sectionHeading, { color: sc.textPrimary }]}>
            Up to 2,000 kcal, 300 g protein, 400 g carbs and 200 g fat.
          </Text>
        ) : null}
      </View>
      </ScrollView>
      {/* Decoration for sighted readers (VoiceOver reads the masthead once); drawn only while pinned. With no name, the macros alone. */}
      <View testID="meal-strip" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents={pinned ? 'auto' : 'none'}
        onLayout={(e) => setStripH(e.nativeEvent.layout.height)}
        style={[st.strip, { backgroundColor: sc.surface.masthead, paddingTop: insetTop + spacing.xs, opacity: pinned ? 1 : 0 }]}>
        <Text style={[typography.body, { color: sc.textOnMastheadMuted }]}>{[name.trim(), macroLine(input)].filter(Boolean).join(' · ')}</Text>
      </View>
    </Screen>
  );
}

function FormField(props: {
  label: string;
  sc: SemanticTokens;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={[typography.caption, { color: props.sc.textMuted, marginBottom: spacing.xs }]}>
        {props.label}
      </Text>
      {props.children}
    </View>
  );
}

function NumField(props: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  sc: SemanticTokens;
}) {
  const { label, value, onChange, sc } = props;
  return (
    <View style={{ flex: 1, marginRight: spacing.sm }}>
      <Text style={[typography.caption, { color: sc.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        style={{
          borderWidth: 1,
          borderColor: sc.border,
          borderRadius: radius.input,
          minHeight: 44,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          color: sc.textPrimary,
          backgroundColor: sc.bgSurface,
        }}
        maxLength={5}
      />
    </View>
  );
}

const st = StyleSheet.create({
  // The page scrolls in its own view so the strip can follow it; it draws as Screen's scroll area does.
  bare: { paddingHorizontal: 0, paddingBottom: 0 },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: layout.gutter },
  mast: { marginHorizontal: -layout.gutter, paddingHorizontal: layout.gutter }, // the masthead keeps its own full bleed
  // S1_F03, F08, F10: the masthead's colour and bottom corners, 2 pt under the inset (the nearest token, 4), 12 pt below.
  strip: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: layout.gutter, paddingBottom: spacing.md,
    borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  stack: { gap: 14 },
  still: { minHeight: 132 },
  bar: { height: 14, borderRadius: radius.chip },
  footer: { gap: spacing.sm },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  // S1_F01 at 390 / 100% and 320 / 130%: the link keeps its own width (it wraps only when the row is short) and Save
  // meal takes the rest, never narrower than its label.
  archive: { flexShrink: 1 },
  save: { flexGrow: 1, flexShrink: 0 },
  alert: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  // S1_F10 (FIX-PSCM-2, LO B1): the refusal line at the page's 14 pt on 22 pt lines, its glyph at 18 as Line draws one.
  alertGlyph: { marginTop: 2 },
});

function makeFormStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    page: { gap: 14, paddingBottom: spacing.xl },
    edit: { minHeight: layout.touchMin, justifyContent: 'center' },
    under: { textDecorationLine: 'underline' },
    title: { ...typography.h1 }, // S1_F01 draws the meal's name at h1 (32 pt), not the masthead's 40
    note: { fontFamily: typography.display.fontFamily, fontStyle: 'italic', fontSize: 19, lineHeight: 25 },
    input: {
      borderWidth: 1,
      borderColor: sc.border,
      borderRadius: radius.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: sc.textPrimary,
      backgroundColor: sc.bgSurface,
      minHeight: 44,
    },
    sectionHeading: { marginTop: spacing.lg, marginBottom: spacing.sm },
    macroRow: { flexDirection: 'row', marginTop: spacing.sm },
  });
}
