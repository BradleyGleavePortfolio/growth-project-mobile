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
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CreateMealTemplateInput, MealTemplate } from '../../api/mealTemplatesApi';
import {
  useArchiveMealTemplate,
  useCreateMealTemplate,
  useMealTemplates,
  useUpdateMealTemplate,
} from '../../hooks/useMealTemplates';
import { radius, spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { Screen } from '../../ui/layout/Screen';
import { PrimaryButton, TextLink } from '../../ui/buttons/PrimaryButton';
import { HapticService } from '../../ui/haptics/haptics.service';
import type { ProgramsScreenProps } from './programs/types';
import { LoadFailed, Loading, Masthead, macroLine, saveFailed } from './meals/mealUi';

/** Backend main's CreateMealTemplateDto maxima. */
const LIMITS = { calories_kcal: 2000, protein_g: 300, carbs_g: 400, fats_g: 200 } as const;

export default function CoachMealTemplatesScreen({ route, navigation }: ProgramsScreenProps<'MealEditor'>) {
  const { semanticColors: sc } = useTheme();
  const list = useMealTemplates();
  const mealId = route.params?.mealId;
  const meal = list.data?.find((m) => m.id === mealId);
  if (!mealId || meal) return <MealForm meal={meal} onDone={() => navigation.goBack()} sc={sc} />;
  return (
    <Screen edges={['bottom']} contentStyle={{ gap: spacing.lg }}>
      <Masthead title="Meal" onBack={() => navigation.goBack()} />
      {list.isLoading ? <Loading label="Loading the meal" /> : list.data ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>This meal is not in your list. It may have been archived on another device.</Text>
      ) : <LoadFailed title="This meal didn’t load." error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />}
    </Screen>
  );
}

function MealForm({ meal, onDone, sc }: { meal?: MealTemplate; onDone: () => void; sc: SemanticTokens }) {
  const createMut = useCreateMealTemplate();
  const updateMut = useUpdateMealTemplate();
  const archiveMut = useArchiveMealTemplate();
  const [name, setName] = useState(meal?.name ?? '');
  const [description, setDescription] = useState(meal?.description ?? '');
  const [calories, setCalories] = useState(meal ? String(meal.calories_kcal) : '');
  const [protein, setProtein] = useState(meal ? String(meal.protein_g) : '');
  const [carbs, setCarbs] = useState(meal ? String(meal.carbs_g) : '');
  const [fats, setFats] = useState(meal ? String(meal.fats_g) : '');

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

  return (
    <Screen
      edges={['bottom']}
      footer={<>
        <PrimaryButton label="Save meal" testID="meal-save" disabled={!canSave} loading={pending} haptic={false} onPress={() => {
          void HapticService.mediumImpact();
          void run(() => (meal ? updateMut.mutateAsync({ id: meal.id, input }) : createMut.mutateAsync(input)));
        }} />
        {meal ? <TextLink label="Archive this meal" onPress={archive} disabled={pending} /> : null}
      </>}
    >
      <Masthead title={meal?.name ?? 'New meal'} sub={canSave || pending ? macroLine(input) : undefined} onBack={onDone} />
      <View style={styles.content}>
        <FormField label="Name" sc={sc}>
          <TextInput
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
        {over || (failed && !pending) ? (
          <Text accessibilityRole="alert" style={[typography.body, styles.sectionHeading, { color: sc.textPrimary }]}>
            {over ? 'Up to 2,000 kcal, 300 g protein, 400 g carbs and 200 g fat.' : saveFailed(failed)}
          </Text>
        ) : null}
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

function makeFormStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    content: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
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
