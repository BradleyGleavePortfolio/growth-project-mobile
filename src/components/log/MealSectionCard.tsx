import React from 'react';
import { View, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { layout, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { QuietText as Text } from '../../ui/progress/QuietBar';
import { FoodLog, MealType } from '../../types';
import { foodMacroLine, type MacroDisplayMode } from '../../macros/macroDisplay';

interface Props {
  label: string;
  /** Kept for callers; the quiet layout shows no meal icons. */
  icon?: string;
  mealType: MealType;
  logs: FoodLog[];
  mealCalories: number;
  onAddPress: (mealType: MealType) => void;
  onDeletePress: (log: FoodLog) => void;
  // F-2: invoked on tap when the parent wants to surface an edit flow for a
  // logged entry. Optional so older parents that haven't wired editing yet
  // keep working unchanged.
  onEditPress?: (log: FoodLog) => void;
  /** 'simple' during a never-tracker's first week: protein only per entry. */
  macroMode?: MacroDisplayMode;
}

export default function MealSectionCard({
  label,
  mealType,
  logs,
  mealCalories,
  onAddPress,
  onDeletePress,
  onEditPress,
  macroMode = 'full',
}: Props) {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  return (
    <View style={styles.mealSection} testID={`meal-section-${mealType}`}>
      <View style={styles.mealHeader}>
        <Text style={styles.mealTitle} accessibilityRole="header">{label}</Text>
        {mealCalories > 0 ? <Text style={styles.mealCals}>{`${Math.round(mealCalories)} kcal`}</Text> : null}
      </View>

      {logs.map((log) => {
        // F-3: prefer the original entered quantity/unit pair when the
        // backend row carries it. Falls back to the multiplier × serving
        // legacy rendering for older rows.
        const hasOriginal =
          typeof log.originalQuantity === 'number' &&
          !!log.originalUnit &&
          (log.originalUnit || '').trim().length > 0;
        const qtyLabel = hasOriginal
          ? `${log.originalQuantity} ${log.originalUnit}`
          : log.quantity > 1
            ? `×${log.quantity}`
            : '';
        return (
          <HapticPressable
            key={log.id}
            intent="light"
            style={styles.foodItem}
            // F-2: tap = edit (when wired by parent), long-press = delete.
            // Falling back to delete-on-long-press preserves the legacy
            // gesture so existing users do not lose the path they know.
            onPress={onEditPress ? () => onEditPress(log) : undefined}
            onLongPress={() => onDeletePress(log)}
            accessibilityLabel={
              onEditPress
                ? `${log.foodName}, ${qtyLabel || 'one serving'}. Tap to edit, long-press to delete.`
                : `${log.foodName}, ${qtyLabel || 'one serving'}. Long-press to delete.`
            }
          >
            <View style={styles.foodItemLeft}>
              <Text style={styles.foodName}>
                {log.foodName}
                {qtyLabel ? (
                  <Text style={styles.foodQuantityMuted}> · {qtyLabel}</Text>
                ) : null}
              </Text>
              <Text style={styles.foodMacros}>
                {foodMacroLine(log, macroMode)}
              </Text>
            </View>
            <Text style={styles.foodCals}>{Math.round(log.calories)}</Text>
          </HapticPressable>
        );
      })}

      <HapticPressable
        intent="medium"
        style={styles.addFoodButton}
        onPress={() => onAddPress(mealType)}
        accessibilityRole="button"
        accessibilityLabel={`Add food to ${label.toLowerCase()}`}
      >
        <Ionicons name="add" size={18} color={sc.accentText} />
        <Text style={styles.addFoodText}>Add food</Text>
      </HapticPressable>
    </View>
  );
}

const makeStyles = (sc: ReturnType<typeof useTheme>['semanticColors']) => StyleSheet.create({
  mealSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
    paddingTop: layout.sectionPadY,
    marginBottom: layout.sectionPadY,
  },
  mealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
    marginBottom: 4,
  },
  mealTitle: {
    ...typography.h2,
    color: sc.textPrimary,
    flexShrink: 1,
  },
  mealCals: {
    fontSize: 13,
    lineHeight: 19,
    color: sc.textMuted,
    fontVariant: ['tabular-nums'],
  },
  foodItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: layout.rowMinHeight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  foodItemLeft: {
    flex: 1,
    marginRight: 16,
  },
  foodName: {
    fontSize: 16,
    lineHeight: 22,
    color: sc.textPrimary,
  },
  foodQuantityMuted: {
    fontSize: 14,
    color: sc.textMuted,
  },
  foodMacros: {
    fontSize: 13,
    lineHeight: 19,
    color: sc.textMuted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  foodCals: {
    fontSize: 15,
    lineHeight: 22,
    color: sc.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  addFoodButton: {
    minHeight: layout.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 4,
  },
  addFoodText: {
    fontSize: 15,
    fontFamily: typography.bodyMd.fontFamily,
    color: sc.accentText,
  },
});
