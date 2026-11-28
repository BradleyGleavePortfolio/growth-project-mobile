/**
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3; frames S1_F01, F03, F05, F07, F08, F10): the meal page's
 * Options for clients block and its Recipe card. Drawing only: the form holds the ids and takes every change back.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, schemeCard, schemeCardOutline, semantic, spacing, typography } from '../../../theme/tokens';
import { recipeAllergenSummary } from '../../../lib/recipeAllergens';
import { LoadFailed, macroLine, mealStyles as ms } from './mealUi';
import { MAX_OPTIONS, declaresAllergen, moveOption, recipeLine, recipeShare, removeOption, type CoachRecipe, type OptionRow } from './mealLinks';

/** The meal page's cream cards (schemeCard); 16 pt inside and 20 pt Cormorant titles, as measured on S1_F01 (390 / 100%). */
export const card = [ms.card, schemeCard, schemeCardOutline, { padding: 16 }];
export const blockTitle = { ...typography.h2, fontSize: 20, lineHeight: 26 };
type Glyph = keyof typeof Ionicons.glyphMap;

/** A glyph and a muted line (the recipe's share and allergen lines), at the frames' 14 pt (FIX-PSCM-1 B1). */
export function Line({ icon, children }: { icon: Glyph; children: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={st.line}>
      <Ionicons name={icon} size={18} color={sc.textMuted} style={st.glyph} />
      <Text style={[typography.bodySmall, ms.fill, { color: sc.textMuted }]}>{children}</Text>
    </View>
  );
}

/** An underlined forest link with its own spoken label ("Change" is spoken "Change recipe"). */
function Link({ label, spoken, onPress }: { label: string; spoken?: string; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={spoken ?? label} onPress={onPress} hitSlop={8}
      style={({ pressed }) => [st.link, pressed && ms.pressed]}>
      <Text style={[typography.body, st.under, { color: sc.accentText }]}>{label}</Text>
    </Pressable>
  );
}

function Act({ icon, label, onPress, disabled, color }: { icon: Glyph; label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
      onPress={onPress} style={({ pressed }) => [st.act, pressed && ms.pressed, disabled && st.off]}>
      <Ionicons name={icon} size={24} color={color ?? sc.accentText} />
    </Pressable>
  );
}

/** Options for clients (F01, F03 Edit order, F05 none yet, F08 an archived meal). */
export function OptionsBlock({ rows, editing, onEditing, onAdd, onChange }: {
  rows: OptionRow[]; editing: boolean; onEditing: (on: boolean) => void; onAdd: () => void; onChange: (ids: string[]) => void;
}) {
  const { semanticColors: sc } = useTheme();
  const ids = rows.map((r) => r.id);
  const full = ids.length >= MAX_OPTIONS;
  const edit = editing && ids.length > 0;
  const ink = { color: sc.textPrimary };
  const muted = [typography.bodySmall, { color: sc.textMuted }];
  const add = (
    <Pressable accessibilityRole="button" accessibilityLabel="Add an option" accessibilityState={{ disabled: full }} disabled={full}
      onPress={onAdd} style={({ pressed }) => [st.add, pressed && ms.pressed]}>
      <Ionicons name="add-circle-outline" size={20} color={full ? sc.textMuted : sc.accentText} />
      <Text style={[typography.bodyMd, { color: full ? sc.textMuted : sc.accentText }]}>{ids.length ? 'Add' : 'Add an option'}</Text>
    </Pressable>
  );
  const move = (i: number, by: -1 | 1) => onChange(moveOption(ids, i, by));
  // N2: Remove on the last option ends Edit order, so an option added later opens in the normal mode.
  const drop = (i: number) => { const next = removeOption(ids, i); onChange(next); if (!next.length) onEditing(false); };
  return (
    <View style={[card, st.block]}>
      <View style={st.head}>
        <Text accessibilityRole="header" style={[blockTitle, st.grow, ink]}>Options for clients</Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{`${ids.length} of ${MAX_OPTIONS}`}</Text>
        {edit ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Done editing" onPress={() => onEditing(false)} style={st.add}>
            <Text style={[typography.bodyMd, { color: sc.accentText }]}>Done</Text>
          </Pressable>
        ) : ids.length ? add : null}
      </View>
      {edit ? add : null}
      <Text style={muted}>{!ids.length ? 'Clients on a plan with this meal can pick one of these instead.' : edit
        ? 'Move up and Move down set the order clients see.' : 'Clients can pick one instead. These go with this meal in every day plan that uses it.'}</Text>
      {full ? <Line icon="lock-closed-outline">Up to 10 options. Remove one to add another.</Line> : null}
      <View>{rows.map((r, i) => {
        const name = r.meal?.name ?? 'the archived meal';
        const rule = [st.row, { borderTopColor: sc.border }];
        if (r.state === 'unknown') return <View key={`${r.id}-${i}`} style={[rule, st.ghost, { backgroundColor: sc.border }]} />;
        const words = r.meal ? (
          <View style={ms.fill}>
            <Text style={[typography.bodyMd, ink]}>{r.meal.name}</Text>
            <Text style={muted}>{macroLine(r.meal)}</Text>
          </View>
        ) : (
          <View style={ms.fill}>
            <Text style={[typography.bodyMd, ink]}>A meal you archived</Text>
            <Text style={muted}>{edit ? 'Clients do not see it.' : 'Clients do not see it. It still counts toward the 10.'}</Text>
          </View>
        );
        if (edit) {
          return (
            <View key={`${r.id}-${i}`} style={rule}>
              {words}
              <Act icon="arrow-up" label={`Move up ${name}`} disabled={i === 0} onPress={() => move(i, -1)} />
              <Act icon="arrow-down" label={`Move down ${name}`} disabled={i === ids.length - 1} onPress={() => move(i, 1)} />
              <Act icon="remove-circle-outline" label={`Remove ${name}`} color={semantic.danger.border} onPress={() => drop(i)} />
            </View>
          );
        }
        if (!r.meal) {
          return (
            <View key={`${r.id}-${i}`} style={[rule, st.wrap]}>
              <View style={[st.tile, { backgroundColor: sc.bgSurface }]}><Ionicons name="archive-outline" size={22} color={sc.textPrimary} /></View>
              <View style={st.words}>{words}</View>
              <Link label="Remove" spoken="Remove the archived meal" onPress={() => drop(i)} />
            </View>
          );
        }
        const actions = [...(i > 0 ? [{ name: 'moveUp', label: 'Move up' }] : []),
          ...(i < ids.length - 1 ? [{ name: 'moveDown', label: 'Move down' }] : []), { name: 'remove', label: 'Remove' }];
        const onAction = (e: AccessibilityActionEvent) => {
          const a = e.nativeEvent.actionName;
          if (a === 'moveUp') move(i, -1); else if (a === 'moveDown') move(i, 1); else if (a === 'remove') drop(i);
        };
        return (
          <View key={`${r.id}-${i}`} style={rule}>
            {words}
            <Pressable accessibilityRole="button" accessibilityLabel={`More for ${name}`} accessibilityActions={actions}
              onAccessibilityAction={onAction} onPress={() => onEditing(true)} style={({ pressed }) => [st.act, pressed && ms.pressed]}>
              <Ionicons name="ellipsis-horizontal" size={24} color={sc.textPrimary} />
            </Pressable>
          </View>
        );
      })}</View>
      {!ids.length ? <View style={[st.addRow, { borderTopColor: sc.border }]}>{add}</View> : null}
    </View>
  );
}

/** The Recipe card (F01 linked, F05 none linked, F07 no recipes, F08 private, F10 the read failed; R6, R7). */
export function RecipeCard({ recipeId, mine, error, retry, retrying, onPick, onRemove }: {
  recipeId: string | null; mine: CoachRecipe[] | undefined; error: unknown; retry: () => void; retrying: boolean;
  onPick: () => void; onRemove: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const ink = { color: sc.textPrimary };
  const muted = [typography.bodySmall, { color: sc.textMuted }];
  if (error) return <LoadFailed title="Your recipes didn’t load." lead="Your meal is safe." error={error} onRetry={retry} retrying={retrying} />;
  if (!mine) {
    return (
      <View accessible accessibilityLabel="Loading your recipes" style={[card, st.still]}>
        {[0.5, 0.8, 0.6].map((w) => <View key={w} style={[st.bar, { width: `${w * 100}%`, backgroundColor: sc.border }]} />)}
      </View>
    );
  }
  const head = (links: boolean) => (
    <View style={st.head}>
      <Text accessibilityRole="header" style={[blockTitle, st.grow, ink]}>Recipe</Text>
      {links ? <Link label="Change" spoken="Change recipe" onPress={onPick} /> : null}
      {links ? <Link label="Remove link" onPress={onRemove} /> : null}
    </View>
  );
  if (!recipeId) {
    return (
      <View style={[card, st.recipe]}>
        {head(false)}
        {!mine.length ? (
          <>
            <Text style={[typography.h3, ink]}>No recipes yet</Text>
            <Text style={muted}>You have no recipes to link. Recipes cannot be made in the app yet.</Text>
          </>
        ) : (
          <>
            <Text style={muted}>Link one of your recipes. Clients can open it from this meal when you share it with them.</Text>
            <View style={[st.addRow, { borderTopColor: sc.border }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Link a recipe" onPress={onPick} style={({ pressed }) => [st.add, pressed && ms.pressed]}>
                <Ionicons name="link-outline" size={22} color={sc.accentText} />
                <Text style={[typography.bodyMd, { color: sc.accentText }]}>Link a recipe</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    );
  }
  const r = mine.find((x) => x.id === recipeId);
  return (
    <View style={[card, st.recipe, st.linked]}>
      {head(true)}
      <Text style={[typography.h3, ink]}>{r ? r.title : 'Recipe for this meal'}</Text>
      {r ? (
        <>
          <Text style={muted}>{recipeLine(r)}</Text>
          <Line icon={r.is_public ? 'people-outline' : 'lock-closed-outline'}>{recipeShare(r)}</Line>
          <Line icon="information-circle-outline">{recipeAllergenSummary(r)}</Line>
          {!r.is_public ? <Line icon="eye-off-outline">Only you can open it, so clients will not see this link.</Line> : null}
          {declaresAllergen(r) ? <Line icon="information-circle-outline">A client who saved an allergen this recipe declares does not see the link.</Line> : null}
        </>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: layout.touchMin },
  line: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  glyph: { marginTop: 2 },
  // FIX-PSCM-1 B1, measured on S1_F01 (390 / 100%): the Options card 6 pt inside top and bottom (the nearest token, 4),
  // its lines 4 pt apart; each option row 56 pt and a hairline (57 pt pitch), the rows in one container; the Recipe
  // card 4 pt above its 44 pt header row when linked (14 pt, the nearest token 12, otherwise) and 14 pt (12) below.
  block: { paddingVertical: spacing.xs, gap: spacing.xs },
  recipe: { paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  linked: { paddingTop: spacing.xs },
  grow: { flexGrow: 1 }, // C1: the title keeps its own width, so the count and Add wrap under it at 320 pt with 130% text
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: layout.rowMinHeight, paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth },
  addRow: { borderTopWidth: StyleSheet.hairlineWidth },
  act: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.35 },
  link: { minHeight: layout.touchMin, justifyContent: 'center' },
  wrap: { flexWrap: 'wrap' },
  words: { flex: 1, minWidth: 150 },
  under: { textDecorationLine: 'underline' },
  tile: { width: 40, height: 40, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  ghost: { height: 44, borderRadius: radius.control, opacity: 0.5 },
  still: { minHeight: 150 },
  bar: { height: 14, borderRadius: radius.chip },
});
