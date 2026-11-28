/**
 * PLAN-SWAPS-COACH-M (Style 1 "Meal page", PICK #ALM-P3; frame S1_F04): Link a recipe. Only the recipes he created
 * (R7), newest first as the server sends them. A tap hands its id back to the meal page under it and returns (R3);
 * "Remove link" hands back null, never "". Nothing is saved here: Save meal on the meal page sends it (R2).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, schemeCard, schemeCardOutline, typography } from '../../../theme/tokens';
import { Screen } from '../../../ui/layout/Screen';
import { QuietOverline } from '../../../ui/sections/QuietSection';
import { recipeAllergenSummary } from '../../../lib/recipeAllergens';
import type { ProgramsScreenProps } from '../programs/types';
import { FirstCard, LoadFailed, Loading, Masthead, mealStyles as ms } from './mealUi';
import { recipeLine, recipeShare } from './mealLinks';
import { Line } from './MealEditorBlocks';
import { useCoachRecipes } from './coachRecipes';

export default function MealRecipePickerScreen({ route, navigation }: ProgramsScreenProps<'MealRecipePicker'>) {
  const { semanticColors: sc } = useTheme();
  const { mealId, mealName, recipeId } = route.params;
  const { read, mine, failed } = useCoachRecipes();
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = mine?.filter((r) => r.title.toLowerCase().includes(term));
  const muted = [typography.bodySmall, { color: sc.textMuted }];
  const hand = (id: string | null) => navigation.popTo('MealEditor', { mealId, picked: { recipeId: id, at: Date.now() } });
  return (
    <Screen edges={['bottom']} contentStyle={styles.content}
      footer={recipeId ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove link" testID="recipe-unlink" onPress={() => hand(null)}
          style={({ pressed }) => [styles.outline, { borderColor: sc.accentText }, pressed && ms.pressed]}>
          <Text style={[typography.bodyMd, styles.outlineText, { color: sc.accentText }]}>Remove link</Text>
        </Pressable>
      ) : undefined}>
      <Masthead title="Link a recipe" sub={`For ${mealName}`} onBack={() => navigation.goBack()} />
      {failed ? <LoadFailed title="Your recipes didn’t load." lead="Your meal is safe." error={read.error} onRetry={() => void read.refetch()} retrying={read.isFetching} />
        : !mine || !shown ? <Loading label="Loading your recipes" />
        : !mine.length ? <FirstCard title="No recipes yet" body="You have no recipes to link. Recipes cannot be made in the app yet." /> : (
          <>
            <View style={[styles.field, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}>
              <Ionicons name="search-outline" size={20} color={sc.textMuted} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search your recipes" placeholderTextColor={sc.textMuted}
                accessibilityLabel="Search your recipes" autoCorrect={false} returnKeyType="search" style={[typography.body, ms.fill, { color: sc.textPrimary }]} />
            </View>
            <QuietOverline accessibilityRole="header">Your recipes, newest first</QuietOverline>
            {!shown.length ? <Text style={muted}>{`No recipes match “${q.trim()}”.`}</Text> : (
              <View style={[ms.card, schemeCard, schemeCardOutline, styles.list]}>
                {shown.map((r, i) => {
                  const on = r.id === recipeId;
                  const lines = [recipeLine(r), recipeShare(r), recipeAllergenSummary(r)] as const;
                  return (
                    <Pressable key={r.id} testID={`recipe-${r.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                      accessibilityLabel={[r.title, ...(on ? ['linked'] : []), ...lines].join(', ')} onPress={() => hand(r.id)}
                      style={({ pressed }) => [styles.row, i > 0 && { borderTopColor: sc.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && ms.pressed]}>
                      <View style={[ms.fill, styles.words]}>
                        <View style={styles.titleRow}>
                          <Text style={[ms.cardTitle, styles.title, { color: sc.textPrimary }]}>{r.title}</Text>
                          {on ? <Text style={[typography.caption, styles.tag, { color: sc.textOnAccent, backgroundColor: sc.accent }]}>Linked</Text> : null}
                        </View>
                        <Text style={muted}>{lines[0]}</Text>
                        <Line icon={r.is_public ? 'people-outline' : 'lock-closed-outline'}>{lines[1]}</Line>
                        <Line icon="information-circle-outline">{lines[2]}</Line>
                      </View>
                      <View style={[styles.tick, on ? { backgroundColor: sc.accent, borderColor: sc.accent } : { borderColor: sc.textMuted }]}>
                        {on ? <Ionicons name="checkmark" size={18} color={sc.textOnAccent} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.input },
  list: { paddingVertical: 4, paddingHorizontal: 16, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 12 },
  words: { gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, lineHeight: 26, flexShrink: 1 },
  tag: { flexShrink: 0, textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.control, overflow: 'hidden' },
  tick: { width: 28, height: 28, borderRadius: radius.chip, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  outline: { minHeight: layout.buttonHeight, borderWidth: 1, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  outlineText: { fontSize: 17 },
});
