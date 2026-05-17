import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';
import type { CoachMealPlan } from './types';

export function MealPlanTab({
  serverMealPlans,
  mealPlansLoading,
  mealPlansError,
  onCreate,
  onEdit,
  onArchive,
  onRetry,
  colors,
  styles,
}: {
  serverMealPlans: CoachMealPlan[];
  mealPlansLoading: boolean;
  mealPlansError: string | null;
  onCreate: () => void;
  onEdit: (plan: CoachMealPlan) => void;
  onArchive: (plan: CoachMealPlan) => void;
  onRetry: () => void;
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  return (
    <>
      <View style={styles.mealPlansHeader}>
        <Text style={styles.sectionTitle}>Meal Plans</Text>
        <TouchableOpacity
          style={styles.createPlanBtn}
          onPress={onCreate}
          accessibilityRole="button"
          accessibilityLabel="Create meal plan"
        >
          <Ionicons name="add" size={16} color={colors.textOnPrimary} />
          <Text style={styles.createPlanBtnText}>New plan</Text>
        </TouchableOpacity>
      </View>

      {mealPlansLoading && serverMealPlans.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : mealPlansError && serverMealPlans.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>{mealPlansError}</Text>
          <TouchableOpacity onPress={onRetry} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : serverMealPlans.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="restaurant-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            No meal plans yet. Tap "New plan" to assign one — the client will see it
            on their Plan tab.
          </Text>
        </View>
      ) : (
        serverMealPlans.map((plan) => (
          <View key={plan.id} style={styles.serverPlanCard}>
            <View style={styles.serverPlanHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.serverPlanTitle}>{plan.title}</Text>
                {plan.created_at && (
                  <Text style={styles.serverPlanMeta}>
                    Assigned{' '}
                    {new Date(plan.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                )}
              </View>
              <View style={styles.serverPlanActions}>
                <TouchableOpacity
                  onPress={() => onEdit(plan)}
                  style={styles.planIconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${plan.title}`}
                >
                  <Ionicons name="create-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onArchive(plan)}
                  style={styles.planIconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Archive ${plan.title}`}
                >
                  <Ionicons name="archive-outline" size={18} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
            {plan.notes ? (
              <Text style={styles.serverPlanNotes}>{plan.notes}</Text>
            ) : null}
            {plan.items.length === 0 ? (
              <Text style={styles.serverPlanEmpty}>No items in this plan.</Text>
            ) : (
              plan.items.map((it, idx) => (
                <View key={idx} style={styles.serverPlanRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.serverPlanItemName}>
                      {it.name || '—'}
                      {it.time_of_day ? (
                        <Text style={styles.serverPlanItemTod}>
                          {'  · '}
                          {it.time_of_day}
                        </Text>
                      ) : null}
                    </Text>
                    {it.notes ? (
                      <Text style={styles.serverPlanItemNotes}>{it.notes}</Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {it.calories != null && (
                      <Text style={styles.serverPlanItemCal}>
                        {Math.round(Number(it.calories))} kcal
                      </Text>
                    )}
                    {it.protein != null && (
                      <Text style={styles.serverPlanItemProt}>
                        P {Math.round(Number(it.protein))}g
                      </Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        ))
      )}
    </>
  );
}
