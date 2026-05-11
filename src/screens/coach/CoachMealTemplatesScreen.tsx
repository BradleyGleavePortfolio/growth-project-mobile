/**
 * CoachMealTemplatesScreen — list the coach's meal templates and offer
 * an inline create form. Editing existing templates is intentionally
 * out of scope for this screen (Sprint B-2 final wave); the API
 * supports it and a follow-up can surface an edit modal without
 * touching navigation.
 *
 * Reads useMealTemplates() and writes via useCreateMealTemplate().
 * Macros are entered as integer kcal + grams. Items (ingredient
 * lines) are deliberately omitted from v1 — the backend accepts an
 * optional array and the create form stays compact without it. The
 * column is preserved in the API client so a v2 ingredient editor
 * lands additively.
 *
 * Palette: uses sc.accent from useTheme(), which resolves to oxblood
 * #4A0404 on the existing semantic token set. Matches PR #130.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CreateMealTemplateInput, MealTemplate } from '../../api/mealTemplatesApi';
import {
  useCreateMealTemplate,
  useMealTemplates,
} from '../../hooks/useMealTemplates';
import { spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export default function CoachMealTemplatesScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const { data, isLoading, isError, refetch, isRefetching } =
    useMealTemplates();
  const createMut = useCreateMealTemplate();

  const [modalOpen, setModalOpen] = useState(false);

  const onCloseModal = useCallback(() => setModalOpen(false), []);

  return (
    <View style={styles.screen}>
      <FlatList<MealTemplate>
        data={data ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
            }}
            tintColor={sc.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[typography.h2, { color: sc.textPrimary }]}>
              Meal templates
            </Text>
            <Text style={[typography.body, { color: sc.textMuted }]}>
              Reusable building blocks for the daily meal plans you assign
              to clients.
            </Text>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Text style={[typography.body, styles.empty, { color: sc.textMuted }]}>
              Loading templates...
            </Text>
          ) : isError ? (
            <Text style={[typography.body, styles.empty, { color: sc.textMuted }]}>
              Could not load templates. Pull to retry.
            </Text>
          ) : (
            <Text style={[typography.body, styles.empty, { color: sc.textMuted }]}>
              No templates yet. Tap "New template" below to create one.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { borderColor: sc.border }]}>
            <Text style={[typography.h4, { color: sc.textPrimary }]}>
              {item.name}
            </Text>
            {item.description ? (
              <Text style={[typography.body, { color: sc.textMuted }]}>
                {item.description}
              </Text>
            ) : null}
            <View style={styles.macroRow}>
              <MacroPill label="kcal" value={item.calories_kcal} sc={sc} />
              <MacroPill label="P" value={item.protein_g} sc={sc} />
              <MacroPill label="C" value={item.carbs_g} sc={sc} />
              <MacroPill label="F" value={item.fats_g} sc={sc} />
            </View>
          </View>
        )}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New template"
        onPress={() => setModalOpen(true)}
        style={[styles.fab, { backgroundColor: sc.accent }]}
      >
        <Text style={[typography.h4, { color: sc.bgPrimary }]}>New template</Text>
      </Pressable>

      <Modal
        animationType="slide"
        visible={modalOpen}
        onRequestClose={onCloseModal}
        presentationStyle="formSheet"
      >
        <CreateTemplateForm
          onCancel={onCloseModal}
          onSubmit={async (input) => {
            try {
              await createMut.mutateAsync(input);
              onCloseModal();
            } catch (err) {
              Alert.alert(
                'Could not save template',
                err instanceof Error ? err.message : 'Unknown error',
              );
            }
          }}
          pending={createMut.isPending}
          sc={sc}
        />
      </Modal>
    </View>
  );
}

function MacroPill(props: {
  label: string;
  value: number | null;
  sc: SemanticTokens;
}) {
  const { label, value, sc } = props;
  return (
    <View style={[macroPillStyles.pill, { borderColor: sc.border }]}>
      <Text style={[typography.caption, { color: sc.textMuted }]}>{label}</Text>
      <Text style={[typography.body, { color: sc.textPrimary }]}>
        {value == null ? '—' : value}
      </Text>
    </View>
  );
}

const macroPillStyles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    minWidth: 56,
  },
});

function CreateTemplateForm(props: {
  onCancel: () => void;
  onSubmit: (input: CreateMealTemplateInput) => Promise<void>;
  pending: boolean;
  sc: SemanticTokens;
}) {
  const { onCancel, onSubmit, pending, sc } = props;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fats, setFats] = useState('');
  const [fiber, setFiber] = useState('');

  const styles = useMemo(() => makeFormStyles(sc), [sc]);

  const canSave =
    name.trim().length > 0 &&
    parseInt(calories, 10) >= 0 &&
    parseInt(protein, 10) >= 0 &&
    parseInt(carbs, 10) >= 0 &&
    parseInt(fats, 10) >= 0 &&
    !pending;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.h2, { color: sc.textPrimary }]}>
          New meal template
        </Text>

        <FormField label="Name" sc={sc}>
          <TextInput
            accessibilityLabel="Template name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Chicken & rice bowl"
            placeholderTextColor={sc.textMuted}
            style={styles.input}
            maxLength={120}
          />
        </FormField>

        <FormField label="Description (optional)" sc={sc}>
          <TextInput
            accessibilityLabel="Description"
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
          <NumField label="kcal" value={calories} onChange={setCalories} sc={sc} />
          <NumField label="Protein (g)" value={protein} onChange={setProtein} sc={sc} />
        </View>
        <View style={styles.macroRow}>
          <NumField label="Carbs (g)" value={carbs} onChange={setCarbs} sc={sc} />
          <NumField label="Fats (g)" value={fats} onChange={setFats} sc={sc} />
        </View>
        <View style={styles.macroRow}>
          <NumField label="Fiber (g, optional)" value={fiber} onChange={setFiber} sc={sc} />
        </View>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
            style={[styles.btnSecondary, { borderColor: sc.border }]}
          >
            <Text style={[typography.h4, { color: sc.textPrimary }]}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save template"
            disabled={!canSave}
            onPress={() => {
              const input: CreateMealTemplateInput = {
                name: name.trim(),
                description: description.trim() || undefined,
                calories_kcal: parseInt(calories, 10) || 0,
                protein_g: parseInt(protein, 10) || 0,
                carbs_g: parseInt(carbs, 10) || 0,
                fats_g: parseInt(fats, 10) || 0,
                fiber_g: fiber.trim() ? parseInt(fiber, 10) || 0 : undefined,
              };
              void onSubmit(input);
            }}
            style={[
              styles.btnPrimary,
              { backgroundColor: canSave ? sc.accent : sc.border },
            ]}
          >
            <Text style={[typography.h4, { color: sc.bgPrimary }]}>
              {pending ? 'Saving...' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
          borderRadius: 6,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          color: sc.textPrimary,
        }}
        maxLength={5}
      />
    </View>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    listContent: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
    header: { marginBottom: spacing.lg },
    empty: { textAlign: 'center', marginTop: spacing.xl },
    card: {
      borderWidth: 1,
      borderRadius: 10,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    macroRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    fab: {
      position: 'absolute',
      bottom: spacing.xl,
      right: spacing.lg,
      borderRadius: 999,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
  });
}

function makeFormStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
    input: {
      borderWidth: 1,
      borderColor: sc.border,
      borderRadius: 8,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: sc.textPrimary,
      minHeight: 44,
    },
    sectionHeading: { marginTop: spacing.lg, marginBottom: spacing.sm },
    macroRow: { flexDirection: 'row', marginTop: spacing.sm },
    actionRow: {
      flexDirection: 'row',
      gap: spacing.md,
      marginTop: spacing.xl,
    },
    btnSecondary: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    btnPrimary: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
  });
}
